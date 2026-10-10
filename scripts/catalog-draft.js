#!/usr/bin/env node
// @ts-check
/**
 * Draft the resource catalog from a server's OpenAPI document.
 *
 *   node scripts/catalog-draft.js [swagger.json]
 *
 * Walks every account-scoped path (`/v{N}/users/{user}/...`), pairs each
 * collection with its item path, and prints one line per collection with
 * the operations the server has for it and their operationIds. It is a
 * starting point for `lib/mcp/catalog.js`, not its source: the catalog is
 * reviewed by hand (names, exclusions, admin-only types) and never
 * generated at run time, so a new server collection is not exposed to the
 * model until someone decides it should be.
 */
import fs from 'node:fs';

const file = process.argv[2] || new URL('../tests/fixtures/swagger.json', import.meta.url);
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** `/v1/users/{user}/devices/{device}/properties` → collection chain. */
const ACCOUNT = /^\/(v\d|\{version\})\/users\/\{user\}\/(.+)$/;

const collections = new Map();
for (const [path, item] of Object.entries(doc.paths)) {
    const m = ACCOUNT.exec(path);
    if (!m) continue;
    const segments = m[2].split('/');
    // A collection path ends in a literal; its item path adds one `{param}`.
    const last = segments[segments.length - 1];
    const isItem = /^\{[a-z_]+\}$/.test(last);
    const base = isItem ? segments.slice(0, -1) : segments;
    const key = `${m[1]}/${base.join('/')}`;
    const entry = collections.get(key) || { version: m[1], path: base.join('/'), ops: {} };
    for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        const verb = isItem
            ? { get: 'get', put: 'update', patch: 'patch', delete: 'delete', post: 'post' }[method]
            : { get: 'list', post: 'create', put: 'set', delete: 'clear', patch: 'patch' }[method];
        entry.ops[verb] = op.operationId || '?';
    }
    collections.set(key, entry);
}

// Clone and projects hang off the item path; fold them into their collection.
for (const entry of collections.values()) {
    const m = /^(.*)\/\{[a-z_]+\}\/(clone|projects)$/.exec(entry.path);
    if (!m) continue;
    const parent = collections.get(`${entry.version}/${m[1]}`);
    if (!parent) continue;
    const op = entry.ops.create || entry.ops.set;
    if (op) parent.ops[m[2]] = op;
    entry.folded = true;
}

const typeName = (path) =>
    path
        .split('/')
        .filter((s) => !s.startsWith('{'))
        .map((s) => s.replace(/s$/, ''))
        .join('_');

for (const entry of [...collections.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    if (entry.folded) continue;
    const ops = Object.entries(entry.ops)
        .map(([verb, id]) => `${verb}=${id}`)
        .join(' ');
    console.log(`${typeName(entry.path).padEnd(34)} ${entry.version} ${entry.path}\n    ${ops}`);
}
