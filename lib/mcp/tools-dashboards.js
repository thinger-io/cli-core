// @ts-check
import { DASHBOARD_TARGETS, collectFiles, publishApp } from '../dashboard.js';
import { inputError } from '../errors.js';

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
        user: args.user,
    });
    const lines = [];
    if (result.uploaded.length) {
        lines.push(
            `Uploaded ${result.uploaded.length} file(s) to ${result.storageCreated ? 'new public' : 'public'} storage ${result.storage}` +
                (result.deleted.length
                    ? `; deleted ${result.deleted.length} no longer in the app.`
                    : '.'),
        );
    }
    for (const p of result.pointed) lines.push(`${p.to} → ${p.url}\n  open: ${p.open}`);
    if (!result.pointed.length) {
        lines.push(
            'No dashboard was pointed. Dashboards already showing this storage keep their old ?v=: list them in `to` so viewers load the new version.',
        );
    }
    if (result.unhashed.length) {
        const shown = result.unhashed.slice(0, 5).join(', ');
        lines.push(
            `Note: no content hash in the name of ${shown}${result.unhashed.length > 5 ? '…' : ''}: viewers may keep stale copies. Use hashed build output, or add ?v= to their references.`,
        );
    }
    return { content: [{ type: 'text', text: lines.join('\n') }], isError: false };
}

export const tools = [
    {
        name: 'dashboard_publish',
        description: `Publish an HTML app to a public storage and point dashboards at it. Upload (dir or files) and point (to) are both optional: upload a new build, point more dashboards at an app already uploaded, or both. Read the dashboard SDK reference with {tool:resource_describe} type "dashboard" first.

Destinations (to): {dashboard} for the dashboards collection (created if missing, empty context), or {type, id} to set the "dashboard" property of a device, product, asset_type, asset_group or project, whose id the page gets in Thinger.context. Each may open its own entry page and an initial hash route.

One app can serve many dashboards: name its storage (e.g. app_<project>) and upload the build output folder with prune: true (hashed file names change between builds). Apps in the iframe: no <base> tag (assets resolve next to the entry page, and hash navigation keeps its ?v=), hash routing (Angular: withHashLocation()), wait for Thinger.ready() before rendering (Angular: provideAppInitializer(() => Thinger.ready())), <script src="/sdk/thinger-dashboard.js"> in index.html, and no localStorage or cookies (opaque origin: keep state in properties through the SDK).`,
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
                user: { type: 'string', description: 'Account to act on (admin only).' },
            },
            required: [],
        },
        handler: toolPublish,
    },
];
