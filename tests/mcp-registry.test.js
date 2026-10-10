import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTools, genericTools } from '../lib/mcp/registry.js';
import { expandToolRefs } from '../lib/mcp/naming.js';

const tools = buildTools();

describe('mcp registry', () => {
    it('exports a non-empty array of tools', () => {
        assert.ok(Array.isArray(tools));
        assert.ok(tools.length > 0);
    });

    it('every tool has name, description, inputSchema and handler', () => {
        for (const t of tools) {
            assert.equal(typeof t.name, 'string', `missing name on ${JSON.stringify(t)}`);
            assert.equal(typeof t.description, 'string', `missing description on ${t.name}`);
            assert.equal(typeof t.inputSchema, 'object', `missing inputSchema on ${t.name}`);
            assert.equal(typeof t.handler, 'function', `missing handler on ${t.name}`);
        }
    });

    it('tool names are unique and carry the identity prefix', () => {
        const names = tools.map((t) => t.name);
        assert.equal(new Set(names).size, names.length, 'duplicate tool name detected');
        for (const name of names) assert.match(name, /^acme_[a-z0-9_]+$/);
    });

    it('every required field is declared in properties', () => {
        for (const t of tools) {
            const required = t.inputSchema.required || [];
            const properties = t.inputSchema.properties || {};
            for (const field of required) {
                assert.ok(
                    field in properties,
                    `${t.name}.required lists "${field}" but it's missing from properties`,
                );
            }
        }
    });

    it('every tool (except profiles) has the injected `profile` option', () => {
        for (const t of tools) {
            if (t.name === 'acme_profiles') continue;
            assert.ok(
                t.inputSchema.properties?.profile,
                `${t.name} is missing the injected profile param`,
            );
        }
    });

    // Descriptions are what the model reads: a leftover placeholder or a
    // reference to another CLI's tools sends it after tools it doesn't have.
    it('descriptions are fully expanded and name only this CLI', () => {
        const text = JSON.stringify(tools.map(({ handler: _h, ...t }) => t));
        assert.doesNotMatch(text, /\{(tool|family):/);
        assert.doesNotMatch(text, /thinr|ThinRemote|thinger_/i);
    });

    it('leaves the declarations untouched, so building twice is stable', () => {
        assert.ok(genericTools.every((t) => !t.name.startsWith('acme_')));
        assert.deepEqual(
            buildTools().map((t) => t.name),
            tools.map((t) => t.name),
        );
    });

    it('adds CLI-specific tools and rejects duplicates', () => {
        const extra = {
            name: 'hello',
            description: 'Says hello; see {tool:devices}.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => ({ content: [] }),
        };
        const built = buildTools([extra]);
        const hello = built.find((t) => t.name === 'acme_hello');
        assert.equal(hello.description, 'Says hello; see acme_devices.');
        assert.throws(() => buildTools([{ ...extra, name: 'devices' }]), /Duplicate MCP tool name/);
        assert.throws(() => buildTools([extra, extra]), /Duplicate MCP tool name/);
    });

    it('lets a CLI replace a generic tool when it says so', () => {
        const mine = {
            name: 'device_info',
            replaces: true,
            description: 'Platform-specific device info.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => ({ content: [] }),
        };
        const built = buildTools([mine]);
        const info = built.filter((t) => t.name === 'acme_device_info');
        assert.equal(info.length, 1);
        assert.equal(info[0].description, 'Platform-specific device info.');
        assert.ok(!('replaces' in info[0]));
        assert.throws(
            () => buildTools([{ ...mine, name: 'not_generic' }]),
            /replaces no generic tool/,
        );
    });
});

describe('tool references', () => {
    const known = new Set(['devices', 'token_list', 'token_get']);

    it('expand tools and families', () => {
        assert.equal(expandToolRefs('use {tool:devices}', known, 'x'), 'use acme_devices');
        assert.equal(
            expandToolRefs('the {family:token} tools', known, 'x'),
            'the acme_token_* tools',
        );
    });

    it('fail loudly on unknown tools', () => {
        assert.throws(
            () => expandToolRefs('{tool:monitoring}', known, 'x'),
            /unknown tool "monitoring"/,
        );
        assert.throws(() => expandToolRefs('{family:playbook}', known, 'x'), /unknown tool family/);
    });

    it('leave platform templates such as {{payload}} alone', () => {
        assert.equal(expandToolRefs('"{{payload}}"', known, 'x'), '"{{payload}}"');
    });
});
