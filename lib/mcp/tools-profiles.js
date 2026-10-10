// @ts-check
import { listProfiles, getActiveProfile, getProfile } from '../config.js';

async function toolProfiles() {
    const names = listProfiles();
    const active = getActiveProfile();
    const lines = names.map((n) => {
        const data = getProfile(n) || {};
        const marker = n === active ? '* ' : '  ';
        return `${marker}${n}  (${data.username || ''}@${data.server || n})`;
    });
    return {
        content: [{ type: 'text', text: lines.join('\n') || 'No profiles configured' }],
        isError: false,
    };
}

export const tools = [
    {
        name: 'profiles',
        description:
            'List configured CLI profiles (each profile targets a server, with its own credentials). Use the returned profile name as the optional `profile` parameter on any other tool to target that environment for a single call.\n\nProfiles are not accounts. Every tool also takes an optional `user`, which addresses another account on the same server when the profile has admin rights — so a device belonging to `demo` is reached with `user: "demo"`, not by looking for a profile of that name.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
        handler: toolProfiles,
    },
];
