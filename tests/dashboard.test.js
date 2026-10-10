// @ts-check
import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectFiles, defaultStorage, publishDashboard } from '../lib/dashboard.js';
import { CATALOG } from '../lib/mcp/catalog.js';
import { buildResources, buildTools } from '../lib/mcp/registry.js';

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
    it('needs exactly one of dashboard or target', async () => {
        await assert.rejects(publishDashboard({ files }), /either dashboard or target/);
        await assert.rejects(
            publishDashboard({ dashboard: 'd', target: { type: 'device', id: 'x' }, files }),
            /either dashboard or target/,
        );
    });

    it('checks the target type, the ids and the entry page', async () => {
        await assert.rejects(
            publishDashboard({ target: { type: 'bucket', id: 'b' }, files }),
            /target.type must be one of/,
        );
        await assert.rejects(publishDashboard({ dashboard: 'bad id', files }), /invalid id/);
        await assert.rejects(
            publishDashboard({ dashboard: 'd', files: { 'app.js': '' } }),
            /no entry page "index.html"/,
        );
        await assert.rejects(
            publishDashboard({ dashboard: 'd', files, storage: 'no spaces allowed' }),
            /invalid storage id/,
        );
    });
});

describe('dashboard MCP surface', () => {
    it('serves the SDK reference as a resource under the CLI prefix', () => {
        const [sdk] = buildResources();
        assert.equal(sdk.uri, 'acme://dashboard-sdk');
        assert.match(sdk.description, /acme_dashboard_publish/);
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
