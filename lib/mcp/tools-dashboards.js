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
        preview: args.preview,
        bump: args.bump,
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
            'No dashboard was pointed: those already showing this storage load the new files the next time they open.',
        );
    }
    if (result.previews.length) {
        const until = new Date(result.previews[0].expire).toISOString().slice(11, 16);
        lines.push(
            `Preview links (standalone pages for a browser, read-only token valid until ${until} UTC; servers that ignore token expiry keep it until the next preview replaces it; the previous preview links of this storage stop working):`,
        );
        for (const p of result.previews) lines.push(`${p.to} → ${p.url}`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }], isError: false };
}

export const tools = [
    {
        name: 'dashboard_publish',
        description: `Publish an HTML app to a public storage and point dashboards at it. Upload (dir or files) and point (to) are both optional: upload a new build, point more dashboards at an app already uploaded, or both. Read the dashboard SDK reference with {tool:resource_describe} type "dashboard" first.

Destinations (to): {dashboard} for the dashboards collection (created if missing, empty context), or {type, id} to set the "dashboard" property of a device, product, asset_type, asset_group or project, whose id the page gets in Thinger.context. Each may open its own entry page and an initial hash route.

One app can serve many dashboards: name its storage (e.g. app_<project>) and upload the build output folder with prune: true (hashed file names change between builds). Dashboards point at the storage folder (…/files/, served as the storage's index) or at another entry page by name, without version queries: files are served with no-cache and an ETag, so viewers always get the latest upload. Apps in the iframe: no <base> tag (relative asset paths resolve next to the entry page), hash routing (Angular: withHashLocation()), wait for Thinger.ready() before rendering (Angular: provideAppInitializer(() => Thinger.ready())), <script src="/sdk/0.1/thinger-dashboard.js"> in index.html (the SDK version the app was written for; /sdk/thinger-dashboard.js is always the latest), and no localStorage or cookies (opaque origin: keep state in properties through the SDK).`,
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
                    type: 'boolean',
                    description:
                        'Also return standalone links to review each destination in a browser (whole page, scrollable, unlike the console iframe). Each carries a read-only access token that expires in 1 h, one per app and project, replaced on the next preview; actions in the app (device resource calls, writes) answer 403 there.',
                },
                user: { type: 'string', description: 'Account to act on (admin only).' },
            },
            required: [],
        },
        handler: toolPublish,
    },
];
