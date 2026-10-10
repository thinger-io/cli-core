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
    device: { path: 'devices', properties: v3, console: 'devices' },
    product: { path: 'products', properties: v1, console: 'products' },
    asset_type: { path: 'types', properties: v1, console: 'types' },
    asset_group: { path: 'groups', properties: v1, console: 'groups' },
    project: { path: 'projects', properties: v1, console: 'projects' },
};

/** The resource a target names, and its `dashboard` property (device properties are v3). */
const targetPath = (type, user, id) => `${v1(user)}/${TARGETS[type].path}/${id}`;
const propertyPath = (type, user, id) =>
    `${TARGETS[type].properties(user)}/${TARGETS[type].path}/${id}/properties/dashboard`;

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

/** TypeScript declarations of the SDK (`/sdk/thinger-dashboard.d.ts`), for typed apps. */
export async function readSdkTypes() {
    try {
        // Served with whatever type the extension suggests (dev servers say
        // video/mp2t for .ts): read it as text regardless.
        const res = await api.get('/sdk/thinger-dashboard.d.ts', {
            transformResponse: [(x) => x],
            responseType: 'text',
        });
        return String(res.data || '');
    } catch (e) {
        if (e.response?.status === 404) {
            throw inputError('This server publishes no SDK typings (/sdk/thinger-dashboard.d.ts).');
        }
        throw apiError(e);
    }
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

/** Account-relative path of a file in a storage, each segment escaped. */
const storageFile = (user, storage, file, version = 'v1') =>
    `${version === 'v2' ? v2(user) : v1(user)}/storages/${storage}/files/${file
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;

async function upload(storage, files, user) {
    for (const [file, content] of Object.entries(files)) {
        try {
            await api.put(storageFile(user, storage, file, 'v2'), content, {
                params: { overwrite: true },
                headers: { 'Content-Type': 'application/octet-stream' },
            });
        } catch (e) {
            throw apiError(e, { notFound: `Storage not found: ${storage}` });
        }
    }
}

/** Paths of every file in a storage (empty when it has none yet). */
async function listFiles(storage, user) {
    try {
        const res = await api.get(`${v1(user)}/storages/${storage}/files`);
        return (Array.isArray(res.data) ? res.data : [])
            .filter((f) => f.type !== 'directory')
            .map((f) => String(f.path ?? f.name).replace(/^\/+/, ''));
    } catch (e) {
        // The server creates a storage's folder with its first file.
        if (e.response?.status === 404) return [];
        throw apiError(e);
    }
}

async function remove(storage, files, user) {
    for (const file of files) {
        try {
            await api.delete(storageFile(user, storage, file, 'v2'));
        } catch (e) {
            if (e.response?.status !== 404) throw apiError(e);
        }
    }
}

/** Scripts and styles whose names carry no content hash: browsers may keep stale copies. */
const HASHED = /[.-][A-Za-z0-9]{8,}\.(?:m?js|css)$/;
export function unhashedAssets(names) {
    return names.filter((n) => /\.(?:m?js|css)$/.test(n) && !HASHED.test(n));
}

/**
 * @typedef {object} Destination  Where an app is shown: a dashboard of the
 *   collection, or the `dashboard` property of a resource (type + id).
 * @property {string} [dashboard]
 * @property {string} [type]
 * @property {string} [id]
 * @property {string} [entry]   Page in the storage (default index.html).
 * @property {string} [route]   Initial route, after `#` (hash routing).
 * @property {string} [name]    Name of a collection dashboard.
 * @property {string} [description]
 */

/** @param {Destination} d */
function checkDestination(d) {
    if (!d || typeof d !== 'object') throw inputError('each destination must be an object');
    if (!d.dashboard === !(d.type || d.id)) {
        throw inputError('a destination is either {dashboard} or {type, id}');
    }
    if (d.type && !TARGETS[d.type]) {
        throw inputError(`type must be one of ${DASHBOARD_TARGETS.join(', ')}`);
    }
    const id = d.dashboard || d.id;
    if (!id || !ID_RE.test(id)) throw inputError(`invalid id: "${id ?? ''}"`);
    if (
        d.entry !== undefined &&
        (typeof d.entry !== 'string' || !d.entry || d.entry.startsWith('/'))
    ) {
        throw inputError('entry is a path inside the storage, e.g. "index.html"');
    }
}

/**
 * Where a destination points: the entry page, versioned, plus its initial route.
 *
 * @param {string | null | undefined} user
 * @param {string} storage
 * @param {{ entry?: string, route?: string }} destination
 * @param {number | string} version
 */
export function entryUrl(user, storage, { entry = 'index.html', route }, version) {
    const hash = route ? `#${String(route).replace(/^#/, '')}` : '';
    return `${storageFile(user, storage, entry)}?v=${version}${hash}`;
}

/** Point one destination at `url`; returns where to open it in the console. */
async function point(d, url, user) {
    const base = serverURL(readConfig().server) || '';
    if (d.dashboard) {
        const body = {
            source: 'url',
            url,
            ...(d.name ? { name: d.name } : {}),
            ...(d.description !== undefined ? { description: d.description } : {}),
        };
        try {
            await api.put(`${v1(user)}/dashboards/${d.dashboard}`, body);
        } catch (e) {
            if (e.response?.status !== 404) throw apiError(e);
            try {
                await api.post(`${v1(user)}/dashboards`, {
                    dashboard: d.dashboard,
                    name: d.name || d.dashboard,
                    ...body,
                });
            } catch (e2) {
                throw apiError(e2);
            }
        }
        return `${base}/console/dashboards/${d.dashboard}`;
    }
    const property = propertyPath(d.type, user, d.id);
    const value = { source: 'url', url };
    try {
        await api.put(property, { value });
    } catch (e) {
        if (e.response?.status !== 404) throw apiError(e);
        // No dashboard property yet: create it.
        try {
            await api.post(property.replace(/\/dashboard$/, ''), { property: 'dashboard', value });
        } catch (e2) {
            throw apiError(e2, { notFound: `${d.type} not found: ${d.id}` });
        }
    }
    return `${base}/console/${TARGETS[d.type].console}/${d.id}/dashboard`;
}

/**
 * Publish an HTML app to a public storage and/or point dashboards at it.
 *
 * Both halves are optional: upload a new build without touching the
 * dashboards, point more dashboards at an app already uploaded, or both at
 * once. One storage can hold an app shared by many dashboards, each opening
 * its own entry page or initial route. Every url carries ?v=<publish time>,
 * so viewers load the new entry page instead of a cached one.
 *
 * @param {{
 *   storage?: string,
 *   files?: Record<string, Buffer | string>,
 *   prune?: boolean,
 *   to?: Destination[],
 *   user?: string | null,
 * }} opts
 */
export async function publishApp({ storage, files, prune = false, to = [], user }) {
    if (!Array.isArray(to)) throw inputError('to must be a list of destinations');
    to.forEach(checkDestination);
    const names = files ? Object.keys(files) : [];
    if (files && !names.length) throw inputError('no files to publish');
    if (!files && !to.length)
        throw inputError('nothing to do: pass files to upload, to to point, or both');
    if (prune && !files) throw inputError('prune needs the files of the new version');

    if (!storage && to.length !== 1) {
        throw inputError('pass storage: it names the app shared by these destinations');
    }
    const storageId =
        storage ||
        defaultStorage(
            to[0].dashboard,
            to[0].dashboard ? undefined : { type: to[0].type, id: to[0].id },
        );
    if (!ID_RE.test(storageId)) throw inputError(`invalid storage id: "${storageId}"`);

    // Check the resources before creating or filling any storage for them.
    for (const d of to.filter((x) => x.type)) {
        try {
            await api.get(targetPath(d.type, user, d.id));
        } catch (e) {
            throw apiError(e, { notFound: `${d.type} not found: ${d.id}` });
        }
    }

    let created = false;
    let deleted = [];
    if (files) {
        const label = to.length === 1 && to[0].name ? to[0].name : `App ${storageId}`;
        created = await ensurePublicStorage(storageId, label, user);
        await upload(
            storageId,
            Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])),
            user,
        );
        if (prune) {
            const keep = new Set(names);
            deleted = (await listFiles(storageId, user)).filter((f) => !keep.has(f));
            await remove(storageId, deleted, user);
        }
    }

    // Every entry must be in the storage before anything points at it.
    const available = new Set(files && !to.length ? [] : await listFiles(storageId, user));
    for (const name of names) available.add(name);
    for (const d of to) {
        const entry = d.entry || 'index.html';
        if (!available.has(entry)) {
            throw inputError(`storage ${storageId} has no ${entry}: upload the app first`);
        }
    }
    if (to.length && !files) await ensurePublicStorage(storageId, `App ${storageId}`, user);

    const version = Date.now();
    const pointed = [];
    for (const d of to) {
        const url = entryUrl(user, storageId, d, version);
        pointed.push({
            to: d.dashboard ? `dashboard ${d.dashboard}` : `${d.type} ${d.id}`,
            url,
            open: await point(d, url, user),
        });
    }
    return {
        storage: storageId,
        storageCreated: created,
        uploaded: names,
        deleted,
        pointed,
        unhashed: unhashedAssets(names),
    };
}
