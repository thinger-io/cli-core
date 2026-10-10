// @ts-check
import { DASHBOARD_TARGETS, collectFiles, publishDashboard } from '../dashboard.js';
import { inputError } from '../errors.js';

async function toolPublish(args) {
    if (!args.dir === !args.files) throw inputError('pass either dir or files');
    if (args.files) {
        if (typeof args.files !== 'object' || Array.isArray(args.files)) {
            throw inputError('files must be an object of { "path": "content" }');
        }
        for (const [file, content] of Object.entries(args.files)) {
            if (typeof content !== 'string') throw inputError(`files["${file}"] must be a string`);
        }
    }
    const files = args.dir ? collectFiles(args.dir) : args.files;
    const result = await publishDashboard({
        dashboard: args.dashboard,
        target: args.target,
        name: args.name,
        description: args.description,
        files,
        entry: args.entry,
        storage: args.storage,
        user: args.user,
    });
    const lines = [
        `Published ${result.files.length} file(s) to ${result.storageCreated ? 'new public' : 'public'} storage ${result.storage}.`,
        `url: ${result.url}`,
        `Open it: ${result.consoleUrl}`,
    ];
    return { content: [{ type: 'text', text: lines.join('\n') }], isError: false };
}

export const tools = [
    {
        name: 'dashboard_publish',
        description: `Publish an HTML app as a dashboard: upload its files to a public storage and point the dashboard at its entry page. The page uses the dashboard SDK (<script src="/sdk/thinger-dashboard.js">): read its reference with {tool:resource_describe} type "dashboard" before writing one.

- \`dashboard\`: a dashboard of the dashboards collection (created if missing). Its context is empty.
- \`target\`: a per-resource dashboard, stored as the "dashboard" property of a device, product, asset type, asset group or project; the page gets that id in Thinger.context, and SDK calls can use it (e.g. buckets with {device: true}).

Republishing overwrites the files and bumps ?v= so viewers load the new version; files no longer in the app are left in the storage.`,
        inputSchema: {
            type: 'object',
            properties: {
                dashboard: { type: 'string', description: 'Dashboard id.' },
                target: {
                    type: 'object',
                    description: 'Resource whose dashboard this is (instead of dashboard).',
                    properties: {
                        type: { type: 'string', enum: DASHBOARD_TARGETS },
                        id: { type: 'string' },
                    },
                    required: ['type', 'id'],
                },
                dir: { type: 'string', description: 'Local folder with the app (index.html…).' },
                files: {
                    type: 'object',
                    description: 'Or the files inline: {"index.html": "<html>…"}.',
                },
                entry: { type: 'string', description: 'Entry page (default index.html).' },
                name: { type: 'string', description: 'Dashboard name.' },
                description: { type: 'string', description: 'Dashboard description.' },
                storage: {
                    type: 'string',
                    description:
                        'Public storage for the files (default: one per dashboard, created if missing).',
                },
                user: { type: 'string', description: 'Account to act on (admin only).' },
            },
            required: [],
        },
        handler: toolPublish,
    },
];
