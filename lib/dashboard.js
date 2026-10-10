// @ts-check
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import api from './api.js';
import { readConfig, serverURL } from './config.js';
import { apiError, inputError } from './errors.js';
import { v1, v2, v3 } from './paths.js';

/**
 * Url-source dashboards: an HTML page (plus its scripts, styles, images)
 * kept in a file storage and rendered by the console in an iframe, where it
 * talks to the server through the dashboard SDK (`/sdk/thinger-dashboard.js`).
 *
 * The storage must be public: the iframe cannot send an Authorization
 * header when it loads the page's files. Only the code is exposed; every API
 * call the page makes carries the viewer's token.
 *
 * A dashboard of the dashboards collection gets an empty context. A
 * per-device (or product, asset type, asset group, project) dashboard is
 * the `dashboard` property of that resource, holding the same
 * `{ source: "url", url }` object: the SDK then gets that id in its context.
 */

/** Resources that can hold a `dashboard` property, and where it lives. */
const TARGETS = {
    device: {
        property: (u, id) => `${v3(u)}/devices/${id}/properties/dashboard`,
        console: 'devices',
    },
    product: {
        property: (u, id) => `${v1(u)}/products/${id}/properties/dashboard`,
        console: 'products',
    },
    asset_type: {
        property: (u, id) => `${v1(u)}/types/${id}/properties/dashboard`,
        console: 'types',
    },
    asset_group: {
        property: (u, id) => `${v1(u)}/groups/${id}/properties/dashboard`,
        console: 'groups',
    },
    project: {
        property: (u, id) => `${v1(u)}/projects/${id}/properties/dashboard`,
        console: 'projects',
    },
};

export const DASHBOARD_TARGETS = Object.keys(TARGETS);

const ID_RE = /^[a-zA-Z0-9_-]{1,32}$/;
/** Folders never uploaded from a local app folder. */
const SKIPPED = new Set(['node_modules', '.git']);
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Files of a local folder, as { "relative/path": Buffer }. Hidden entries
 * and node_modules are left out.
 *
 * @param {string} dir
 * @returns {Record<string, Buffer>}
 */
export function collectFiles(dir) {
    const root = path.resolve(dir);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw inputError(`Not a folder: ${dir}`);
    }
    /** @type {Record<string, Buffer>} */
    const files = {};
    let total = 0;
    const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) {
                const content = fs.readFileSync(full);
                total += content.length;
                if (total > MAX_BYTES) {
                    throw inputError(
                        `${dir} holds more than ${MAX_BYTES / 1024 / 1024} MB: publish a build output folder`,
                    );
                }
                files[path.relative(root, full).split(path.sep).join('/')] = content;
            }
        }
    };
    walk(root);
    return files;
}

/** The SDK reference: the header comment of the server's own SDK file. */
export async function readSdkReference() {
    try {
        const res = await api.get('/sdk/thinger-dashboard.js', {
            transformResponse: [(x) => x],
            responseType: 'text',
        });
        const source = String(res.data || '');
        const end = source.indexOf('(function (global)');
        if (end < 0 || !source.trimStart().startsWith('/**')) {
            throw new Error('unexpected SDK file');
        }
        return source
            .slice(0, end)
            .split('\n')
            .map((line) => line.replace(/^\s*\/?\*+\/?\s?/, ''))
            .join('\n')
            .trim();
    } catch (e) {
        if (e.response?.status === 404) {
            throw inputError(
                'This server has no dashboard SDK (/sdk/thinger-dashboard.js): url-source dashboards need a newer server.',
            );
        }
        throw apiError(e);
    }
}

/**
 * Storage a dashboard's files go to unless the caller names one:
 * `dashboard_<id>`, `dashboard_<type>_<id>` for per-resource dashboards, or
 * a stable hash of the same when that does not fit the 32 characters a
 * storage id allows. Always the same for the same dashboard, so
 * republishing overwrites its files instead of scattering copies.
 *
 * @param {string | undefined} dashboard
 * @param {{ type: string, id: string }} [target]
 */
export function defaultStorage(dashboard, target) {
    const readable = dashboard ? `dashboard_${dashboard}` : `dashboard_${target.type}_${target.id}`;
    if (readable.length <= 32) return readable;
    const key = dashboard ? `dashboard:${dashboard}` : `${target.type}:${target.id}`;
    return `dashboard_${createHash('sha1').update(key).digest('hex').slice(0, 22)}`;
}

async function ensurePublicStorage(storage, label, user) {
    try {
        const res = await api.get(`${v1(user)}/storages/${storage}`);
        if (res.data?.public !== true) {
            throw inputError(
                `Storage "${storage}" is private, and the dashboard iframe can only load files from a public one. Pass another storage (it is created public), or make this one public first.`,
            );
        }
        return false;
    } catch (e) {
        if (e.response?.status !== 404) throw e.code === 'input_error' ? e : apiError(e);
    }
    try {
        await api.post(`${v1(user)}/storages`, {
            storage,
            name: label,
            description: 'Files of a url-source dashboard',
            public: true,
        });
        return true;
    } catch (e) {
        throw apiError(e);
    }
}

async function upload(storage, files, user) {
    for (const [file, content] of Object.entries(files)) {
        const target = file.split('/').map(encodeURIComponent).join('/');
        try {
            await api.put(`${v2(user)}/storages/${storage}/files/${target}`, content, {
                params: { overwrite: true },
                headers: { 'Content-Type': 'application/octet-stream' },
            });
        } catch (e) {
            throw apiError(e, { notFound: `Storage not found: ${storage}` });
        }
    }
}

/**
 * Publish an app as a url-source dashboard: upload its files to a public
 * storage, then point a dashboard, or the `dashboard` property of a
 * resource, at its entry page (with ?v= so viewers get the new files).
 *
 * @param {{
 *   dashboard?: string,
 *   target?: { type: string, id: string },
 *   name?: string,
 *   description?: string,
 *   files: Record<string, Buffer | string>,
 *   entry?: string,
 *   storage?: string,
 *   user?: string | null,
 * }} opts
 */
export async function publishDashboard({
    dashboard,
    target,
    name,
    description,
    files,
    entry = 'index.html',
    storage,
    user,
}) {
    if (!dashboard === !target) throw inputError('pass either dashboard or target');
    if (target && !TARGETS[target.type]) {
        throw inputError(`target.type must be one of ${DASHBOARD_TARGETS.join(', ')}`);
    }
    const ownerId = dashboard || target?.id;
    if (!ownerId || !ID_RE.test(ownerId)) throw inputError(`invalid id: "${ownerId ?? ''}"`);
    const names = Object.keys(files);
    if (!names.length) throw inputError('no files to publish');
    if (!(entry in files)) throw inputError(`the files have no entry page "${entry}"`);

    const storageId = storage || defaultStorage(dashboard, target);
    if (!ID_RE.test(storageId)) throw inputError(`invalid storage id: "${storageId}"`);

    const created = await ensurePublicStorage(storageId, name || `Dashboard ${ownerId}`, user);
    await upload(
        storageId,
        Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])),
        user,
    );

    const entryPath = entry.split('/').map(encodeURIComponent).join('/');
    const url = `${v1(user)}/storages/${storageId}/files/${entryPath}?v=${Date.now()}`;
    const base = serverURL(readConfig().server) || '';

    let consoleUrl;
    if (dashboard) {
        try {
            await api.put(`${v1(user)}/dashboards/${dashboard}`, {
                source: 'url',
                url,
                ...(name ? { name } : {}),
                ...(description !== undefined ? { description } : {}),
            });
        } catch (e) {
            if (e.response?.status !== 404) throw apiError(e);
            try {
                await api.post(`${v1(user)}/dashboards`, {
                    dashboard,
                    name: name || dashboard,
                    ...(description !== undefined ? { description } : {}),
                    source: 'url',
                    url,
                });
            } catch (e2) {
                throw apiError(e2);
            }
        }
        consoleUrl = `${base}/console/dashboards/${dashboard}`;
    } else {
        const spec = TARGETS[target.type];
        const property = spec.property(user, target.id);
        const value = { source: 'url', url };
        try {
            await api.put(property, { value });
        } catch (e) {
            if (e.response?.status !== 404) throw apiError(e);
            // No dashboard property yet: create it.
            try {
                await api.post(property.replace(/\/dashboard$/, ''), {
                    property: 'dashboard',
                    value,
                });
            } catch (e2) {
                throw apiError(e2, { notFound: `${target.type} not found: ${target.id}` });
            }
        }
        consoleUrl = `${base}/console/${spec.console}/${target.id}/dashboard`;
    }
    return { storage: storageId, storageCreated: created, files: names, url, consoleUrl };
}
