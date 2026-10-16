// @ts-check
import './setup.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
    configExists,
    getActiveProfile,
    readConfig,
    requireConfig,
    setActiveProfile,
    withActiveProfile,
    writeConfig,
} from '../lib/config.js';
import {
    destinationContext,
    parseDestination,
    publishSummary,
    readManifest,
} from '../lib/dashboard.js';
import {
    checkAppUrl,
    checkContext,
    devLink,
    devTokenId,
    isLoopback,
} from '../lib/dashboard-dev.js';
import { previewUrl } from '../lib/dashboard.js';

const jwt = (payload) =>
    `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('dashboard dev helpers', () => {
    it('checks the context keys and ids', () => {
        assert.deepEqual(checkContext({ device: 'gw1', product: undefined }), { device: 'gw1' });
        assert.throws(() => checkContext({ asset: 'x' }), /context keys/);
        assert.throws(() => checkContext({ device: 'a/b' }), /invalid device/);
    });

    it('takes http(s) app urls without credentials', () => {
        assert.equal(checkAppUrl('http://localhost:4200/#/x').port, '4200');
        assert.throws(() => checkAppUrl('localhost:4200'), /http\(s\)/);
        assert.throws(() => checkAppUrl('ftp://localhost/'), /http\(s\)/);
        assert.throws(() => checkAppUrl('http://u:p@localhost/'), /without credentials/);
    });

    it('keeps the full-access link on this machine unless allowed', () => {
        for (const host of ['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]']) {
            assert.ok(isLoopback(new URL(`http://${host}:5173/`).hostname), host);
        }
        for (const host of ['attacker.example', '10.0.0.5', 'localhost.evil.com']) {
            assert.throws(() => checkAppUrl(`http://${host}/`), /not this machine/, host);
        }
        assert.equal(
            checkAppUrl('https://dev.example.com/', { allowRemote: true }).host,
            'dev.example.com',
        );
    });

    it('lets no route add parameters to the fragment', () => {
        assert.throws(
            () => previewUrl('http://x/#/a&thinger_api=https://evil', 'T'),
            /no "&" or "#"/,
        );
        assert.equal(previewUrl('http://x/#/a', 'T'), 'http://x/#/a&thinger_token=T');
    });

    it('keeps one token per project', () => {
        assert.equal(devTokenId(), 'dashboard_dev');
        assert.equal(devTokenId('plant'), 'dashboard_dev_plant');
        const long = devTokenId('a_project_with_a_long_name');
        assert.ok(long.length <= 32);
        assert.equal(long, devTokenId('a_project_with_a_long_name'));
    });
});

describe('dashboard destinations and manifest', () => {
    it('parses kind:id destinations', () => {
        assert.deepEqual(parseDestination('dashboard:sales'), { dashboard: 'sales' });
        assert.deepEqual(parseDestination('asset_group:plant'), {
            type: 'asset_group',
            id: 'plant',
        });
        assert.throws(() => parseDestination('bucket:x'), /destination/);
        assert.throws(() => parseDestination('device'), /destination/);
    });

    it('maps a destination to the context its app gets', () => {
        assert.deepEqual(destinationContext({ type: 'asset_type', id: 'pump' }), { type: 'pump' });
        assert.deepEqual(destinationContext({ dashboard: 'sales' }), {});
    });

    it('reads the dashboard section, with dir relative to the manifest', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'));
        const file = path.join(dir, 'acme.json');
        fs.writeFileSync(
            file,
            JSON.stringify({ dashboard: { dir: 'dist', to: [{ type: 'device', id: 'gw1' }] } }),
        );
        const m = readManifest(file);
        assert.equal(m.dir, path.join(dir, 'dist'));
        assert.deepEqual(m.to, [{ type: 'device', id: 'gw1' }]);
        fs.writeFileSync(
            file,
            JSON.stringify({ dashboard: { to: [{ type: 'bucket', id: 'x' }] } }),
        );
        assert.throws(() => readManifest(file), /type must be one of/);
        assert.equal(readManifest(), null); // no acme.json in the working folder
    });

    it('summarises a publish', () => {
        const text = publishSummary({
            storage: 'app_x',
            storageCreated: true,
            uploaded: ['index.html'],
            deleted: [],
            pointed: [
                {
                    to: 'device gw1',
                    url: '/v1/…/files/',
                    open: 'https://s/console/devices/gw1/dashboard',
                },
            ],
            previews: [],
        });
        assert.match(text, /Uploaded 1 file\(s\) to new public storage app_x\./);
        assert.match(text, /device gw1 → /);
    });
});

describe('profile from the environment', () => {
    after(() => {
        delete process.env.ACME_TOKEN;
        delete process.env.ACME_SERVER;
    });

    it('applies when no profile is named, with the user from the token', () => {
        process.env.ACME_TOKEN = jwt({ usr: 'ci-bot' });
        process.env.ACME_SERVER = 'ci.example.com';
        assert.ok(configExists());
        const config = readConfig();
        assert.equal(config.username, 'ci-bot');
        assert.equal(config.server, 'ci.example.com');
        assert.equal(getActiveProfile(), null);
    });

    it('says what is missing without a server, and lookups keep working', () => {
        process.env.ACME_TOKEN = jwt({ usr: 'ci-bot' });
        delete process.env.ACME_SERVER;
        assert.equal(getActiveProfile(), null);
        assert.throws(() => requireConfig(), /ACME_TOKEN is set without ACME_SERVER/);
        process.env.ACME_SERVER = 'ci.example.com';
    });

    it('gives way to a named profile', () => {
        process.env.ACME_TOKEN = jwt({ usr: 'ci-bot' });
        setActiveProfile('saved');
        writeConfig({ server: 'saved.example.com', username: 'alice', token: 'T' });
        assert.equal(readConfig().username, 'alice');
        setActiveProfile(null);
        assert.equal(
            withActiveProfile('saved', () => readConfig().username),
            'alice',
        );
        assert.equal(readConfig().username, 'ci-bot');
    });
});

describe('dashboard dev link', () => {
    /** @type {http.Server} */
    let thinger;
    /** @type {http.Server} */
    let app;
    /** @type {string[]} */
    const calls = [];
    let serverUrl;
    let appUrl;

    const listen = async (server) => {
        await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
        const address = server.address();
        return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    };

    before(async () => {
        thinger = http.createServer((req, res) => {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
                calls.push(`${req.method} ${req.url} ${body}`);
                if (req.method === 'DELETE') return res.writeHead(404).end();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{"access_token":"TEMP"}');
            });
        });
        app = http.createServer((req, res) => {
            // an SPA dev server answers its index for every path
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><script src="/sdk/0.1/thinger-dashboard.js"></script></html>');
        });
        serverUrl = await listen(thinger);
        appUrl = await listen(app);
        setActiveProfile('devtest');
        writeConfig({ server: serverUrl, username: 'alice', token: 'REAL' });
    });

    after(() => {
        setActiveProfile(null);
        thinger?.close();
        app?.close();
    });

    it('replaces the dev token and puts server, token and context in the fragment', async () => {
        const dev = await devLink({ url: `${appUrl}/#/devices`, context: { device: 'gw1' } });
        const mint = calls.find((c) => c.startsWith('POST /v1/users/alice/tokens'));
        assert.ok(calls.some((c) => c.startsWith('DELETE /v1/users/alice/tokens/dashboard_dev ')));
        const body = JSON.parse(mint.slice(mint.indexOf('{')));
        assert.equal(body.token, 'dashboard_dev');
        assert.deepEqual(body.allow, { '*': { '*': '*' } });
        assert.ok(body.expire > Date.now());
        const [base, fragment] = dev.link.split('#');
        assert.equal(base, `${appUrl}/`);
        const params = new URLSearchParams(fragment.slice(fragment.indexOf('&') + 1));
        assert.ok(fragment.startsWith('/devices&'));
        assert.equal(params.get('thinger_api'), serverUrl);
        assert.equal(params.get('thinger_token'), 'TEMP');
        assert.equal(params.get('thinger_device'), 'gw1');
        assert.doesNotMatch(dev.link, /REAL/);
        // the fake app loads the script build, which dev flags too
        assert.deepEqual(dev.notes.length, 1);
        assert.match(dev.notes[0], /^index\.html loads the SDK's script build/);
    });

    it('says when nothing serves the app, and still gives the link', async () => {
        const dev = await devLink({ url: 'http://127.0.0.1:9/' });
        assert.match(dev.notes[0], /Nothing serves the app/);
        assert.match(dev.link, /thinger_token=TEMP/);
    });
});
