// @ts-check
import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, VERBS, ancestry, requestFor, templateFor } from '../lib/mcp/catalog.js';
import { bundledSpec, findOperation, resolveRefs } from '../lib/openapi.js';
import { buildTools } from '../lib/mcp/registry.js';
import { mergeHooks } from '../lib/mcp/resource-hooks.js';

const doc = bundledSpec();
const tools = buildTools();
const ACCOUNT = 'acme';

describe('resource catalog', () => {
    // The catalog is written by hand: this is what keeps it honest. Every
    // verb must reach the operation the table names, on the bundled copy of
    // the server's OpenAPI document (refresh it with the server's
    // /v1/server/swagger.json when the API changes).
    it('every operation exists in the OpenAPI document, at the path and method the verb maps to', () => {
        const wrong = [];
        for (const [name, type] of Object.entries(CATALOG)) {
            for (const [verb, operationId] of Object.entries(type.ops)) {
                const { method, path } = templateFor(name, /** @type {any} */ (verb));
                const found = findOperation(doc, method, path);
                if (found?.operation.operationId !== operationId) {
                    wrong.push(
                        `${name}.${verb}: ${method.toUpperCase()} ${path} is ${found?.operation.operationId ?? 'missing'}, expected ${operationId}`,
                    );
                }
            }
        }
        assert.deepEqual(wrong, []);
    });

    it('only uses known verbs, and every parent is a type with an id', () => {
        for (const [name, type] of Object.entries(CATALOG)) {
            for (const verb of Object.keys(type.ops)) assert.ok(verb in VERBS, `${name}.${verb}`);
            if (type.parent) {
                assert.ok(CATALOG[type.parent], `${name}: unknown parent ${type.parent}`);
                assert.ok(CATALOG[type.parent].id, `${name}: parent without id`);
            }
            assert.ok(type.description.length < 140, `${name}: description too long`);
        }
    });

    it('builds account paths through lib/paths.js, with the parent chain', () => {
        assert.deepEqual(requestFor('device', 'list', { user: ACCOUNT }), {
            method: 'get',
            url: '/v1/users/acme/devices',
        });
        assert.deepEqual(
            requestFor('device_property', 'patch', { parent: 'd1', id: 'cfg', user: ACCOUNT }),
            {
                method: 'patch',
                url: '/v3/users/acme/devices/d1/properties/cfg',
            },
        );
        assert.deepEqual(ancestry('device_bucket_tag'), ['device', 'device_bucket']);
        assert.equal(
            requestFor('device_bucket_tag', 'get', {
                parent: 'd1/temps',
                id: 'site',
                user: ACCOUNT,
            }).url,
            '/v3/users/acme/devices/d1/buckets/temps/tags/site',
        );
        assert.equal(
            requestFor('device', 'clone', { id: 'd1', user: ACCOUNT }).url,
            '/v1/users/acme/devices/d1/clone',
        );
        assert.equal(
            requestFor('device_callback', 'get', { parent: 'd1', user: ACCOUNT }).url,
            '/v3/users/acme/devices/d1/callback',
        );
    });

    it('creates upsert types with PUT on the item', () => {
        assert.deepEqual(
            requestFor('product_profile_api', 'create', {
                parent: 'p1',
                id: 'ingest',
                user: ACCOUNT,
            }),
            { method: 'put', url: '/v1/users/acme/products/p1/profile/api/ingest' },
        );
    });

    it('rejects missing or malformed ids and unsupported verbs', () => {
        assert.throws(
            () => requestFor('device', 'get', { user: ACCOUNT }),
            /id \(<device>\) is required/,
        );
        assert.throws(
            () => requestFor('device_bucket_tag', 'list', { parent: 'd1', user: ACCOUNT }),
            /parent \(<device>\/<bucket>\) is required/,
        );
        assert.throws(
            () => requestFor('device_bucket', 'delete', { parent: 'd1', user: ACCOUNT }),
            /does not support/,
        );
    });

    it('escapes ids into the URL', () => {
        assert.equal(
            requestFor('device', 'get', { id: 'a b', user: ACCOUNT }).url,
            '/v1/users/acme/devices/a%20b',
        );
    });
});

describe('resource tools', () => {
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    // Permissions by verb: each tool offers exactly the types that support
    // its verb, so the model cannot even name a delete the catalog forbids.
    it('offer, per verb, exactly the types that support it', () => {
        for (const verb of ['list', 'get', 'create', 'delete', 'clone']) {
            const tool = byName[`acme_resource_${verb}`];
            const expected = Object.keys(CATALOG).filter((n) => verb in CATALOG[n].ops);
            assert.deepEqual(tool.inputSchema.properties.type.enum, expected, verb);
        }
        assert.ok(
            !byName.acme_resource_delete.inputSchema.properties.type.enum.includes('device_bucket'),
        );
    });

    it('stay a short list', () => {
        assert.ok(tools.length <= 25, `${tools.length} tools`);
    });

    it('describe types without a server, from the catalog', async () => {
        const result = await byName.acme_resource_describe.handler({});
        assert.match(result.content[0].text, /device_property \(parent <device>\)/);
    });
});

describe('openapi helpers', () => {
    it('resolve $refs, cutting recursion', () => {
        const op = findOperation(doc, 'put', '/v3/users/{}/devices/{}/properties/{}');
        const schema = resolveRefs(
            doc,
            op.operation.requestBody.content['application/json'].schema,
        );
        assert.doesNotMatch(JSON.stringify(schema), /\$ref/);
        const loop = {
            components: { schemas: { a: { items: { $ref: '#/components/schemas/a' } } } },
        };
        assert.deepEqual(resolveRefs(loop, { $ref: '#/components/schemas/a' }), {
            items: { description: '(recursive: #/components/schemas/a)' },
        });
    });

    it('prefer literal path segments over parameters', () => {
        const found = findOperation(doc, 'get', '/v1/users/{}/products/{}/profile/code');
        assert.equal(found.operation.operationId, 'Product_ReadProfileCode');
    });
});

describe('resource hooks', () => {
    const ctx = () => ({ type: 'device', state: {} });

    it('generate credentials for devices that need them, and show them once', async () => {
        const hooks = mergeHooks();
        const c = ctx();
        const body = await hooks.device.beforeCreate({ device: 'd1' }, c);
        assert.ok(body.credentials?.length >= 6);
        assert.match(await hooks.device.afterCreate({}, c), new RegExp(body.credentials));
        const http = await hooks.device.beforeCreate({ device: 'd2', type: 'HTTP' }, ctx());
        assert.equal(http.credentials, undefined);
    });

    it('turn token durations into unix seconds and check permission trees', async () => {
        const hooks = mergeHooks();
        const body = await hooks.token.beforeCreate(
            { token: 't', name: 't', allow: { Device: { '*': '*' } }, expire: '1d' },
            ctx(),
        );
        assert.ok(body.expire > Date.now() / 1000);
        assert.equal(body.enabled, true);
        assert.throws(() => hooks.token.beforeCreate({ allow: 'all' }, ctx()), /allow/);
    });

    it('chain the hooks a CLI adds after the core ones', async () => {
        const hooks = mergeHooks({
            device: {
                beforeCreate: (body) => ({ ...body, labels: { by: 'cli' } }),
                afterCreate: () => 'cli note',
            },
            product: { afterDelete: () => 'storage removed' },
        });
        const c = ctx();
        const body = await hooks.device.beforeCreate({ device: 'd1' }, c);
        assert.ok(body.credentials);
        assert.deepEqual(body.labels, { by: 'cli' });
        assert.match(await hooks.device.afterCreate({}, c), /credentials[\s\S]*cli note/);
        assert.equal(
            await hooks.product.afterDelete({ type: 'product', state: {} }),
            'storage removed',
        );
    });
});
