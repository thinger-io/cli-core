// @ts-check
import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    collectFiles,
    defaultStorage,
    entryUrl,
    publishApp,
    unhashedAssets,
} from '../lib/dashboard.js';
import { CATALOG } from '../lib/mcp/catalog.js';
import { buildTools, listResources, readResource } from '../lib/mcp/registry.js';
import {
    FALLBACK_DOCS,
    defineCliDocs,
    docMimeType,
    listDocs,
    readDoc,
    validDoc,
} from '../lib/docs.js';

describe('dashboard files', () => {
    it('collects a folder recursively, without hidden entries or node_modules', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
        fs.mkdirSync(path.join(dir, 'js'));
        fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
        fs.writeFileSync(path.join(dir, 'js', 'app.js'), 'console.log(1)');
        fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
        fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'index.js'), '');
        const files = collectFiles(dir);
        assert.deepEqual(Object.keys(files).sort(), ['index.html', 'js/app.js']);
        assert.equal(files['js/app.js'].toString(), 'console.log(1)');
    });

    it('refuses what is not a folder', () => {
        assert.throws(() => collectFiles('/no/such/folder'), /Not a folder/);
    });
});

describe('dashboard storage', () => {
    it('is readable when it fits, and a stable 32-character hash otherwise', () => {
        assert.equal(defaultStorage('sales'), 'dashboard_sales');
        assert.equal(
            defaultStorage(undefined, { type: 'device', id: 'gw1' }),
            'dashboard_device_gw1',
        );
        const long = defaultStorage(undefined, { type: 'asset_group', id: 'madrid_north_plant' });
        assert.match(long, /^dashboard_[0-9a-f]{22}$/);
        assert.equal(
            long,
            defaultStorage(undefined, { type: 'asset_group', id: 'madrid_north_plant' }),
        );
        assert.notEqual(
            long,
            defaultStorage(undefined, { type: 'asset_type', id: 'madrid_north_plant' }),
        );
    });
});

describe('dashboard publishing', () => {
    const files = { 'index.html': '<html></html>' };

    // Validation happens before any request, so these need no server.
    it('needs something to do', async () => {
        await assert.rejects(publishApp({}), /nothing to do/);
        await assert.rejects(publishApp({ files: {} }), /no files/);
        await assert.rejects(
            publishApp({ to: [{ dashboard: 'd' }], prune: true }),
            /prune needs the files/,
        );
    });

    it('checks each destination', async () => {
        await assert.rejects(
            publishApp({ files, to: [{}] }),
            /either \{dashboard\} or \{type, id\}/,
        );
        await assert.rejects(
            publishApp({ files, to: [{ dashboard: 'd', type: 'device', id: 'x' }] }),
            /either \{dashboard\} or \{type, id\}/,
        );
        await assert.rejects(
            publishApp({ files, to: [{ type: 'bucket', id: 'b' }] }),
            /type must be one of/,
        );
        await assert.rejects(publishApp({ files, to: [{ dashboard: 'bad id' }] }), /invalid id/);
        await assert.rejects(
            publishApp({ files, to: [{ dashboard: 'd', entry: '/index.html' }] }),
            /entry is a path inside the storage/,
        );
    });

    it('needs a storage name for an app shared by several destinations', async () => {
        await assert.rejects(
            publishApp({ files, to: [{ dashboard: 'a' }, { dashboard: 'b' }] }),
            /pass storage/,
        );
        await assert.rejects(
            publishApp({ files, storage: 'no spaces allowed', to: [{ dashboard: 'd' }] }),
            /invalid storage id/,
        );
    });

    it('builds versioned entry urls with an optional hash route', () => {
        assert.equal(
            entryUrl('acme', 'app_plant', { entry: 'pages/device view.html' }, 42),
            '/v1/users/acme/storages/app_plant/files/pages/device%20view.html?v=42',
        );
        assert.equal(
            entryUrl('acme', 'app_plant', { route: '/devices/gw1' }, 42),
            '/v1/users/acme/storages/app_plant/files/index.html?v=42#/devices/gw1',
        );
        assert.equal(
            entryUrl('acme', 'app_plant', { route: '#/x' }, 1),
            '/v1/users/acme/storages/app_plant/files/index.html?v=1#/x',
        );
    });

    it('flags scripts and styles without a content hash', () => {
        assert.deepEqual(
            unhashedAssets([
                'index.html',
                'main-4QXZ7J2K.js',
                'chunk-AB12CD34.js',
                'styles.9f8e7d6c.css',
                'app.js',
                'css/style.css',
                'assets/logo.png',
            ]),
            ['app.js', 'css/style.css'],
        );
    });
});

describe('dashboard MCP surface', () => {
    it('lists the known documents as resources when no server can be read', async () => {
        // No profile is configured in the tests: the index cannot be fetched.
        const resources = await listResources();
        assert.deepEqual(
            resources.map((r) => r.uri),
            FALLBACK_DOCS.map((d) => `acme://${d.id}`),
        );
        assert.match(resources[0].description, /acme_doc_read/);
        assert.equal(resources[0].mimeType, 'text/markdown');
        await assert.rejects(readResource('other://concepts'), /Unknown resource/);
    });

    // A CLI ships its own guides: they are listed and read even when no
    // server can be reached (no profile in the tests), first in the list.
    it("serves the CLI's own guides next to the server's", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-'));
        fs.writeFileSync(path.join(dir, 'guide.md'), '# Acme guide');
        defineCliDocs([
            { id: 'acme-guide', title: 'Acme guide', file: path.join(dir, 'guide.md') },
        ]);
        try {
            const docs = await listDocs();
            assert.deepEqual(
                docs.map((d) => d.id),
                ['acme-guide'],
            );
            assert.equal((await readDoc('acme-guide')).text, '# Acme guide');
            await assert.rejects(readDoc('nope'), /Unknown document "nope". Available: acme-guide/);
            const resources = await listResources();
            assert.equal(resources[0].uri, 'acme://acme-guide');
            assert.equal((await readResource('acme://acme-guide')).text, '# Acme guide');
        } finally {
            defineCliDocs([]);
        }
        assert.throws(() => defineCliDocs([{ id: 'x' }]), /needs id, title and file/);
    });

    // The index comes from the server: it must not be able to send the CLI
    // (and its token) to another host, or out of the server's paths.
    it('only follows document paths on the same server', () => {
        const doc = (path) => ({ id: 'x', title: 'X', path });
        assert.ok(validDoc(doc('/sdk/guide.md')));
        assert.ok(!validDoc(doc('https://evil.example/guide.md')));
        assert.ok(!validDoc(doc('//evil.example/guide.md')));
        assert.ok(!validDoc(doc('/sdk/../v1/users/me')));
        assert.ok(!validDoc(doc('sdk/guide.md')));
        assert.ok(!validDoc({ id: '../x', path: '/sdk/x.md' }));
        assert.equal(docMimeType('typescript'), 'text/plain');
    });

    // Catalog notes are expanded at run time, not by the registry: check
    // here that every {tool:x} they name is a tool the CLI serves.
    it('catalog notes refer to existing tools', () => {
        const names = new Set(buildTools().map((t) => t.name.replace(/^acme_/, '')));
        for (const [name, type] of Object.entries(CATALOG)) {
            for (const text of [type.description, type.notes || '']) {
                for (const [, ref] of text.matchAll(/\{tool:([a-z0-9_]+)\}/g)) {
                    assert.ok(names.has(ref), `${name} refers to unknown tool ${ref}`);
                }
            }
        }
    });
});
