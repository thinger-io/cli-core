// @ts-check
import {
    createDeviceToken,
    createToken,
    deleteDeviceToken,
    deleteToken,
    getToken,
    listDeviceTokens,
    listTokens,
    updateToken,
} from '../tokens.js';
import { inputError } from '../errors.js';
import { toolName } from './naming.js';

// ─── User-level tokens ──────────────────────────────────────────────

async function toolTokenList(args) {
    const tokens = await listTokens(args.user);
    if (tokens.length === 0) {
        return {
            content: [{ type: 'text', text: 'No access tokens configured.' }],
            isError: false,
        };
    }
    const lines = tokens.map((t) => {
        const enabled = t.enabled === false ? '✗' : '✓';
        const name = t.name || t.token;
        return `  ${enabled}  ${t.token}  (${name})`;
    });
    return {
        content: [
            {
                type: 'text',
                text: `${tokens.length} token(s):\n${lines.join('\n')}\n\nNote: the access_token JWT is NOT returned by list — use ${toolName('token_get')} to read it.`,
            },
        ],
        isError: false,
    };
}

async function toolTokenGet(args) {
    if (!args.token_id) throw inputError('token_id is required');
    const doc = await getToken(args.token_id, args.user);
    return {
        content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }],
        isError: false,
    };
}

async function toolTokenCreate(args) {
    if (!args.token_id) throw inputError('token_id is required');
    if (!args.name) throw inputError('name is required');
    if (!args.allow) throw inputError('allow is required (permission tree)');

    const doc = await createToken(
        {
            token: args.token_id,
            name: args.name,
            allow: args.allow,
            deny: args.deny,
            description: args.description,
            expire: args.expire,
            enabled: args.enabled,
        },
        args.user,
    );
    return {
        content: [
            {
                type: 'text',
                text: `Created token "${args.token_id}". Full document (including access_token JWT):\n${JSON.stringify(doc, null, 2)}\n\nIMPORTANT: persist the JWT now — it will not be visible in ${toolName('token_list')} responses; only ${toolName('token_get')} returns it.`,
            },
        ],
        isError: false,
    };
}

async function toolTokenUpdate(args) {
    if (!args.token_id) throw inputError('token_id is required');
    const patch = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.description !== undefined) patch.description = args.description;
    if (args.enabled !== undefined) patch.enabled = !!args.enabled;
    if (args.expire !== undefined) patch.expire = args.expire;
    if (args.allow !== undefined) patch.allow = args.allow;
    if (args.deny !== undefined) patch.deny = args.deny;

    const doc = await updateToken(args.token_id, patch, args.user);
    return {
        content: [
            {
                type: 'text',
                text: `Updated token "${args.token_id}".\n${JSON.stringify(doc, null, 2)}`,
            },
        ],
        isError: false,
    };
}

async function toolTokenDelete(args) {
    if (!args.token_id) throw inputError('token_id is required');
    const removed = await deleteToken(args.token_id, args.user);
    return {
        content: [
            {
                type: 'text',
                text: removed
                    ? `Deleted token "${args.token_id}".`
                    : `Token "${args.token_id}" was not configured.`,
            },
        ],
        isError: false,
    };
}

// ─── Device-level tokens ────────────────────────────────────────────

async function toolDeviceTokenList(args) {
    if (!args.device_id) throw inputError('device is required');
    const tokens = await listDeviceTokens(args.device_id, args.user);
    if (tokens.length === 0) {
        return {
            content: [{ type: 'text', text: `No device tokens on device "${args.device_id}".` }],
            isError: false,
        };
    }
    return {
        content: [
            {
                type: 'text',
                text: `${tokens.length} device token(s) on "${args.device_id}":\n${JSON.stringify(tokens, null, 2)}`,
            },
        ],
        isError: false,
    };
}

async function toolDeviceTokenCreate(args) {
    if (!args.device_id) throw inputError('device is required');
    if (!args.token_name) throw inputError('token_name is required');

    const doc = await createDeviceToken(
        args.device_id,
        {
            token_name: args.token_name,
            token_resources: args.token_resources,
            token_expiration: args.token_expiration,
        },
        args.user,
    );
    return {
        content: [
            {
                type: 'text',
                text: `Created device token "${args.token_name}" on "${args.device_id}".\n${JSON.stringify(doc, null, 2)}`,
            },
        ],
        isError: false,
    };
}

async function toolDeviceTokenDelete(args) {
    if (!args.device_id) throw inputError('device is required');
    if (!args.token_id) throw inputError('token_id is required');
    const removed = await deleteDeviceToken(args.device_id, args.token_id, args.user);
    return {
        content: [
            {
                type: 'text',
                text: removed
                    ? `Deleted device token "${args.token_id}" from "${args.device_id}".`
                    : `Device token "${args.token_id}" was not configured on "${args.device_id}".`,
            },
        ],
        isError: false,
    };
}

// ─── Tool registration ───────────────────────────────────────────────

const PERMISSION_GRAMMAR_NOTE = `Permission grammar (allow / deny):
{ "<ResourceType>": { "<id>"|"*": ["<Action>"|"*"] | "*" } }

Resource types are platform categories (Device, Bucket, Product, Endpoint, Property, Token, User, …) plus "*" for any. The id level is a literal id or "*". Leaves are arrays of action strings or the wildcard "*".

Limit: the grammar does NOT scope by product. Only by resource type + id. To restrict a token to one product's devices, enumerate device ids explicitly. See \`tokens.cpp:validate_token_permissions\` and \`tokens.hpp:PERMISSION_DEFINITION\` in the backend.

Examples (verbatim from the server's CREATE_SCHEMA_EXAMPLE):
- Admin Access:
    { token: "admin_access", name: "Admin Access", enabled: true, allow: { "*": { "*": "*" } } }
  Every resource, any name, any action.
- Shared Access:
    { token: "shared_access", name: "Shared Access", enabled: true,
      allow: { "Bucket": { "mqtt_bucket": ["ReadBucket"] }, "Device": { "*": ["AccessDeviceResources"] } } }
  Reads from one bucket plus access to any device's resources.`;

const EXPIRY_NOTE = `Expiry handling: pass either a unix-seconds number or a relative duration string ("30d", "12h", "1y", "90d"). Strings are converted client-side to absolute unix seconds before the request.`;

export const tools = [
    {
        name: 'token_list',
        description: `List the user-level access tokens configured on the account. The response omits the JWT (\`access_token\` is excluded by the server's LIST_PROJECTION). Use \`{tool:token_get}\` to read a specific token's JWT.`,
        inputSchema: {
            type: 'object',
            properties: {
                user: { type: 'string', description: 'API user.' },
            },
            required: [],
        },
        handler: toolTokenList,
    },
    {
        name: 'token_get',
        description: `Read a single user-level access token, including the JWT (\`access_token\`). The JWT is shown only by this endpoint and on creation — list responses strip it.`,
        inputSchema: {
            type: 'object',
            properties: {
                token_id: {
                    type: 'string',
                    description: 'Token id (matches /^[a-zA-Z0-9_]{1,50}$/).',
                },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['token_id'],
        },
        handler: toolTokenGet,
    },
    {
        name: 'token_create',
        description: `Create a user-level access token and issue a JWT scoped by an \`allow\` (and optional \`deny\`) permission tree.

Use this to mint narrow-scope tokens you can hand off to scripts, integrations, or third parties so they can call the platform API on your behalf without your full credentials. The JWT is returned in the response — capture it immediately, it will not be visible from the list endpoint afterwards (only \`{tool:token_get}\` shows it).

${PERMISSION_GRAMMAR_NOTE}

${EXPIRY_NOTE}

Example: a backup script that needs to invoke device resources for 90 days.
{ token_id: "backup_notifier", name: "Backup Notifier", allow: { "Device": { "*": ["AccessDeviceResources"] } }, expire: "90d" }`,
        inputSchema: {
            type: 'object',
            properties: {
                token_id: {
                    type: 'string',
                    description:
                        'Stable token id (letters, digits, underscore, ≤ 50 chars). Used as the URL key for read/update/delete.',
                },
                name: { type: 'string', description: 'Display name.' },
                description: { type: 'string', description: 'Free-form description.' },
                allow: {
                    type: 'object',
                    description:
                        'Permission tree. See the description for the grammar; example: { "Device": { "*": ["AccessDeviceResources"] } }.',
                    additionalProperties: true,
                },
                deny: {
                    type: 'object',
                    description: 'Optional deny tree (same grammar as allow).',
                    additionalProperties: true,
                },
                expire: {
                    description:
                        'Expiry as unix seconds (number) or relative duration ("30d", "12h", "1y"). Omit for no expiry.',
                },
                enabled: {
                    type: 'boolean',
                    description: 'Default: true. Set to false to mint a token in disabled state.',
                },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['token_id', 'name', 'allow'],
        },
        handler: toolTokenCreate,
    },
    {
        name: 'token_update',
        description: `Patch an existing token. Accepted fields per UPDATE_SCHEMA: name, description, enabled, expire, allow, deny. Pass at least one. The JWT itself cannot be rotated through this endpoint — delete and recreate to rotate.

${EXPIRY_NOTE}`,
        inputSchema: {
            type: 'object',
            properties: {
                token_id: { type: 'string', description: 'Token id to patch.' },
                name: { type: 'string' },
                description: { type: 'string' },
                enabled: { type: 'boolean' },
                expire: {
                    description:
                        'Unix seconds (number) or relative duration ("30d", "12h"). Omit to leave unchanged.',
                },
                allow: { type: 'object', additionalProperties: true },
                deny: { type: 'object', additionalProperties: true },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['token_id'],
        },
        handler: toolTokenUpdate,
    },
    {
        name: 'token_delete',
        description: `Delete a user-level token. Idempotent — reports cleanly when the token was already absent.`,
        inputSchema: {
            type: 'object',
            properties: {
                token_id: { type: 'string', description: 'Token id to remove.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['token_id'],
        },
        handler: toolTokenDelete,
    },

    // ── Device tokens ──
    {
        name: 'device_token_list',
        description: `List the device-scoped tokens issued for a single device. Device tokens are a different kind from user-level tokens (\`{family:token}\`): they're issued via \`/devices/{id}/tokens\`, scoped optionally to a subset of the device's resources, and have a simpler \`{ token_name, token_resources?, token_expiration? }\` shape.`,
        inputSchema: {
            type: 'object',
            properties: {
                device_id: { type: 'string', description: 'Device ID.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['device_id'],
        },
        handler: toolDeviceTokenList,
    },
    {
        name: 'device_token_create',
        description: `Issue a device-scoped token. Pass \`token_resources\` to restrict the token to a subset of the device's resources, or omit it for "all resources of this device". Pass \`token_expiration\` (unix seconds or relative like "30d") for an expiry, or omit for none.

${EXPIRY_NOTE}

Example: a token that lets a remote script call only the \`monitoring\` and \`reboot\` resources of "device-007" for 24 hours.
{ device: "device-007", token_name: "ops-bot", token_resources: ["monitoring", "reboot"], token_expiration: "24h" }`,
        inputSchema: {
            type: 'object',
            properties: {
                device_id: { type: 'string', description: 'Device ID.' },
                token_name: { type: 'string', description: 'Display name for the new token.' },
                token_resources: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                        'Resource names the token may access. Omit for ALL resources of the device.',
                },
                token_expiration: {
                    description:
                        'Unix seconds (number) or relative duration ("30d", "24h"). Omit for no expiry.',
                },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['device_id', 'token_name'],
        },
        handler: toolDeviceTokenCreate,
    },
    {
        name: 'device_token_delete',
        description: `Delete a device-scoped token. Idempotent.`,
        inputSchema: {
            type: 'object',
            properties: {
                device_id: { type: 'string', description: 'Device ID.' },
                token_id: { type: 'string', description: 'Token id to remove.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['device_id', 'token_id'],
        },
        handler: toolDeviceTokenDelete,
    },
];
