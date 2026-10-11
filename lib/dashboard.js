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
 * talks to the server through the dashboard SDK (`/sdk/0.1/thinger-dashboard.js`).
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
 * and the `skip` folders (node_modules, .git) are left out.
 *
 * @param {string} dir
 * @param {{ skip?: Set<string>, maxBytes?: number, tooLarge?: string }} [options]
 *   `maxBytes` caps the folder (20 MB by default, an app's build output);
 *   `tooLarge` is the advice added to the error past it.
 * @returns {Record<string, Buffer>}
 */
export function collectFiles(
    dir,
    { skip = SKIPPED, maxBytes = MAX_BYTES, tooLarge = 'publish a build output folder' } = {},
) {
    const root = path.resolve(dir);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw inputError(`Not a folder: ${dir}`);
    }
    /** @type {Record<string, Buffer>} */
    const files = {};
    let total = 0;
    const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) {
                const content = fs.readFileSync(full);
                total += content.length;
                if (total > maxBytes) {
                    throw inputError(
                        `${dir} holds more than ${maxBytes / 1024 / 1024} MB: ${tooLarge}`,
                    );
                }
                files[path.relative(root, full).split(path.sep).join('/')] = content;
            }
        }
    };
    walk(root);
    return files;
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

/**
 * The app's storage, created public if missing.
 *
 * @returns {Promise<{ created: boolean, index?: string }>}
 */
async function ensurePublicStorage(storage, label, user) {
    try {
        const res = await api.get(`${v1(user)}/storages/${storage}`);
        if (res.data?.public !== true) {
            throw inputError(
                `Storage "${storage}" is private, and the dashboard iframe can only load files from a public one. Pass another storage (it is created public), or make this one public first.`,
            );
        }
        return { created: false, index: res.data.index || undefined };
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
        return { created: true };
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

/**
 * Write files into a storage, overwriting what is there.
 *
 * @param {string} storage
 * @param {Record<string, Buffer | string>} files  Paths inside the storage → content.
 * @param {string | null} [user]
 */
export async function uploadFiles(storage, files, user) {
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
 * Where a destination points: the storage folder when its entry is the
 * storage's index (`…/files/`, the trailing slash makes the server serve the
 * index), its file otherwise, plus its initial route. Storage files are
 * served with no-cache and an ETag, so viewers get each upload without a
 * version query; `version` adds one (?v=) to make open consoles reload.
 *
 * @param {string | null | undefined} user
 * @param {string} storage
 * @param {{ entry?: string, route?: string }} destination
 * @param {{ index?: string, version?: number | string }} [opts]
 */
export function entryUrl(user, storage, { entry = 'index.html', route }, { index, version } = {}) {
    const hash = route ? `#${String(route).replace(/^#/, '')}` : '';
    const query = version !== undefined ? `?v=${version}` : '';
    return `${storageFile(user, storage, entry === index ? '' : entry)}${query}${hash}`;
}

/**
 * What a preview token may do: read everything the SDK reads, nothing else.
 * Explicit names, not Read*: on devices that would also read their files
 * and web services. Device and product resources are left out, since the
 * same action reads and calls them.
 */
export const PREVIEW_ALLOW = {
    Device: {
        '*': [
            'ListDevices',
            'ReadDeviceConfig',
            'ReadDeviceStatus',
            'ReadDeviceStatistics',
            'ListDeviceProperties',
            'ReadDeviceProperty',
            'ListDeviceBuckets',
            'ReadDeviceBucket',
            'ListDeviceBucketTags',
            'ReadDeviceBucketTag',
        ],
    },
    Bucket: {
        '*': ['ListBuckets', 'ReadBucketConfig', 'ReadBucket', 'ListBucketTags', 'ReadBucketTag'],
    },
    Product: {
        '*': [
            'ListProducts',
            'ReadProductConfig',
            'ListProductProperties',
            'ReadProductProperty',
            'ReadProductProfile',
        ],
    },
    Type: {
        '*': [
            'ListTypes',
            'ReadTypeConfig',
            'ListTypeProperties',
            'ReadTypeProperty',
            'ReadAssetsLocations',
        ],
    },
    Group: {
        '*': [
            'ListGroups',
            'ReadGroupConfig',
            'ListGroupProperties',
            'ReadGroupProperty',
            'ReadAssetsLocations',
        ],
    },
    Asset: { '*': ['ReadAssetsLocations'] },
    Project: {
        '*': ['ListProjects', 'ReadProjectConfig', 'ListProjectProperties', 'ReadProjectProperty'],
    },
    Property: { '*': ['ListProperties', 'ReadProperty'] },
    Alarm: {
        '*': [
            'ListAlarmRules',
            'ReadAlarmRuleConfig',
            'ListAlarmInstances',
            'ReadAlarmInstanceConfig',
            'ReadAlarmInstanceStats',
        ],
    },
    Storage: { '*': ['ListStorages', 'ReadStorageConfig', 'ListStorageFiles', 'ReadStorageFiles'] },
    User: {
        '*': ['SubscribeUserEvents', 'ReadUserProfile', 'ReadUserTimezone', 'ListDeviceLocations'],
    },
};

export const PREVIEW_TTL_MS = 60 * 60 * 1000;

/**
 * Token id of an app's previews: one per storage and project, so publishing
 * again replaces it instead of piling up tokens.
 *
 * @param {string} storage
 * @param {string} [project]
 */
export function previewTokenId(storage, project) {
    const readable = project ? `preview_${storage}_${project}` : `preview_${storage}`;
    if (readable.length <= 32) return readable;
    const key = `${storage}:${project || ''}`;
    return `preview_${createHash('sha1').update(key).digest('hex').slice(0, 24)}`;
}

/**
 * A read-only access token for previews, valid for PREVIEW_TTL_MS. The
 * expiry is signed into the token, so it is renewed by deleting it and
 * creating it again. Inside a project (?project=) it only works there.
 *
 * @param {string} storage
 * @param {{ project?: string, user?: string | null }} [opts]
 * @returns {Promise<{ token: string, accessToken: string, expire: number }>}
 */
export async function previewToken(storage, { project, user } = {}) {
    const token = previewTokenId(storage, project);
    const params = project ? { project } : undefined;
    try {
        await api.delete(`${v1(user)}/tokens/${token}`, { params });
    } catch (e) {
        if (e.response?.status !== 404) throw apiError(e);
    }
    const expire = Date.now() + PREVIEW_TTL_MS;
    let res;
    try {
        res = await api.post(
            `${v1(user)}/tokens`,
            {
                token,
                name: `Preview of ${storage}${project ? ` (${project})` : ''}`,
                enabled: true,
                allow: PREVIEW_ALLOW,
                expire,
            },
            { params },
        );
    } catch (e) {
        throw apiError(e);
    }
    const accessToken = res.data?.access_token;
    if (!accessToken) throw new Error(`the server returned no access token for ${token}`);
    return { token, accessToken, expire };
}

/**
 * The entry url opened as a standalone page: the SDK takes the session from
 * the fragment (thinger_* params after the route) and strips it before the
 * app starts, so it never reaches the server.
 *
 * @param {string} url  Absolute entry url, with its optional #route.
 * @param {string} token  Access token.
 * @param {Record<string, string | undefined>} [context]  SDK context: project, device, product, type, group.
 */
export function previewUrl(url, token, context = {}) {
    const params = new URLSearchParams({ thinger_token: token });
    for (const [key, id] of Object.entries(context)) if (id) params.set(`thinger_${key}`, id);
    const [base, route] = url.split('#');
    return `${base}#${route || '/'}&${params}`;
}

/** The SDK context key each destination type fills. */
const CONTEXT_KEYS = {
    device: 'device',
    product: 'product',
    asset_type: 'type',
    asset_group: 'group',
    project: 'project',
};

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
 * its own entry page or initial route. Storage files are served with
 * no-cache and an ETag, so viewers get the new upload on their next load;
 * `bump` adds ?v=<publish time> to the urls so open consoles reload at once.
 *
 * With `preview`, each destination also gets a standalone link carrying a
 * read-only token that expires in an hour (see previewToken).
 *
 * @param {{
 *   storage?: string,
 *   files?: Record<string, Buffer | string>,
 *   prune?: boolean,
 *   to?: Destination[],
 *   preview?: boolean,
 *   bump?: boolean,
 *   user?: string | null,
 * }} opts
 */
export async function publishApp({
    storage,
    files,
    prune = false,
    to = [],
    preview = false,
    bump = false,
    user,
}) {
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

    let storageInfo;
    let deleted = [];
    if (files) {
        const label = to.length === 1 && to[0].name ? to[0].name : `App ${storageId}`;
        storageInfo = await ensurePublicStorage(storageId, label, user);
        await uploadFiles(
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
    const available = new Set(storageInfo?.created ? [] : await listFiles(storageId, user));
    for (const name of names) available.add(name);
    for (const d of to) {
        const entry = d.entry || 'index.html';
        if (!available.has(entry)) {
            throw inputError(`storage ${storageId} has no ${entry}: upload the app first`);
        }
    }
    storageInfo ??= await ensurePublicStorage(storageId, `App ${storageId}`, user);

    // The storage's index, served at its folder url: kept while it is in the
    // storage, else index.html or the first destination's entry.
    let index = storageInfo.index;
    if (!index || !available.has(index)) {
        const fallback = available.has('index.html') ? 'index.html' : to[0]?.entry;
        if (fallback && fallback !== index) {
            try {
                await api.put(`${v1(user)}/storages/${storageId}`, { index: fallback });
            } catch (e) {
                throw apiError(e);
            }
        }
        index = fallback;
    }

    const urlOpts = { index, version: bump ? Date.now() : undefined };
    const pointed = [];
    for (const d of to) {
        const url = entryUrl(user, storageId, d, urlOpts);
        pointed.push({
            to: d.dashboard ? `dashboard ${d.dashboard}` : `${d.type} ${d.id}`,
            url,
            open: await point(d, url, user),
        });
    }

    // One token per project the previews run in (none for account dashboards).
    const previews = [];
    if (preview) {
        const base = serverURL(readConfig().server) || '';
        const tokens = new Map();
        for (const d of to.length ? to : [{}]) {
            const project = d.type === 'project' ? d.id : undefined;
            if (!tokens.has(project)) {
                tokens.set(project, await previewToken(storageId, { project, user }));
            }
            const { accessToken, expire } = tokens.get(project);
            previews.push({
                to: d.dashboard ? `dashboard ${d.dashboard}` : d.type ? `${d.type} ${d.id}` : 'app',
                url: previewUrl(
                    base + entryUrl(user, storageId, d, urlOpts),
                    accessToken,
                    d.type ? { [CONTEXT_KEYS[d.type]]: d.id } : {},
                ),
                expire,
            });
        }
    }
    return {
        storage: storageId,
        storageCreated: storageInfo.created,
        uploaded: names,
        deleted,
        pointed,
        previews,
    };
}
