// @ts-check
import { getActiveProfile, getProfile, listProfiles } from '../config.js';
import { listDocs, readDoc } from '../docs.js';

/** The tools about the CLI itself: its documentation and its profiles. */

const text = (t) => ({ content: [{ type: 'text', text: t }], isError: false });

async function toolDocRead(args) {
    if (args.id) return text((await readDoc(args.id)).text);
    const docs = await listDocs();
    if (!docs.length) return text('No documentation available.');
    return text(
        docs
            .map((d) => `${d.id}: ${d.title}${d.description ? ` — ${d.description}` : ''}`)
            .join('\n'),
    );
}

async function toolProfileList() {
    const active = getActiveProfile();
    const lines = listProfiles().map((name) => {
        const data = getProfile(name) || {};
        return `${name === active ? '* ' : '  '}${name}  (${data.username || ''}@${data.server || name})`;
    });
    return text(lines.join('\n') || 'No profiles configured');
}

export const tools = [
    {
        name: 'doc_read',
        description:
            "Read the guides for agents and app developers: those this CLI ships and those the server publishes (the platform's concepts, how-tos, the dashboard SDK reference…). Without `id`, lists them. Read the relevant guide before building something new.",
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Document id from the list.' } },
            required: [],
        },
        handler: toolDocRead,
    },
    {
        name: 'profile_list',
        description:
            'List the configured CLI profiles: each one is a server with its own credentials. Pass a profile name as `profile` on any other tool to use that server for one call.\n\nProfiles are not accounts: another account on the same server is reached with `user` (admin only), not with a profile.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        handler: toolProfileList,
    },
];
