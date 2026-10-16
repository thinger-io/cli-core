// @ts-check
import { createHash } from 'node:crypto';
import { readConfig, serverURL } from './config.js';
import { previewUrl, replaceToken } from './dashboard.js';
import { checkSdk } from './dashboard-sdk.js';
import { inputError } from './errors.js';

/**
 * Local development of url-source dashboards: the app runs on its own dev
 * server (ng serve, Vite…) and is opened directly, as a standalone page,
 * with a link whose fragment carries the server (`thinger_api`), a
 * temporary access token and the SDK context. The SDK calls the server
 * itself (it answers CORS from any origin), so the app gets real data with
 * its dev server's reload and the browser's own tools. The app bundles the
 * SDK (an npm dependency), so its dev server needs no proxy.
 *
 * Unlike in the console, the page is not in a sandboxed iframe: what only
 * fails there (localStorage, cookies, a <base> tag) does not fail here.
 */

const CONTEXT_FIELDS = ['device', 'product', 'type', 'group', 'project'];
const ID_RE = /^[a-zA-Z0-9_-]{1,32}$/;
export const DEV_HOURS = 8;
const CHECK_TIMEOUT_MS = 3000;

/**
 * The SDK context of a dev link, checked.
 *
 * @param {Record<string, string | undefined>} [context]
 * @returns {Record<string, string>}
 */
export function checkContext(context = {}) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const [key, id] of Object.entries(context)) {
        if (id === undefined || id === null || id === '') continue;
        if (!CONTEXT_FIELDS.includes(key)) {
            throw inputError(`context keys are ${CONTEXT_FIELDS.join(', ')}; got "${key}"`);
        }
        if (typeof id !== 'string' || !ID_RE.test(id)) {
            throw inputError(`invalid ${key} id: "${id}"`);
        }
        out[key] = id;
    }
    return out;
}

/**
 * Token id of dev links: one per project, so a new link replaces the
 * previous one instead of piling up tokens.
 *
 * @param {string} [project]
 */
export function devTokenId(project) {
    if (!project) return 'dashboard_dev';
    const readable = `dashboard_dev_${project}`;
    if (readable.length <= 32) return readable;
    return `dashboard_dev_${createHash('sha1').update(project).digest('hex').slice(0, 18)}`;
}

/** A host of this machine: localhost, *.localhost, 127.0.0.0/8, [::1]. */
export function isLoopback(hostname) {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host === '::1' ||
        /^127(\.\d{1,3}){3}$/.test(host)
    );
}

/**
 * The app's url, checked: http(s), no credentials in it, and on this
 * machine unless `allowRemote`: the link carries a full-access token, and
 * the url may come from a manifest of someone else's repository.
 *
 * @param {string} url
 * @param {{ allowRemote?: boolean }} [opts]
 */
export function checkAppUrl(url, { allowRemote = false } = {}) {
    let parsed;
    try {
        parsed = new URL(String(url));
    } catch {
        throw inputError(`pass the url of the app's dev server, e.g. http://localhost:4200/`);
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
        throw inputError(`the app's url must be http(s) without credentials: ${url}`);
    }
    if (!allowRemote && !isLoopback(parsed.hostname)) {
        throw inputError(
            `${parsed.host} is not this machine: the link would give it a full-access token. Pass allow remote (--allow-remote) only for a dev server you trust`,
        );
    }
    return parsed;
}

/** GET with a short timeout: status and text, or the reason it failed. */
async function probe(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
        return { status: res.status, text: await res.text() };
    } catch (e) {
        return { error: e?.cause?.code || e?.name || String(e) };
    }
}

/**
 * Notes on the app as its dev server serves it: whether it answers, and its
 * page for the SDK check. Never an error: the link works once the dev
 * server runs.
 *
 * @param {URL} app
 * @returns {Promise<{ notes: string[], html?: string }>}
 */
export async function checkApp(app) {
    const page = await probe(`${app.origin}${app.pathname}${app.search}`);
    if (page.error || page.status >= 400) {
        return {
            notes: [
                `Nothing serves the app at ${app.origin}${app.pathname} (${page.error || `HTTP ${page.status}`}): start its dev server, then open the link.`,
            ],
        };
    }
    return { notes: [], html: page.text };
}

/**
 * A link that opens the app on its dev server against the profile's server,
 * with a temporary token (full access to the account, or to the project
 * with a project context) valid for `hours`. A new link replaces the
 * previous one's token.
 *
 * @param {{ url: string, context?: Record<string, string | undefined>, route?: string,
 *   hours?: number, user?: string | null, check?: boolean, dir?: string, allowRemote?: boolean }} opts
 *   `dir`: the app's project folder, to check the SDK it is built with.
 */
export async function devLink({
    url,
    context: raw,
    route,
    hours = DEV_HOURS,
    user,
    check = true,
    dir,
    allowRemote = false,
}) {
    const app = checkAppUrl(url, { allowRemote });
    const context = checkContext(raw);
    if (!(hours > 0 && hours <= 24 * 7)) throw inputError('hours is between 0 and 168');
    const config = readConfig();
    const server = serverURL(config.server);
    if (!server || !config.token) throw inputError('no server configured: sign in first');

    let notes = [];
    if (check) {
        const { notes: served, html } = await checkApp(app);
        const files = html === undefined ? {} : { 'index.html': html };
        notes = [...served, ...(await checkSdk({ dir, files }))];
    }
    const { token, accessToken, expire } = await replaceToken(devTokenId(context.project), {
        name: 'Dashboard dev (temporary)',
        allow: { '*': { '*': '*' } },
        hours,
        project: context.project,
        user,
    });
    const hash = route ?? app.hash.replace(/^#/, '');
    const base = `${app.origin}${app.pathname}${app.search}${hash ? `#${hash}` : ''}`;
    return {
        link: previewUrl(base, accessToken, { api: server, ...context }),
        app: `${app.origin}${app.pathname}`,
        server,
        user: user || config.username,
        context,
        token,
        expire,
        notes,
    };
}
