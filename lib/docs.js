// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDK_PACKAGE, cliSdkPackageDir } from './dashboard-sdk.js';
import { inputError } from './errors.js';

/**
 * Documentation for agents and app developers, all local: the platform's
 * guides that cli-core ships (concepts, product code, server
 * administration), the dashboard SDK's reference and types from its npm
 * package, and the guides a CLI adds for its own platform. None depends on
 * the server: where a feature needs a given server version the text says
 * "since Thinger X", and the server tells its version at
 * `/v1/server/version`.
 *
 * @typedef {object} Doc
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} [file]  Local file.
 * @property {string[]} [files]  Local files read as one document (the SDK's type declarations).
 * @property {string} [format] markdown, typescript, json…
 */

const DOCS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');

/** The platform's guides, shipped with cli-core. */
/** @type {Doc[]} */
export const PLATFORM_DOCS = [
    {
        id: 'concepts',
        title: 'Thinger concepts',
        description:
            'How projects, devices (incl. Virtual), products, buckets (reading, importing history), asset types and groups, properties, alarms (rule syntax), endpoints, storages, tokens, dashboards and events relate, and which data source to use for each need.',
        file: path.join(DOCS_DIR, 'thinger-concepts.md'),
        format: 'markdown',
    },
    {
        id: 'product-code',
        title: 'Product code',
        description:
            "JavaScript run by a product's profile: functions that compute resource values (simulated devices), payload transforms, device_id_resolver; runtime, signatures, placeholders, state between calls, logging and limits.",
        file: path.join(DOCS_DIR, 'thinger-product-code.md'),
        format: 'markdown',
    },
    {
        id: 'server-admin',
        title: 'Server administration',
        description:
            'For admins: host settings and restarts, custom domains with their brand (DNS, certificates, logos, email), user accounts, OAuth clients, identity providers and proxies, with their side effects and risks.',
        file: path.join(DOCS_DIR, 'thinger-server-admin.md'),
        format: 'markdown',
    },
];

/** @type {Doc[]} */
let cliDocs = [];

/**
 * Documents the CLI itself ships (its own platform's guides), listed first.
 * They travel with the CLI because they describe what the CLI implements on
 * top of the server. On an id clash with cli-core's documents, the CLI's
 * win.
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
        file: d.file instanceof URL ? fileURLToPath(d.file) : String(d.file),
        format: d.format || 'markdown',
    }));
}

/**
 * The dashboard SDK's documents, from its npm package: the project's (the
 * version the app uses), else the CLI's own.
 *
 * @returns {Doc[]}
 */
function sdkDocs() {
    const dir = cliSdkPackageDir();
    if (!dir) return [];
    let version;
    try {
        version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    } catch {
        return [];
    }
    /** @type {Doc[]} */
    const docs = [];
    const readme = path.join(dir, 'README.md');
    if (fs.existsSync(readme)) {
        docs.push({
            id: 'dashboard-sdk',
            title: `Dashboard SDK reference (${SDK_PACKAGE} ${version})`,
            description:
                'Build dashboard apps (React, Angular…) on the SDK package: installing it, the console and standalone modes, routing, context and every call.',
            file: readme,
            format: 'markdown',
        });
    }
    const dist = path.join(dir, 'dist');
    const declarations = fs.existsSync(dist)
        ? fs.readdirSync(dist).filter((f) => f.endsWith('.d.ts'))
        : [];
    if (declarations.includes('index.d.ts')) {
        const first = ['index.d.ts', 'types.d.ts'];
        const order = [
            ...first.filter((f) => declarations.includes(f)),
            ...declarations.filter((f) => !first.includes(f)).sort(),
        ];
        docs.push({
            id: 'dashboard-sdk-types',
            title: `Dashboard SDK TypeScript declarations (${SDK_PACKAGE} ${version})`,
            description:
                'Type declarations of the SDK (index.d.ts, then the data types and each module); they come with the package.',
            files: order.map((f) => path.join(dist, f)),
            format: 'typescript',
        });
    }
    return docs;
}

/**
 * Every document available: the CLI's own, the platform's, then the
 * dashboard SDK's (from its package). Ids are unique: the first wins.
 *
 * @returns {Promise<Doc[]>}
 */
export async function listDocs() {
    /** @type {Doc[]} */
    const docs = [];
    for (const d of [...cliDocs, ...PLATFORM_DOCS, ...sdkDocs()]) {
        if (!docs.some((x) => x.id === d.id)) docs.push(d);
    }
    return docs;
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
    if (doc.files) {
        const text = doc.files
            .map(
                (f) =>
                    `// ${path.basename(f)}\n` +
                    fs
                        .readFileSync(f, 'utf8')
                        .replace(/^\/\/# sourceMappingURL=.*$/gm, '')
                        .trim(),
            )
            .join('\n\n');
        return { doc, text };
    }
    return { doc, text: fs.readFileSync(/** @type {string} */ (doc.file), 'utf8') };
}

/** MIME type for a document format. */
export function docMimeType(format) {
    return (
        { markdown: 'text/markdown', json: 'application/json', html: 'text/html' }[format] ||
        'text/plain'
    );
}
