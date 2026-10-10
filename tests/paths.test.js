// @ts-check
import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v1, v2, v3, device, pluginApi } from '../lib/paths.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED = ['lib'];
const BUILDER = path.join('lib', 'paths.js');

function* sourceFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* sourceFiles(full);
        else if (entry.name.endsWith('.js')) yield full;
    }
}

describe('account-scoped paths are built in one place', () => {
    // Leaving the account out of a hand-written URL still produces a valid
    // one: it works against your own account and fails only when acting on
    // behalf of another, with a "not found" that points nowhere near the
    // cause. Keeping every prefix in lib/paths.js is what makes that
    // omission impossible, so guard the rule itself.
    it('no module interpolates a user into an API path', () => {
        const offenders = [];
        for (const dir of SCANNED) {
            for (const file of sourceFiles(path.join(ROOT, dir))) {
                const relative = path.relative(ROOT, file);
                if (relative === BUILDER) continue;
                const source = fs.readFileSync(file, 'utf8');
                if (source.includes('users/${')) offenders.push(relative);
            }
        }
        assert.deepEqual(
            offenders,
            [],
            `these modules build account paths by hand instead of importing lib/paths.js:\n  ${offenders.join('\n  ')}`,
        );
    });
});

describe('path builders', () => {
    const ACCOUNT = 'acme';

    it('address the account they are given', () => {
        assert.equal(v1(ACCOUNT), '/v1/users/acme');
        assert.equal(v2(ACCOUNT), '/v2/users/acme');
        assert.equal(v3(ACCOUNT), '/v3/users/acme');
        assert.equal(device(ACCOUNT, 'edge-gw-17'), '/v3/users/acme/devices/edge-gw-17');
    });

    it('build the plugin API prefix without a version', () => {
        assert.equal(pluginApi(ACCOUNT, 'node-red'), '/users/acme/plugins/node-red');
    });

    it('build the device prefix on top of v3', () => {
        assert.ok(device(ACCOUNT, 'dev-1').startsWith(v3(ACCOUNT)));
    });
});
