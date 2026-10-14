// @ts-check
import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTools } from '../lib/mcp/registry.js';
import { MAX_TEXT } from '../lib/mcp/tools-resource.js';

/** A CLI type over an in-memory folder of notes, hanging off a device. */
function notesType() {
    /** @type {Map<string, Map<string, any>>} */
    const store = new Map();
    const of = (device) => store.get(device) ?? store.set(device, new Map()).get(device);
    const calls = [];
    return {
        store,
        calls,
        type: {
            description: 'Notes kept on a device.',
            parent: 'device',
            id: 'name',
            schema: { type: 'object', properties: { name: {}, text: {} } },
            describe: async () => ({ reference: { kinds: ['memo', 'todo'] } }),
            notes: 'Use {tool:resource_call} action "archive" to archive one.',
            list: (ctx) => {
                calls.push(['list', ctx.parent, ctx.filter]);
                return [...of(ctx.parent).values()];
            },
            get: (ctx) => {
                const note = of(ctx.parent).get(ctx.id);
                if (!note)
                    throw Object.assign(new Error(`No note ${ctx.id}`), { code: 'not_found' });
                return note;
            },
            create: (body, ctx) => {
                if (of(ctx.parent).has(ctx.id)) throw new Error(`${ctx.id} already exists`);
                of(ctx.parent).set(ctx.id, body);
            },
            update: (body, ctx) => {
                of(ctx.parent).set(ctx.id, { ...of(ctx.parent).get(ctx.id), ...body });
                return 'saved';
            },
            delete: (ctx) => {
                of(ctx.parent).delete(ctx.id);
            },
            actions: {
                archive: {
                    description: 'Archive a note.',
                    run: (_body, ctx) => ({ archived: ctx.id }),
                },
                fail: {
                    description: 'Always fails.',
                    on: 'either',
                    run: () => ({ content: [{ type: 'text', text: 'it failed' }], isError: true }),
                },
                count: {
                    description: 'How many notes the device has.',
                    on: 'collection',
                    run: (_body, ctx) => `${of(ctx.parent).size} notes`,
                },
            },
        },
    };
}

function build(extra = {}) {
    const notes = notesType();
    const tools = buildTools([], {
        types: { device_note: notes.type, ...(extra.types || {}) },
        actions: extra.actions,
    });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const call = (tool, args) => byName[`acme_${tool}`].handler(args);
    return { notes, tools, byName, call };
}

const textOf = (result) => result.content[0].text;

describe('resource types a CLI adds', () => {
    it('serves list, get, create, update and delete through the resource tools', async () => {
        const { call } = build();
        const where = { type: 'device_note', parent: 'pump_1' };
        assert.match(
            textOf(await call('resource_create', { ...where, id: 'a', body: { text: 'hi' } })),
            /Created device_note pump_1\/a/,
        );
        // The id goes into the body field, as for server types.
        await call('resource_create', { ...where, body: { name: 'b', text: 'there' } });
        const list = textOf(await call('resource_list', where));
        assert.match(list, /^2 device_note:/);
        assert.match(list, /"name":"a"/);
        assert.deepEqual(JSON.parse(textOf(await call('resource_get', { ...where, id: 'a' }))), {
            name: 'a',
            text: 'hi',
        });
        assert.match(
            textOf(await call('resource_update', { ...where, id: 'a', body: { text: 'bye' } })),
            /Updated device_note pump_1\/a: text\.\nsaved/,
        );
        await call('resource_delete', { ...where, id: 'b' });
        assert.match(textOf(await call('resource_list', where)), /^1 device_note:/);
    });

    it('searches and pages what the CLI lists whole', async () => {
        const { call, notes } = build();
        const device = new Map();
        for (let i = 0; i < 60; i++)
            device.set(`n${i}`, { name: `n${i}`, text: i % 2 ? 'odd' : 'even' });
        notes.store.set('pump_1', device);
        const page = textOf(await call('resource_list', { type: 'device_note', parent: 'pump_1' }));
        assert.match(page, /60 in total, showing 0–49; pass index: 50/);
        const odd = textOf(
            await call('resource_list', {
                type: 'device_note',
                parent: 'pump_1',
                search: 'odd',
                filter: { path: '/x' },
            }),
        );
        assert.match(odd, /^30 device_note:/);
        // The filter reaches the CLI's function.
        assert.deepEqual(notes.calls.at(-1), ['list', 'pump_1', { path: '/x' }]);
    });

    it('asks for the parent and the id', async () => {
        const { call } = build();
        await assert.rejects(
            call('resource_list', { type: 'device_note' }),
            /parent \(<device>\) is required/,
        );
        await assert.rejects(
            call('resource_get', { type: 'device_note', parent: 'pump_1' }),
            /id \(<name>\) is required/,
        );
        await assert.rejects(
            call('resource_create', { type: 'device_note', parent: 'pump_1', body: { text: 'x' } }),
            /give the device_note id/,
        );
        await assert.rejects(
            call('resource_clone', { type: 'device_note', parent: 'pump_1', id: 'a', body: {} }),
            /Unknown type|does not support clone/,
        );
    });

    it('runs its actions with resource_call, with or without id as declared', async () => {
        const { call } = build();
        const where = { type: 'device_note', parent: 'pump_1' };
        await call('resource_create', { ...where, id: 'a', body: {} });
        assert.deepEqual(
            JSON.parse(
                textOf(await call('resource_call', { ...where, action: 'archive', id: 'a' })),
            ),
            { archived: 'a' },
        );
        assert.equal(textOf(await call('resource_call', { ...where, action: 'count' })), '1 notes');
        await assert.rejects(
            call('resource_call', { ...where, action: 'archive' }),
            /id \(<name>\) is required/,
        );
        await assert.rejects(
            call('resource_call', { ...where, action: 'count', id: 'a' }),
            /takes no id/,
        );
        await assert.rejects(
            call('resource_call', { ...where, action: 'nope' }),
            /has no action "nope" \(it has: archive, fail, count\)/,
        );
        const failed = await call('resource_call', { ...where, action: 'fail' });
        assert.equal(failed.isError, true);
        assert.equal(textOf(failed), 'it failed');
    });

    it('adds actions to the server types', async () => {
        const { call, byName } = build({
            actions: {
                device: {
                    reboot: {
                        description: 'Reboot the device.',
                        run: (_b, ctx) => `rebooting ${ctx.id}`,
                    },
                    enroll: {
                        description: 'Install command for a new device.',
                        on: 'collection',
                        body: { type: 'object', properties: { product: { type: 'string' } } },
                        run: (body) => `install --product ${body?.product}`,
                    },
                },
            },
        });
        assert.equal(
            textOf(await call('resource_call', { type: 'device', action: 'reboot', id: 'pump_1' })),
            'rebooting pump_1',
        );
        assert.equal(
            textOf(
                await call('resource_call', {
                    type: 'device',
                    action: 'enroll',
                    body: { product: 'p' },
                }),
            ),
            'install --product p',
        );
        assert.ok(byName.acme_resource_call.inputSchema.properties.type.enum.includes('device'));
        assert.ok(
            byName.acme_resource_call.inputSchema.properties.type.enum.includes('device_note'),
        );
    });

    it('describes them from their definition, and lists them with the server types', async () => {
        const { call, byName } = build({
            actions: { device: { reboot: { description: 'Reboot the device.', run: () => '' } } },
        });
        const described = textOf(await call('resource_describe', { type: 'device_note' }));
        assert.match(described, /^type: device_note/m);
        assert.match(described, /^parent: device \(write it as "<device>"\)/m);
        assert.match(described, /^id: <name>/m);
        assert.match(described, /"list":"acme_resource_list"/);
        assert.match(
            described,
            /"count":\{"run":"acme_resource_call action \\"count\\"".*"id":"none"/,
        );
        assert.match(described, /Use acme_resource_call action "archive"/);
        assert.match(described, /^fields: /m);
        assert.match(described, /^reference: \{"kinds":\["memo","todo"\]\}$/m);
        const summary = textOf(await call('resource_describe', {}));
        assert.match(
            summary,
            /^device_note \(parent <device>\): Notes kept on a device\. \[list get create update delete \| archive fail count\]$/m,
        );
        assert.match(summary, /^device: .*\| .*reboot\]$/m);
        for (const tool of [
            'resource_list',
            'resource_get',
            'resource_create',
            'resource_delete',
        ]) {
            assert.ok(
                byName[`acme_${tool}`].inputSchema.properties.type.enum.includes('device_note'),
                tool,
            );
        }
        // A type that cannot clone is not offered to resource_clone.
        assert.ok(
            !byName.acme_resource_clone.inputSchema.properties.type.enum.includes('device_note'),
        );
    });

    it('cuts long reads', async () => {
        const { call, notes } = build();
        notes.store.set(
            'pump_1',
            new Map([['big', { name: 'big', text: 'x'.repeat(MAX_TEXT + 10) }]]),
        );
        const read = textOf(
            await call('resource_get', { type: 'device_note', parent: 'pump_1', id: 'big' }),
        );
        assert.ok(read.length < MAX_TEXT + 200);
        assert.match(read, /… \(cut: \d+ characters in total, showing the first 100000\)$/);
    });

    it('refuses what clashes with the server catalog', () => {
        const run = () => {};
        assert.throws(
            () => buildTools([], { types: { device: { description: 'x', list: () => [] } } }),
            /"device" is already a server type/,
        );
        assert.throws(
            () =>
                buildTools([], {
                    types: { thing: { description: 'x', parent: 'nope', list: () => [] } },
                }),
            /unknown parent "nope"/,
        );
        assert.throws(
            () =>
                buildTools([], {
                    actions: { alarm_instance: { stats: { description: 'x', run } } },
                }),
            /already has an action "stats"/,
        );
        assert.throws(
            () => buildTools([], { actions: { nope: { x: { description: 'x', run } } } }),
            /unknown resource type "nope"/,
        );
        assert.throws(
            () => buildTools([], { types: { thing: { description: 'x' } } }),
            /has no operations/,
        );
    });
});
