// Shared test setup: imported first by every test file.
//
// The core is tested under a made-up CLI identity, not under any real
// product's: that is what proves it carries no product of its own. HOME
// points at a throwaway folder so no test touches real profiles.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineIdentity } from '../lib/identity.js';

export const testIdentity = {
    name: 'acme',
    displayName: 'Acme IoT',
    description: 'CLI for Acme IoT servers',
    configDir: 'acme-cli',
    envPrefix: 'ACME',
    token: { id: 'acme_cli', name: 'Acme CLI' },
    oauth: { clientId: null },
    defaultServer: null,
    mcp: { serverName: 'acme', toolPrefix: 'acme' },
};

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-core-test-'));
delete process.env.ACME_PROFILE;
defineIdentity(testIdentity);
