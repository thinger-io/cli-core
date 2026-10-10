import { testIdentity } from './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineIdentity, env, identity, loginHint } from '../lib/identity.js';

describe('identity', () => {
    it('is the one the CLI defined', () => {
        assert.equal(identity().name, 'acme');
        assert.equal(identity().configDir, 'acme-cli');
        assert.equal(loginHint(), 'Run `acme login` to sign in.');
    });

    it('reads environment variables under its own prefix', () => {
        process.env.ACME_INSECURE = '1';
        process.env.OTHER_INSECURE = '0';
        try {
            assert.equal(env('INSECURE'), '1');
        } finally {
            delete process.env.ACME_INSECURE;
            delete process.env.OTHER_INSECURE;
        }
    });

    it('rejects a token id the server would refuse', () => {
        assert.throws(
            () => defineIdentity({ ...testIdentity, token: { id: 'Acme CLI', name: 'x' } }),
            /token id/,
        );
        // The failed definition must not replace the current one.
        assert.equal(identity().token.id, 'acme_cli');
    });

    it('rejects a missing field', () => {
        assert.throws(() => defineIdentity({ ...testIdentity, configDir: '' }), /configDir/);
    });

    it('is frozen, product template included', () => {
        const id = defineIdentity({
            ...testIdentity,
            productTemplate: { config: { type: 'acme' } },
        });
        try {
            assert.throws(() => {
                identity().productTemplate.config.type = 'other';
            });
            assert.equal(id.productTemplate.config.type, 'acme');
        } finally {
            defineIdentity(testIdentity);
        }
    });
});
