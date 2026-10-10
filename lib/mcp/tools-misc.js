// @ts-check
import api from '../api.js';
import { getActiveProfile, getProfile, listProfiles } from '../config.js';
import { listDocs, readDoc } from '../docs.js';
import { apiError, inputError } from '../errors.js';
import { v1 } from '../paths.js';

/**
 * The few operations that are neither CRUD on a catalog type nor about
 * devices, products or buckets: run an endpoint, try an alarm rule, list
 * the CLI's own profiles.
 */

const text = (t) => ({ content: [{ type: 'text', text: t }], isError: false });
const json = (data) =>
    text(typeof data === 'string' ? data : JSON.stringify(data ?? null, null, 2));
const userParam = { type: 'string', description: 'Account to act on (admin only).' };

async function toolEndpointCall(args) {
    if (!args.endpoint) throw inputError('endpoint is required');
    try {
        const res = await api.post(
            `${v1(args.user)}/endpoints/${encodeURIComponent(args.endpoint)}/call`,
            args.data ?? {},
        );
        return json(res.data === '' ? `Called endpoint ${args.endpoint}.` : res.data);
    } catch (e) {
        throw apiError(e, { notFound: `Endpoint not found: ${args.endpoint}` });
    }
}

const TEST_MODES = ['rule', 'source', 'notification'];

async function toolAlarmRuleTest(args) {
    if (!args.rule) throw inputError('rule is required');
    const mode = args.mode || 'rule';
    if (!TEST_MODES.includes(mode))
        throw inputError(`mode must be one of ${TEST_MODES.join(', ')}`);
    try {
        const res = await api.post(
            `${v1(args.user)}/alarms/rules/${encodeURIComponent(args.rule)}/test-${mode}`,
            args.body ?? {},
        );
        return json(res.data);
    } catch (e) {
        throw apiError(e, { notFound: `Alarm rule not found: ${args.rule}` });
    }
}

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
        name: 'endpoint_call',
        description:
            'Run an endpoint (HTTP request, email, notification…) with `data` as its payload, and return what the endpoint answered.',
        inputSchema: {
            type: 'object',
            properties: {
                endpoint: { type: 'string', description: 'Endpoint id.' },
                data: {
                    description: 'Payload for the endpoint (its template sees it as {{payload}}).',
                },
                user: userParam,
            },
            required: ['endpoint'],
        },
        handler: toolEndpointCall,
    },
    {
        name: 'alarm_rule_test',
        description: `Try an alarm rule without raising alarms or notifying anyone.

- mode "rule" (default): evaluate a whole rule; \`body\` is the rule as it would be saved ({name, config…}).
- mode "source": read one data source as the rule would; \`body\` is {name, source: "bucket" | "device_property" | "device_status", <source>: {…}}, e.g. {name: "loc", source: "device_property", device_property: {device: "d1", property: "location"}}.
- mode "notification": render the notification; \`body\` is the event data.`,
        inputSchema: {
            type: 'object',
            properties: {
                rule: {
                    type: 'string',
                    description: 'Rule id (it may not exist yet in mode "rule").',
                },
                mode: { type: 'string', enum: TEST_MODES, description: 'What to test.' },
                body: { type: 'object', description: 'Configuration or data to test with.' },
                user: userParam,
            },
            required: ['rule'],
        },
        handler: toolAlarmRuleTest,
    },
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
