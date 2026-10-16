// @ts-check
import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    checkSdk,
    compareVersions,
    installedSdk,
    numeric,
    sdkNotes,
} from '../lib/dashboard-sdk.js';

const sdk = (version, compat = { baseServer: '7.5', functions: {} }) => ({ version, compat });

describe('dashboard SDK compatibility', () => {
    it('compares the numeric part of versions', () => {
        assert.equal(numeric('7.3.4-152-g308cf54a-develop'), '7.3.4');
        assert.ok(compareVersions('7.3.4-152-develop', '7.5') < 0);
        assert.ok(compareVersions('0.9.0', '0.10.0') < 0);
        assert.equal(compareVersions('7.5', '7.5.0'), 0);
    });

    it('says nothing when the server and the SDK are current', () => {
        assert.deepEqual(sdkNotes(sdk('0.3.0'), '7.5.1', '0.2.0'), []);
        assert.deepEqual(sdkNotes(sdk('0.3.0'), null, null), []);
    });

    it('warns below the base server, and names the calls a server lacks', () => {
        const [base] = sdkNotes(sdk('0.3.0'), '7.3.4-159-develop', null);
        assert.match(
            base,
            /reports 7\.3\.4, older than Thinger 7\.5, the base of SDK 0\.3\.0: the app runs/,
        );
        assert.doesNotMatch(base, /will not work/);
        const notes = sdkNotes(
            sdk('0.3.1', {
                baseServer: '7.5',
                functions: { 'alarms.rules.get': '7.6', 'devices.list': '7.5' },
            }),
            '7.5.2',
            null,
        );
        assert.deepEqual(notes, [
            "alarms.rules.get requires Thinger 7.6 or later (this server is 7.5.2): the app's calls to it fail here.",
        ]);
    });

    it('flags an SDK the console gives no token to', () => {
        const [note] = sdkNotes(sdk('0.2.1'), '7.5', null);
        assert.match(note, /0\.2\.1: inside the console it gets no token/);
        assert.match(note, /npm install @thinger-io\/dashboard-sdk@\^0\.3\.0/);
    });

    it('points an outdated SDK at the latest release', () => {
        const [note] = sdkNotes(sdk('0.3.0'), null, '0.3.1');
        assert.match(note, /uses @thinger-io\/dashboard-sdk 0\.3\.0; the latest is 0\.3\.1/);
        assert.match(note, /npm install @thinger-io\/dashboard-sdk@\^0\.3\.1/);
    });

    it('finds the installed package from a build folder up', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkapp-'));
        const pkg = path.join(root, 'node_modules', '@thinger-io', 'dashboard-sdk');
        fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(pkg, 'package.json'), '{"version":"0.3.0"}');
        fs.writeFileSync(
            path.join(pkg, 'dist', 'compat.json'),
            '{"baseServer":"7.5","functions":{}}',
        );
        fs.mkdirSync(path.join(root, 'dist', 'app'), { recursive: true });
        assert.deepEqual(installedSdk(path.join(root, 'dist', 'app')), sdk('0.3.0'));
        assert.equal(installedSdk(os.tmpdir()), null);
    });

    it('flags pages on the deprecated script build', async () => {
        const notes = await checkSdk({
            files: {
                'index.html': '<script src="/sdk/0.1/thinger-dashboard.js"></script>',
                'other.html': '<p>no sdk</p>',
            },
        });
        assert.equal(notes.length, 1);
        assert.match(notes[0], /^index\.html loads the SDK's script build/);
    });
});
