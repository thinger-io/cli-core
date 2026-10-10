import { testIdentity } from './setup.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import api from '../lib/api.js';
import { defineIdentity } from '../lib/identity.js';
import { createProduct } from '../lib/product.js';

let calls;
function setupBackend() {
    calls = [];
    api.post = async (path, body) => {
        calls.push({ path, body });
        return { data: {} };
    };
}

describe('createProduct', () => {
    beforeEach(setupBackend);
    after(() => defineIdentity(testIdentity));

    it('sends a bare product when the CLI has no template', async () => {
        await createProduct('meteo', 'acme');
        assert.equal(calls[0].path, '/v1/users/acme/products');
        assert.deepEqual(calls[0].body, {
            product: 'meteo',
            name: 'meteo',
            description: '',
            enabled: true,
        });
    });

    it('fills in what the caller leaves out from the template', async () => {
        defineIdentity({
            ...testIdentity,
            productTemplate: {
                description: 'Acme product',
                config: { type: 'acme', icons: ['default'] },
                profile: { buckets: { metrics: { enabled: true } } },
            },
        });
        await createProduct('meteo', 'acme', { config: { icons: ['mine'] } });
        assert.deepEqual(calls[0].body, {
            product: 'meteo',
            name: 'meteo',
            description: 'Acme product',
            enabled: true,
            config: { type: 'acme', icons: ['mine'] },
            profile: { buckets: { metrics: { enabled: true } } },
        });

        // An explicit profile replaces the template's whole.
        await createProduct('bare', 'acme', { profile: { api: {} } });
        assert.deepEqual(calls[1].body.profile, { api: {} });
    });
});
