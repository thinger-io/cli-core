// @ts-check
import './setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import api from '../lib/api.js';
import {
    callDeviceResource,
    getDeviceResourceApi,
    getDeviceResources,
    listDeviceResourcesWithSchemas,
    readDeviceResource,
} from '../lib/resource.js';
import { getDeviceProperties, getDeviceProperty, setDeviceProperty } from '../lib/property.js';
import { createDevice, getDevice, getDevices } from '../lib/devices.js';
import { getBucketData, getBuckets } from '../lib/bucket.js';

const DEVICE = 'edge-gw-17';
const OWNER = { user: 'acme' };

let calls;

function setupBackend() {
    calls = [];
    api.get = async (path) => {
        calls.push({ method: 'GET', path });
        return { data: { monitoring: { fn: 3 }, '$scripts/info': { fn: 3 } } };
    };
    api.post = async (path, body) => {
        calls.push({ method: 'POST', path, body });
        return { data: { ok: true } };
    };
    api.put = async (path, body) => {
        calls.push({ method: 'PUT', path, body });
        return { data: { ok: true } };
    };
}

// Every helper here must address the account that owns the device, not the
// one the active profile belongs to, or an admin acting on behalf of another
// account reaches the wrong URL and the API answers "not found".
describe('resource helpers address the requested account', () => {
    beforeEach(setupBackend);

    it('getDeviceResources', async () => {
        await getDeviceResources(DEVICE, OWNER);
        assert.equal(calls[0].path, `/v3/users/acme/devices/${DEVICE}/resources/api`);
    });

    it('readDeviceResource', async () => {
        await readDeviceResource(DEVICE, 'monitoring', OWNER);
        assert.equal(calls[0].path, `/v3/users/acme/devices/${DEVICE}/resources/monitoring`);
    });

    it('getDeviceResourceApi', async () => {
        await getDeviceResourceApi(DEVICE, 'monitoring', OWNER);
        assert.equal(calls[0].path, `/v3/users/acme/devices/${DEVICE}/resources/monitoring/api`);
    });

    it('callDeviceResource reads with GET when there are no inputs', async () => {
        await callDeviceResource(DEVICE, 'monitoring', null, OWNER);
        assert.equal(calls[0].method, 'GET');
        assert.equal(calls[0].path, `/v3/users/acme/devices/${DEVICE}/resources/monitoring`);
    });

    it('callDeviceResource posts the inputs when there are any', async () => {
        await callDeviceResource(DEVICE, '$scripts/reload', { force: true }, OWNER);
        assert.equal(calls[0].method, 'POST');
        assert.equal(calls[0].path, `/v3/users/acme/devices/${DEVICE}/resources/$scripts/reload`);
        assert.deepEqual(calls[0].body, { force: true });
    });

    it('listDeviceResourcesWithSchemas carries the account into every schema lookup', async () => {
        await listDeviceResourcesWithSchemas(DEVICE, OWNER);
        assert.ok(calls.length > 1, 'expected a listing plus per-resource schema lookups');
        for (const call of calls) {
            assert.ok(
                call.path.startsWith('/v3/users/acme/'),
                `${call.path} should be addressed to acme`,
            );
        }
    });
});

describe('device properties address the requested account', () => {
    beforeEach(setupBackend);

    it('getDeviceProperties', async () => {
        await getDeviceProperties(DEVICE, OWNER.user);
        assert.equal(calls[0].path, `/v3/users/acme/devices/${DEVICE}/properties`);
    });

    it('getDeviceProperty', async () => {
        await getDeviceProperty(DEVICE, 'uptime', OWNER.user);
        assert.equal(calls[0].path, `/v3/users/acme/devices/${DEVICE}/properties/uptime`);
    });

    it('setDeviceProperty', async () => {
        await setDeviceProperty(DEVICE, 'uptime', 42, OWNER.user);
        assert.equal(calls[0].method, 'PUT');
        assert.equal(calls[0].path, `/v3/users/acme/devices/${DEVICE}/properties/uptime`);
        assert.deepEqual(calls[0].body, { value: 42 });
    });
});

describe('device records address the requested account', () => {
    beforeEach(setupBackend);

    it('getDevices', async () => {
        // The listing answers with a resource map in this stub, whose
        // length (0) ends the paging loop after the first request.
        await getDevices({ name: 'gw' }, OWNER.user);
        assert.ok(calls[0].path.startsWith('/v1/users/acme/devices?'));
        assert.match(calls[0].path, /name=gw&/);
    });

    it('getDevice', async () => {
        await getDevice(DEVICE, OWNER.user);
        assert.equal(calls[0].path, `/v1/users/acme/devices/${DEVICE}`);
    });

    it('createDevice drops empty optional fields', async () => {
        await createDevice(
            { device: DEVICE, type: 'HTTP', description: '', name: undefined },
            'acme',
        );
        assert.equal(calls[0].path, '/v1/users/acme/devices');
        assert.deepEqual(calls[0].body, { device: DEVICE, type: 'HTTP' });
    });
});

describe('buckets address the requested account', () => {
    beforeEach(setupBackend);

    it('getBuckets', async () => {
        await getBuckets(OWNER.user);
        assert.equal(calls[0].path, '/v1/users/acme/buckets');
    });

    it('getBucketData reads the account bucket without a device', async () => {
        await getBucketData({ bucket: 'weather', user: 'acme' });
        assert.equal(calls[0].path, '/v2/users/acme/buckets/weather/data');
    });

    it('getBucketData reads the device series with a device', async () => {
        await getBucketData({ bucket: 'weather', device: DEVICE, user: 'acme' });
        assert.equal(calls[0].path, `/v3/users/acme/devices/${DEVICE}/buckets/weather/data`);
    });
});
