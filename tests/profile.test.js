// @ts-check
import './setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import api from '../lib/api.js';
import {
    PROFILE_API_TARGETS,
    PROFILE_DATA_SOURCES,
    PROFILE_PAYLOAD_TYPES,
    buildApiRequestData,
    buildApiResponseData,
    buildListenerDataBlock,
    deleteProductApiResource,
    deleteProductBucket,
    deleteProductProfileProperty,
    getProductApiResource,
    getProductApiResources,
    getProductBucket,
    getProductBuckets,
    getProductProfileProperties,
    getProductProfileProperty,
    setProductApiResource,
    setProductBucket,
    setProductProfileProperty,
    setProfileApiResource,
    setProfileBucket,
    setProfileProperty,
} from '../lib/profile.js';

const USER = 'admin';

/**
 * Stub the axios singleton with an in-memory map keyed by URL. Each test
 * starts from a clean slate via `setupBackend()`. Calls capture the
 * payload so assertions can reach inside the body sent to the server.
 */
function setupBackend(initial = {}) {
    const state = new Map(Object.entries(initial));
    const calls = [];
    api.get = async (path) => {
        calls.push({ method: 'GET', path });
        if (state.has(path)) return { data: state.get(path) };
        const err = new Error('Not found');
        err.response = { status: 404 };
        throw err;
    };
    api.put = async (path, body) => {
        calls.push({ method: 'PUT', path, body });
        state.set(path, body);
        return { data: body };
    };
    api.delete = async (path) => {
        calls.push({ method: 'DELETE', path });
        if (!state.has(path)) {
            const err = new Error('Not found');
            err.response = { status: 404 };
            throw err;
        }
        state.delete(path);
        return { data: { ok: true } };
    };
    api.post = async (path, body) => {
        calls.push({ method: 'POST', path, body });
        state.set(path, body);
        return { data: body };
    };
    return { state, calls };
}

// ─── Pure builder tests ─────────────────────────────────────────────

describe('buildListenerDataBlock', () => {
    it('builds a resource_stream listener', () => {
        const data = buildListenerDataBlock({
            source: 'resource_stream',
            source_args: { resource_stream: 'backup_complete' },
            payload_type: 'source_payload',
            payload: '{{payload}}',
        });
        assert.deepEqual(data, {
            source: 'resource_stream',
            resource_stream: 'backup_complete',
            payload_type: 'source_payload',
            payload: '{{payload}}',
        });
    });

    it('builds a resource listener with poll cadence', () => {
        const data = buildListenerDataBlock({
            source: 'resource',
            source_args: {
                resource: 'monitoring',
                update: 'interval',
                interval: 60,
                magnitude: 'second',
            },
            payload_type: 'source_payload',
            payload: '{{payload}}',
        });
        assert.deepEqual(data, {
            source: 'resource',
            resource: 'monitoring',
            update: 'interval',
            interval: 60,
            magnitude: 'second',
            payload_type: 'source_payload',
            payload: '{{payload}}',
        });
    });

    it('forwards the patch flag for property handlers', () => {
        const data = buildListenerDataBlock({
            source: 'resource_stream',
            source_args: { resource_stream: 'partial' },
            patch: true,
        });
        assert.equal(data.patch, true);
    });

    it('rejects an unknown source', () => {
        assert.throws(
            () => buildListenerDataBlock({ source: 'magic' }),
            (err) => err.code === 'input_error' && /Invalid source/.test(err.message),
        );
    });

    it('rejects a missing required source_args key', () => {
        assert.throws(
            () => buildListenerDataBlock({ source: 'resource_stream', source_args: {} }),
            (err) =>
                err.code === 'input_error' &&
                /requires source_args.resource_stream/.test(err.message),
        );
    });

    it('rejects a non-numeric interval', () => {
        assert.throws(
            () =>
                buildListenerDataBlock({
                    source: 'resource',
                    source_args: { resource: 'm', update: 'interval', interval: 'fast' },
                }),
            (err) => err.code === 'input_error' && /interval/.test(err.message),
        );
    });

    it('rejects an unknown payload_type', () => {
        assert.throws(
            () =>
                buildListenerDataBlock({
                    source: 'resource_stream',
                    source_args: { resource_stream: 's' },
                    payload_type: 'magic',
                }),
            (err) => err.code === 'input_error' && /Invalid payload_type/.test(err.message),
        );
    });
});

describe('buildApiRequestData', () => {
    it('builds a resource_stream target with default stream name (= API resource name)', () => {
        const data = buildApiRequestData({
            target: 'resource_stream',
            resource_name: 'backup_complete',
            payload_type: 'source_payload',
        });
        assert.deepEqual(data, {
            target: 'resource_stream',
            resource_stream: 'backup_complete',
            payload_type: 'source_payload',
        });
    });

    it('builds a resource_stream target with explicit stream name', () => {
        const data = buildApiRequestData({
            target: 'resource_stream',
            target_args: { resource_stream: 'other_stream' },
            resource_name: 'caller_name',
        });
        assert.equal(data.resource_stream, 'other_stream');
    });

    it('requires both product and product_stream for product_stream target', () => {
        assert.throws(
            () =>
                buildApiRequestData({
                    target: 'product_stream',
                    target_args: { product: 'p' },
                }),
            (err) => err.code === 'input_error' && /target_args.product_stream/.test(err.message),
        );
        assert.throws(
            () =>
                buildApiRequestData({
                    target: 'product_stream',
                    target_args: { product_stream: 's' },
                }),
            (err) => err.code === 'input_error' && /target_args.product/.test(err.message),
        );
    });

    it('builds a property target', () => {
        const data = buildApiRequestData({
            target: 'property',
            target_args: { property: 'config' },
        });
        assert.equal(data.target, 'property');
        assert.equal(data.property, 'config');
    });

    it('rejects an unknown target', () => {
        assert.throws(
            () => buildApiRequestData({ target: 'wormhole' }),
            (err) => err.code === 'input_error' && /Invalid target/.test(err.message),
        );
    });
});

describe('buildApiResponseData', () => {
    it('defaults to { payload_type: "none" } when nothing is supplied', () => {
        assert.deepEqual(buildApiResponseData(), { payload_type: 'none' });
        assert.deepEqual(buildApiResponseData(null), { payload_type: 'none' });
        assert.deepEqual(buildApiResponseData({}), { payload_type: 'none' });
    });

    it('forwards the supplied fields verbatim', () => {
        const data = buildApiResponseData({
            payload_type: 'source_payload',
            source: 'request_response',
            payload_function: 'parse_stdout',
        });
        assert.deepEqual(data, {
            payload_type: 'source_payload',
            source: 'request_response',
            payload_function: 'parse_stdout',
        });
    });

    it('rejects unknown payload_type', () => {
        assert.throws(
            () => buildApiResponseData({ payload_type: 'magic' }),
            (err) =>
                err.code === 'input_error' && /Invalid response\.payload_type/.test(err.message),
        );
    });
});

describe('exported constants', () => {
    it('expose the canonical sources / targets / payload types', () => {
        assert.deepEqual(PROFILE_DATA_SOURCES, [
            'resource',
            'resource_stream',
            'product_stream',
            'topic',
            'event',
        ]);
        assert.ok(PROFILE_API_TARGETS.includes('resource_stream'));
        assert.ok(PROFILE_PAYLOAD_TYPES.includes('source_payload'));
    });
});

// ─── HTTP-mocked tests ─────────────────────────────────────────────

describe('getProductApiResources / getProductApiResource', () => {
    beforeEach(() => setupBackend());

    it('returns an empty map on 404', async () => {
        const map = await getProductApiResources('p', USER);
        assert.deepEqual(map, {});
    });

    it('reads a stored map', async () => {
        setupBackend({
            [`/v1/users/${USER}/products/p/profile/api`]: {
                backup_complete: { enabled: true },
            },
        });
        const map = await getProductApiResources('p', USER);
        assert.deepEqual(map, { backup_complete: { enabled: true } });
    });

    it('reads a single resource', async () => {
        setupBackend({
            [`/v1/users/${USER}/products/p/profile/api/backup_complete`]: {
                enabled: true,
                request: { data: { target: 'resource_stream' } },
            },
        });
        const def = await getProductApiResource('p', 'backup_complete', USER);
        assert.equal(def.enabled, true);
        assert.equal(def.request.data.target, 'resource_stream');
    });
});

describe('setProductApiResource / deleteProductApiResource', () => {
    it('PUTs the payload at the resource URL', async () => {
        const { state } = setupBackend();
        await setProductApiResource('p', 'foo', USER, { enabled: true });
        const url = `/v1/users/${USER}/products/p/profile/api/foo`;
        assert.deepEqual(state.get(url), { enabled: true });
    });

    it('DELETE returns true when present, false on 404', async () => {
        const url = `/v1/users/${USER}/products/p/profile/api/foo`;
        setupBackend({ [url]: { enabled: true } });
        assert.equal(await deleteProductApiResource('p', 'foo', USER), true);
        assert.equal(await deleteProductApiResource('p', 'foo', USER), false);
    });
});

describe('setProfileApiResource (high-level)', () => {
    it('reproduces the canonical backup_complete shape', async () => {
        const { state } = setupBackend();
        const url = `/v1/users/${USER}/products/p/profile/api/backup_complete`;
        await setProfileApiResource('p', 'backup_complete', USER, {
            target: 'resource_stream',
            payload_type: 'source_payload',
            response: { payload_type: 'none' },
        });
        const sent = state.get(url);
        assert.equal(sent.enabled, true);
        assert.deepEqual(sent.request.data, {
            target: 'resource_stream',
            resource_stream: 'backup_complete',
            payload_type: 'source_payload',
        });
        assert.deepEqual(sent.response.data, { payload_type: 'none' });
    });

    it('falls back to fire-and-forget response by default', async () => {
        const { state } = setupBackend();
        const url = `/v1/users/${USER}/products/p/profile/api/notify`;
        await setProfileApiResource('p', 'notify', USER, {
            target: 'resource',
            target_args: { resource: 'cmd' },
        });
        const sent = state.get(url);
        assert.deepEqual(sent.response.data, { payload_type: 'none' });
    });
});

describe('setProfileBucket (high-level)', () => {
    it('reproduces the canonical backups bucket shape', async () => {
        const { state } = setupBackend();
        const url = `/v1/users/${USER}/products/p/profile/buckets/backups`;
        await setProfileBucket('p', 'backups', USER, {
            source: 'resource_stream',
            source_args: { resource_stream: 'backup_complete' },
            payload_type: 'source_payload',
            payload: '{{payload}}',
            retention: { period: 1, unit: 'years' },
        });
        const sent = state.get(url);
        assert.equal(sent.enabled, true);
        assert.equal(sent.backend, 'mongodb');
        assert.deepEqual(sent.data, {
            source: 'resource_stream',
            resource_stream: 'backup_complete',
            payload_type: 'source_payload',
            payload: '{{payload}}',
        });
        assert.deepEqual(sent.retention, { period: 1, unit: 'years' });
        assert.deepEqual(sent.tags, []);
    });

    it('rejects an invalid retention.unit', async () => {
        setupBackend();
        await assert.rejects(
            setProfileBucket('p', 'b', USER, {
                source: 'resource_stream',
                source_args: { resource_stream: 's' },
                retention: { period: 1, unit: 'eons' },
            }),
            (err) => err.code === 'input_error' && /retention\.unit/.test(err.message),
        );
    });
});

describe('setProfileProperty (high-level)', () => {
    it('reproduces the canonical backups property handler shape', async () => {
        const { state } = setupBackend();
        const url = `/v1/users/${USER}/products/p/profile/properties/backups`;
        await setProfileProperty('p', 'backups', USER, {
            source: 'resource_stream',
            source_args: { resource_stream: 'backup_complete' },
            payload_type: 'source_payload',
            payload: '{{payload}}',
        });
        const sent = state.get(url);
        assert.equal(sent.enabled, true);
        assert.deepEqual(sent.data, {
            source: 'resource_stream',
            resource_stream: 'backup_complete',
            payload_type: 'source_payload',
            payload: '{{payload}}',
        });
        // No backend / retention / tags on property handlers.
        assert.equal(sent.backend, undefined);
        assert.equal(sent.retention, undefined);
        assert.equal(sent.tags, undefined);
        // No patch when not requested.
        assert.equal(sent.data.patch, undefined);
    });

    it('persists the patch flag when requested', async () => {
        const { state } = setupBackend();
        const url = `/v1/users/${USER}/products/p/profile/properties/state`;
        await setProfileProperty('p', 'state', USER, {
            source: 'event',
            source_args: { event: 'something' },
            patch: true,
        });
        assert.equal(state.get(url).data.patch, true);
    });
});

describe('bucket / profile-property low-level CRUD', () => {
    it('list, get, set, delete go through the right URLs', async () => {
        const baseUrl = `/v1/users/${USER}/products/p/profile/buckets`;
        const { state } = setupBackend({
            [baseUrl]: { existing: { enabled: true } },
            [`${baseUrl}/existing`]: { enabled: true },
        });
        const map = await getProductBuckets('p', USER);
        assert.deepEqual(map, { existing: { enabled: true } });
        const single = await getProductBucket('p', 'existing', USER);
        assert.deepEqual(single, { enabled: true });
        await setProductBucket('p', 'fresh', USER, { enabled: true });
        assert.equal(state.has(`${baseUrl}/fresh`), true);
        assert.equal(await deleteProductBucket('p', 'fresh', USER), true);
        assert.equal(await deleteProductBucket('p', 'fresh', USER), false);
    });

    it('profile property low-level mirrors bucket low-level', async () => {
        const baseUrl = `/v1/users/${USER}/products/p/profile/properties`;
        const { state } = setupBackend();
        await setProductProfileProperty('p', 'h', USER, { enabled: true });
        assert.equal(state.has(`${baseUrl}/h`), true);
        await assert.rejects(
            getProductProfileProperty('p', 'missing', USER),
            (err) => err.code === 'not_found',
        );
        // Get-list returns {} when missing.
        const map = await getProductProfileProperties('p', USER);
        // baseUrl wasn't seeded, so {}.
        assert.deepEqual(map, {});
        assert.equal(await deleteProductProfileProperty('p', 'h', USER), true);
        assert.equal(await deleteProductProfileProperty('p', 'h', USER), false);
    });
});
