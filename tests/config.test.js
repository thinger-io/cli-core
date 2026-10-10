import './setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    deleteConfig,
    getActiveProfile,
    profileNameFor,
    readConfig,
    serverURL,
    serverWebSocketURL,
    setActiveProfile,
    withActiveProfile,
    writeConfig,
} from '../lib/config.js';
import api from '../lib/api.js';

const CONFIG = () => path.join(os.homedir(), '.config', 'acme-cli', 'config.json');

function seed() {
    setActiveProfile('prod');
    writeConfig({ server: 'prod.example.com', username: 'alice', token: 'T-prod' });
    setActiveProfile('lab');
    writeConfig({ server: 'http://localhost:8080', username: 'bob', token: 'T-lab' });
    setActiveProfile(null);
}

describe('profiles', () => {
    beforeEach(() => {
        deleteConfig();
        setActiveProfile(null);
        delete process.env.ACME_PROFILE;
        seed();
    });

    it('live under the identity folder, readable by the owner only', () => {
        assert.ok(fs.existsSync(CONFIG()));
        assert.equal(fs.statSync(CONFIG()).mode & 0o777, 0o600);
        assert.deepEqual(fs.readdirSync(path.join(os.homedir(), '.config')), ['acme-cli']);
    });

    it('default to the first one written', () => {
        assert.equal(getActiveProfile(), 'prod');
        assert.equal(readConfig().username, 'alice');
    });

    it('honour <PREFIX>_PROFILE, and only that prefix', () => {
        process.env.OTHER_PROFILE = 'lab';
        assert.equal(getActiveProfile(), 'prod');
        process.env.ACME_PROFILE = 'lab';
        assert.equal(getActiveProfile(), 'lab');
        delete process.env.OTHER_PROFILE;
    });

    it('scope a profile to one async call chain without leaking into another', async () => {
        const seen = await Promise.all([
            withActiveProfile('lab', async () => {
                await new Promise((r) => setTimeout(r, 10));
                return readConfig().username;
            }),
            withActiveProfile('prod', async () => readConfig().username),
            (async () => {
                await new Promise((r) => setTimeout(r, 5));
                return readConfig().username;
            })(),
        ]);
        assert.deepEqual(seen, ['bob', 'alice', 'alice']);
        assert.equal(getActiveProfile(), 'prod');
    });
});

describe('profile names', () => {
    it('default to the host of the server, without scheme', () => {
        assert.equal(profileNameFor('acme.aws.thinger.io'), 'acme.aws.thinger.io');
        assert.equal(profileNameFor('http://localhost:8080'), 'localhost:8080');
        assert.equal(profileNameFor(undefined), null);
    });
});

describe('server URLs', () => {
    it('default to https for a bare host and keep an explicit scheme', () => {
        assert.equal(serverURL('acme.aws.thinger.io'), 'https://acme.aws.thinger.io');
        assert.equal(serverURL('http://localhost:8080/'), 'http://localhost:8080');
        assert.equal(serverURL(undefined), undefined);
    });

    it('map to ws:// or wss:// for WebSockets', () => {
        assert.equal(serverWebSocketURL('acme.aws.thinger.io'), 'wss://acme.aws.thinger.io');
        assert.equal(serverWebSocketURL('http://localhost:8080'), 'ws://localhost:8080');
    });
});

describe('api requests', () => {
    // Run the request interceptor the way axios would, without a network.
    const intercept = (config) =>
        api.interceptors.request.handlers[0].fulfilled({ headers: {}, ...config });

    beforeEach(() => {
        deleteConfig();
        setActiveProfile(null);
        seed();
    });

    it('take server and token from the profile active for the call', async () => {
        const prod = await intercept({ url: '/v1/users/alice/devices' });
        assert.equal(prod.baseURL, 'https://prod.example.com');
        assert.equal(prod.headers.Authorization, 'Bearer T-prod');

        const lab = await withActiveProfile('lab', () =>
            intercept({ url: '/v1/users/bob/devices' }),
        );
        assert.equal(lab.baseURL, 'http://localhost:8080');
        assert.equal(lab.headers.Authorization, 'Bearer T-lab');
    });

    it('keep an Authorization header the caller set (token probes at login)', async () => {
        const req = await intercept({ url: '/x', headers: { Authorization: 'Bearer probe' } });
        assert.equal(req.headers.Authorization, 'Bearer probe');
    });
});
