// @ts-check
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import api from './api.js';

/**
 * The dashboard SDK an app is built with (`@thinger-io/dashboard-sdk`,
 * bundled into the app), against the server it is published to and the
 * latest release on npm. The package declares the oldest server it works
 * with and, per function, any newer one it needs (`compat.json`); the
 * server tells its version at `/v1/server/version`. Everything here is
 * advice: what cannot be read gives no note.
 */

export const SDK_PACKAGE = '@thinger-io/dashboard-sdk';
const REGISTRY = 'https://registry.npmjs.org';
const TIMEOUT_MS = 3000;
/** Oldest SDK the console gives a token to (per-load frame key, PROTOCOL.md "Frame key"). */
export const CONSOLE_MIN_SDK = '0.3.0';
const SCRIPT_BUILD = /<script[^>]+src=["'][^"']*thinger-dashboard(?:\.min)?\.js["']/i;

/** Numeric order of dotted versions (0.9 < 0.10); suffixes are ignored. */
export function compareVersions(a, b) {
    const x = numeric(a).split('.').map(Number);
    const y = numeric(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d) return d;
    }
    return 0;
}

/** "7.3.4-152-g308cf54a-develop" → "7.3.4". */
export function numeric(version) {
    return /^\d+(?:\.\d+)*/.exec(String(version ?? ''))?.[0] || '0';
}

/**
 * Folder of the SDK package installed for an app: searched in node_modules
 * from `dir` up (a build folder sits inside its project).
 *
 * @param {string} dir
 * @returns {string | null}
 */
export function sdkPackageDir(dir) {
    let current = path.resolve(dir);
    for (;;) {
        const pkgDir = path.join(current, 'node_modules', ...SDK_PACKAGE.split('/'));
        if (fs.existsSync(path.join(pkgDir, 'package.json'))) return pkgDir;
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

/**
 * Folder of the SDK package for the CLI's own use (its documentation):
 * the project's in the working folder, else the one the CLI installs.
 *
 * @returns {string | null}
 */
export function cliSdkPackageDir() {
    const project = sdkPackageDir(process.cwd());
    if (project) return project;
    try {
        return path.dirname(createRequire(import.meta.url).resolve(`${SDK_PACKAGE}/package.json`));
    } catch {
        return null;
    }
}

/**
 * The SDK package installed for an app: searched in node_modules from
 * `dir` up (a build folder sits inside its project).
 *
 * @param {string} dir
 * @returns {{ version: string, compat: { baseServer?: string, functions?: Record<string, string> } } | null}
 */
export function installedSdk(dir) {
    const pkgDir = sdkPackageDir(dir);
    if (!pkgDir) return null;
    try {
        const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
        let compat = {};
        try {
            compat = JSON.parse(fs.readFileSync(path.join(pkgDir, 'dist', 'compat.json'), 'utf8'));
        } catch {
            // older packages have no manifest
        }
        return typeof version === 'string' ? { version, compat } : null;
    } catch {
        return null;
    }
}

/** The server's version, or null when it cannot be read. */
async function serverVersion() {
    try {
        const res = await api.get('/v1/server/version', { timeout: TIMEOUT_MS });
        return typeof res.data?.version === 'string' ? res.data.version : null;
    } catch {
        return null;
    }
}

/** The latest SDK on npm, or null (not published, offline…). */
async function latestSdk() {
    try {
        const res = await fetch(`${REGISTRY}/${SDK_PACKAGE}/latest`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const { version } = await res.json();
        return typeof version === 'string' ? version : null;
    } catch {
        return null;
    }
}

/**
 * Notes for an installed SDK against a server version and the latest
 * release.
 *
 * @param {{ version: string, compat: { baseServer?: string, functions?: Record<string, string> } }} sdk
 * @param {string | null} server  The server's version.
 * @param {string | null} latest  The latest SDK on npm.
 * @returns {string[]}
 */
export function sdkNotes(sdk, server, latest) {
    const notes = [];
    if (compareVersions(sdk.version, CONSOLE_MIN_SDK) < 0) {
        notes.push(
            `The app uses ${SDK_PACKAGE} ${sdk.version}: inside the console it gets no token (the console needs SDK ${CONSOLE_MIN_SDK} or later). Update it: npm install ${SDK_PACKAGE}@^${CONSOLE_MIN_SDK}.`,
        );
    }
    const { baseServer, functions = {} } = sdk.compat || {};
    if (server && baseServer && compareVersions(server, baseServer) < 0) {
        notes.push(
            `The app's dashboard SDK ${sdk.version} needs Thinger ${baseServer} or later; this server runs ${numeric(server)}: the app will not work on it.`,
        );
    } else if (server) {
        const missing = Object.entries(functions)
            .filter(([, min]) => compareVersions(server, min) < 0)
            .map(([name, min]) => `${name} (${min})`);
        if (missing.length) {
            notes.push(
                `On this server (Thinger ${numeric(server)}) these SDK calls fail because they need a newer one: ${missing.join(', ')}.`,
            );
        }
    }
    if (latest && compareVersions(sdk.version, latest) < 0) {
        notes.push(
            `The app uses ${SDK_PACKAGE} ${sdk.version}; the latest is ${latest}. Its CHANGELOG.md says what changes and how to migrate: npm install ${SDK_PACKAGE}@^${latest}.`,
        );
    }
    return notes;
}

/**
 * Notes on the SDK of an app: the package found from `dir` (its project or
 * build folder) against the profile's server and npm, and pages loading
 * the deprecated script build instead.
 *
 * @param {{ dir?: string, files?: Record<string, Buffer | string> }} app
 * @returns {Promise<string[]>}
 */
export async function checkSdk({ dir, files = {} }) {
    const notes = [];
    const scripts = Object.entries(files).filter(
        ([name, content]) => /\.html?$/i.test(name) && SCRIPT_BUILD.test(String(content)),
    );
    if (scripts.length) {
        notes.push(
            `${scripts.map(([name]) => name).join(', ')} ${scripts.length === 1 ? 'loads' : 'load'} the SDK's script build (thinger-dashboard.js), which is deprecated: install ${SDK_PACKAGE} and import { Thinger } from it, so the SDK goes in the build.`,
        );
    }
    const sdk = dir ? installedSdk(dir) : null;
    if (sdk) {
        const [server, latest] = await Promise.all([serverVersion(), latestSdk()]);
        notes.push(...sdkNotes(sdk, server, latest));
    }
    return notes;
}
