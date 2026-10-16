// @ts-check
import {
    DASHBOARD_TARGETS,
    checkDestination,
    collectFiles,
    destinationContext,
    manifestName,
    publishApp,
    publishSummary,
} from '../dashboard.js';
import { devLink } from '../dashboard-dev.js';
import { DEFAULT_TEMPLATE, initApp } from '../dashboard-init.js';
import { inputError } from '../errors.js';
import { toolName } from './naming.js';

async function toolInit(args) {
    if (args.to) checkDestination(args.to);
    const r = await initApp({
        dir: args.dir,
        template: args.template,
        to: args.to,
        storage: args.storage,
        from: args.from,
        ci: args.ci,
        install: args.install,
    });
    return {
        content: [
            {
                type: 'text',
                text: [
                    `Created ${r.dir}: ${r.template} app on @thinger-io/dashboard-sdk ${r.dependency}, with ${manifestName()} (publishes ${r.build} to storage ${r.storage}${args.to ? '' : '; add destinations under dashboard.to'}) and AGENTS.md (how to develop it and the rules of the console's frame: read it).`,
                    `Next: ${r.installed ? '' : 'npm install, then '}${r.devCommand} in the background (it serves ${r.devUrl}), ${toolName('dashboard_dev')} with url ${r.devUrl}${Object.keys(r.context).length ? '' : ' and a context'} and dir ${r.dir}, open the link with browser tools; when it works, npm run build and ${toolName('dashboard_publish')} with dir ${r.dir}/${r.build}.`,
                ].join('\n'),
            },
        ],
        isError: false,
    };
}

async function toolDev(args) {
    if (!args.url) throw inputError("pass url: the app's dev server, e.g. http://localhost:4200/");
    if (args.to && args.context) throw inputError('pass to or context, not both');
    if (args.to) checkDestination(args.to);
    const dev = await devLink({
        url: args.url,
        context: args.to ? destinationContext(args.to) : args.context,
        route: args.route ?? args.to?.route,
        hours: args.hours,
        user: args.user,
        dir: args.dir || process.cwd(),
        allowRemote: args.allow_remote === true,
    });
    const ctx = Object.entries(dev.context).map(([k, v]) => `${k} ${v}`);
    const until = new Date(dev.expire).toISOString().slice(0, 16).replace('T', ' ');
    return {
        content: [
            {
                type: 'text',
                text: [
                    `Open this link in a browser: ${dev.link}`,
                    `It opens ${dev.app} as a standalone page against ${dev.server} as ${dev.user}${ctx.length ? `, context ${ctx.join(', ')}` : ''}, with a temporary token (${dev.token}, full access, until ${until} UTC; a new link replaces it). Calls reach the real server: writes are real.`,
                    ...dev.notes.map((n) => `Check: ${n}`),
                    "The app's dev server reloads it on every change; its errors are in the browser console. Unlike in the console's sandboxed iframe, localStorage, cookies and a <base> tag work here, so do not rely on them.",
                    `When it works, build it and publish the build once with ${toolName('dashboard_publish')}.`,
                ].join('\n'),
            },
        ],
        isError: false,
    };
}

async function toolPublish(args) {
    if (args.dir && args.files) throw inputError('pass dir or files, not both');
    if (args.files) {
        if (typeof args.files !== 'object' || Array.isArray(args.files)) {
            throw inputError('files must be an object of { "path": "content" }');
        }
        for (const [file, content] of Object.entries(args.files)) {
            if (typeof content !== 'string') throw inputError(`files["${file}"] must be a string`);
        }
    }
    const result = await publishApp({
        storage: args.storage,
        files: args.dir ? collectFiles(args.dir) : args.files,
        prune: args.prune,
        to: args.to,
        preview: args.preview,
        point: args.point,
        bump: args.bump,
        user: args.user,
        dir: args.dir,
    });
    return {
        content: [{ type: 'text', text: publishSummary(result, { point: args.point }) }],
        isError: false,
    };
}

export const tools = [
    {
        name: 'dashboard_init',
        description: `Create a dashboard app: a TypeScript project on @thinger-io/dashboard-sdk from one of the templates the SDK package ships (react by default, angular…), with its manifest for {tool:dashboard_dev} and {tool:dashboard_publish} and an AGENTS.md with the rules of the console's frame. Start every new dashboard app here instead of writing one from scratch.`,
        inputSchema: {
            type: 'object',
            properties: {
                dir: {
                    type: 'string',
                    description:
                        'New (or empty) folder for the app. Absolute, or relative to the folder this MCP server runs in.',
                },
                template: {
                    type: 'string',
                    description: `Template of the SDK package (default ${DEFAULT_TEMPLATE}).`,
                },
                to: {
                    type: 'object',
                    description:
                        'Where it publishes, as in dashboard_publish: {type, id}, or {dashboard}. Its context is the one dashboard_dev uses.',
                    properties: {
                        dashboard: { type: 'string' },
                        type: { type: 'string', enum: DASHBOARD_TARGETS },
                        id: { type: 'string' },
                    },
                },
                storage: {
                    type: 'string',
                    description: 'Storage it publishes to (default app_<folder>_<random>).',
                },
                from: {
                    type: 'string',
                    description:
                        'SDK package to take the template from: a version or tag on npm (default the latest release), or a local folder or .tgz of it.',
                },
                ci: {
                    type: 'boolean',
                    description: 'Add a GitHub workflow that publishes it on push to main.',
                },
                install: { type: 'boolean', description: 'Run npm install.' },
            },
            required: ['dir'],
        },
        handler: toolInit,
    },
    {
        name: 'dashboard_dev',
        description: `Develop a dashboard app on its own dev server (ng serve, npm run dev…) against this server, then publish it once with {tool:dashboard_publish}, instead of publishing to try every change.

Returns a link to the app's local url that opens it as a standalone page: the SDK reads the server, a temporary token and the context from the link and calls the server directly, so the app gets real data, its dev server reloads it on every change and its errors are in the browser console. Start the app's dev server first (the answer says when nothing answers at url). Open the link with the browser tools to see the app and read its console. Each call replaces the previous link's token.`,
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description:
                        'The app on its dev server, e.g. http://localhost:4200/ (a #route in it is kept).',
                },
                to: {
                    type: 'object',
                    description:
                        'Destination whose context the app gets, as in dashboard_publish: {type, id}, or {dashboard} for a collection dashboard (no context).',
                    properties: {
                        dashboard: { type: 'string' },
                        type: { type: 'string', enum: DASHBOARD_TARGETS },
                        id: { type: 'string' },
                        route: { type: 'string' },
                    },
                },
                context: {
                    type: 'object',
                    description:
                        'Or the SDK context itself: device, product, type, group, project ids.',
                },
                route: { type: 'string', description: 'Initial route, e.g. "/devices".' },
                dir: {
                    type: 'string',
                    description:
                        "The app's project folder, to check its SDK against this server (default: the folder this MCP server runs in).",
                },
                hours: {
                    type: 'number',
                    description: 'Hours the temporary token lasts (default 8, up to 168).',
                },
                allow_remote: {
                    type: 'boolean',
                    description:
                        'Allow a url that is not on this machine. The link carries a full-access token: only for a dev server the user named and trusts.',
                },
                user: { type: 'string', description: 'Account to act on (admin only).' },
            },
            required: ['url'],
        },
        handler: toolDev,
    },
    {
        name: 'dashboard_publish',
        description: `Publish an HTML app to a public storage and point dashboards at it. Upload (dir or files) and point (to) are both optional: upload a new build, point more dashboards at an app already uploaded, or both. Read the dashboard SDK reference with {tool:resource_describe} type "dashboard" first.

Destinations (to): {dashboard} for the dashboards collection (created if missing, empty context), or {type, id} to set the "dashboard" property of a device, product, asset_type, asset_group or project, whose id the page gets in Thinger.context. Each may open its own entry page and an initial hash route.

One app can serve many dashboards: name its storage (e.g. app_<project>) and upload the build output folder with prune: true (hashed file names change between builds). Dashboards point at the storage folder (…/files/, served as the storage's index) or at another entry page by name, without version queries: files are served with no-cache and an ETag, so viewers always get the latest upload. Apps in the iframe: start them with {tool:dashboard_init} (a TypeScript project on @thinger-io/dashboard-sdk with these rules set up and an AGENTS.md); hash routing, relative asset URLs and no <base> tag, render after Thinger.ready(), and no localStorage or cookies (opaque origin: keep state in properties through the SDK). Publish the build output folder; the answer warns when the app's SDK needs a newer server than this one, is not the latest on npm, or a page loads the deprecated script build (thinger-dashboard.js).`,
        inputSchema: {
            type: 'object',
            properties: {
                storage: {
                    type: 'string',
                    description:
                        'Public storage of the app (created if missing). Required unless there is one destination.',
                },
                dir: {
                    type: 'string',
                    description:
                        'Local folder to upload, subfolders included (e.g. dist/app/browser).',
                },
                files: {
                    type: 'object',
                    description: 'Or files inline: {"index.html": "<html>…"}.',
                },
                prune: {
                    type: 'boolean',
                    description: 'Delete files of the storage that are not in this upload.',
                },
                to: {
                    type: 'array',
                    description: 'Dashboards to point at the app.',
                    items: {
                        type: 'object',
                        properties: {
                            dashboard: { type: 'string', description: 'Collection dashboard id.' },
                            type: { type: 'string', enum: DASHBOARD_TARGETS },
                            id: { type: 'string' },
                            entry: { type: 'string', description: 'Page (default index.html).' },
                            route: {
                                type: 'string',
                                description: 'Initial route, e.g. "/devices".',
                            },
                            name: { type: 'string', description: 'Collection dashboard name.' },
                        },
                    },
                },
                bump: {
                    type: 'boolean',
                    description:
                        'Add ?v=<publish time> to the dashboard urls so consoles that have the app open reload it at once (otherwise they get the new files on their next load).',
                },
                preview: {
                    type: ['boolean', 'number'],
                    description:
                        'Also return standalone links to review or share each destination in a browser (whole page, scrollable, unlike the console iframe). true: valid 1 h; a number: that many hours (up to 720). Each link carries a read-only access token, one per app and project, replaced by the next preview (older links stop working); actions in the app (device resource calls, writes) answer 403 there. With only storage and preview, it links to the app without context.',
                },
                point: {
                    type: 'boolean',
                    description:
                        'false: only build preview links for `to`, without pointing those dashboards again.',
                },
                user: { type: 'string', description: 'Account to act on (admin only).' },
            },
            required: [],
        },
        handler: toolPublish,
    },
];
