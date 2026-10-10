// @ts-check
import fs from 'node:fs';
import api from './api.js';
import { apiError, inputError } from './errors.js';

/**
 * Documentation the server publishes for agents and app developers: a
 * guide to the platform's concepts, the dashboard SDK reference, its
 * TypeScript declarations… listed in the server's own index
 * (`/sdk/docs.json`), so a new guide reaches the model by being added
 * there, without a new CLI release. Always read from the server the profile
 * points at, so it matches the version it runs.
 *
 * @typedef {object} Doc
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} [path]  Path on the same server (`/sdk/…`), for the server's documents.
 * @property {string} [file]  Local file, for the documents a CLI ships.
 * @property {string} [format] markdown, typescript, json…
 */

/** @type {Doc[]} */
let cliDocs = [];

/**
 * Documents the CLI itself ships (its own platform's guides), listed next
 * to the server's. They travel with the CLI because they describe what the
 * CLI implements on top of the server. Ids must not clash with the server's:
 * the CLI's win.
 *
 * @param {Array<{ id: string, title: string, description?: string, format?: string, file: string | URL }>} docs
 */
export function defineCliDocs(docs = []) {
    for (const d of docs) {
        if (!d || typeof d.id !== 'string' || !d.title || !d.file) {
            throw new Error(`CLI document needs id, title and file: ${JSON.stringify(d)}`);
        }
    }
    cliDocs = docs.map((d) => ({
        ...d,
        file: d.file instanceof URL ? d.file.pathname : String(d.file),
        format: d.format || 'markdown',
    }));
}

const INDEX = '/sdk/docs.json';

/** Documents servers published before the index existed: looked for when there is no index. */
/** @type {Doc[]} */
export const FALLBACK_DOCS = [
    {
        id: 'concepts',
        title: 'Thinger concepts',
        description: 'How the platform pieces relate, and which data source to use for each need.',
        path: '/sdk/thinger-concepts.md',
        format: 'markdown',
    },
    {
        id: 'dashboard-sdk',
        title: 'Dashboard SDK reference',
        description: 'Build url dashboards and web apps that run inside the console.',
        path: '/sdk/thinger-dashboard.md',
        format: 'markdown',
    },
    {
        id: 'dashboard-sdk-types',
        title: 'Dashboard SDK TypeScript declarations',
        description: 'Type declarations for the global Thinger object.',
        path: '/sdk/thinger-dashboard.d.ts',
        format: 'typescript',
    },
];

/** A path on the profile's own server: never another host, never a parent folder. */
const LOCAL_PATH = /^\/(?!\/)[^?#\\]*$/;

export function validDoc(d) {
    return (
        d &&
        typeof d.id === 'string' &&
        /^[a-z0-9][a-z0-9._-]*$/i.test(d.id) &&
        typeof d.path === 'string' &&
        LOCAL_PATH.test(d.path) &&
        !d.path.split('/').includes('..')
    );
}

/** Text of a file on the server, whatever type it is labelled with (dev servers say video/mp2t for .ts). */
async function readText(path) {
    const res = await api.get(path, { transformResponse: [(x) => x], responseType: 'text' });
    return String(res.data ?? '');
}

/**
 * The documents the server publishes, from its index; the known ones when
 * it has no index.
 *
 * @returns {Promise<Doc[]>}
 */
async function listServerDocs() {
    let raw;
    try {
        raw = await readText(INDEX);
    } catch (e) {
        if (e.response?.status === 404) return publishedFallbacks();
        throw apiError(e);
    }
    let docs;
    try {
        docs = JSON.parse(raw).docs;
    } catch {
        throw inputError(`The server's documentation index (${INDEX}) is not valid JSON`);
    }
    return Array.isArray(docs)
        ? docs.filter(validDoc).map((d) => ({ ...d, title: d.title || d.id }))
        : [];
}

/**
 * Every document available: the CLI's own, then the server's. When the
 * server cannot be read, the CLI's alone (and the error if there are none).
 *
 * @returns {Promise<Doc[]>}
 */
export async function listDocs() {
    let server;
    try {
        server = await listServerDocs();
    } catch (e) {
        if (!cliDocs.length) throw e;
        server = [];
    }
    const own = new Set(cliDocs.map((d) => d.id));
    return [...cliDocs, ...server.filter((d) => !own.has(d.id))];
}

/** Without an index, the known documents this server actually serves. */
async function publishedFallbacks() {
    const served = await Promise.all(
        FALLBACK_DOCS.map((d) =>
            readText(d.path).then(
                () => true,
                () => false,
            ),
        ),
    );
    return FALLBACK_DOCS.filter((_, i) => served[i]);
}

/**
 * One document by id.
 *
 * @param {string} id
 * @returns {Promise<{ doc: Doc, text: string }>}
 */
export async function readDoc(id) {
    const docs = await listDocs();
    const doc = docs.find((d) => d.id === id);
    if (!doc) {
        throw inputError(
            `Unknown document "${id}". Available: ${docs.map((d) => d.id).join(', ') || 'none'}.`,
        );
    }
    if (doc.file) return { doc, text: fs.readFileSync(doc.file, 'utf8') };
    try {
        return { doc, text: await readText(doc.path) };
    } catch (e) {
        if (e.response?.status === 404) {
            throw inputError(`This server does not publish "${doc.title}" (${doc.path}).`);
        }
        throw apiError(e);
    }
}

/** MIME type for a document format. */
export function docMimeType(format) {
    return (
        { markdown: 'text/markdown', json: 'application/json', html: 'text/html' }[format] ||
        'text/plain'
    );
}
