// @ts-check
import {
    PROFILE_API_TARGETS,
    PROFILE_DATA_SOURCES,
    PROFILE_PAYLOAD_TYPES,
    deleteProductApiResource,
    deleteProductBucket,
    deleteProductProfileProperty,
    getProductApiResource,
    getProductApiResources,
    getProductBucket,
    getProductBuckets,
    getProductProfileProperties,
    getProductProfileProperty,
    setProfileApiResource,
    setProfileBucket,
    setProfileProperty,
} from '../profile.js';
import { inputError } from '../errors.js';

// ─── API resources ───────────────────────────────────────────────────

async function toolProfileApiList(args) {
    if (!args.product) throw inputError('product is required');
    const map = await getProductApiResources(args.product, args.user);
    const names = Object.keys(map);
    if (names.length === 0) {
        return {
            content: [
                {
                    type: 'text',
                    text: `No profile API resources configured on product "${args.product}".`,
                },
            ],
            isError: false,
        };
    }
    const lines = names.map((n) => {
        const def = map[n] || {};
        const target = def?.request?.data?.target || '?';
        const enabled = def.enabled === false ? '✗' : '✓';
        return `  ${enabled}  ${n}  → target=${target}`;
    });
    return {
        content: [
            {
                type: 'text',
                text: `${names.length} profile API resource(s) on "${args.product}":\n${lines.join('\n')}`,
            },
        ],
        isError: false,
    };
}

async function toolProfileApiGet(args) {
    if (!args.product) throw inputError('product is required');
    if (!args.name) throw inputError('name is required');
    const def = await getProductApiResource(args.product, args.name, args.user);
    return {
        content: [{ type: 'text', text: JSON.stringify(def, null, 2) }],
        isError: false,
    };
}

async function toolProfileApiSet(args) {
    if (!args.product) throw inputError('product is required');
    if (!args.name) throw inputError('name is required');
    if (!args.target) throw inputError('target is required');

    const payload = await setProfileApiResource(args.product, args.name, args.user, {
        target: args.target,
        target_args: args.target_args,
        payload_type: args.payload_type,
        payload: args.payload,
        payload_function: args.payload_function,
        response: args.response,
        enabled: args.enabled,
    });

    return {
        content: [
            {
                type: 'text',
                text: `Upserted profile API resource "${args.name}" on product "${args.product}" (target=${args.target}).\n${JSON.stringify(payload, null, 2)}`,
            },
        ],
        isError: false,
    };
}

async function toolProfileApiDelete(args) {
    if (!args.product) throw inputError('product is required');
    if (!args.name) throw inputError('name is required');
    const removed = await deleteProductApiResource(args.product, args.name, args.user);
    return {
        content: [
            {
                type: 'text',
                text: removed
                    ? `Deleted profile API resource "${args.name}" from product "${args.product}".`
                    : `Profile API resource "${args.name}" was not configured on product "${args.product}".`,
            },
        ],
        isError: false,
    };
}

// ─── Buckets ─────────────────────────────────────────────────────────

async function toolProfileBucketList(args) {
    if (!args.product) throw inputError('product is required');
    const map = await getProductBuckets(args.product, args.user);
    const names = Object.keys(map);
    if (names.length === 0) {
        return {
            content: [
                {
                    type: 'text',
                    text: `No profile buckets configured on product "${args.product}".`,
                },
            ],
            isError: false,
        };
    }
    const lines = names.map((n) => {
        const def = map[n] || {};
        const source = def?.data?.source || '?';
        const enabled = def.enabled === false ? '✗' : '✓';
        return `  ${enabled}  ${n}  → source=${source}`;
    });
    return {
        content: [
            {
                type: 'text',
                text: `${names.length} profile bucket(s) on "${args.product}":\n${lines.join('\n')}`,
            },
        ],
        isError: false,
    };
}

async function toolProfileBucketGet(args) {
    if (!args.product) throw inputError('product is required');
    if (!args.name) throw inputError('name is required');
    const def = await getProductBucket(args.product, args.name, args.user);
    return {
        content: [{ type: 'text', text: JSON.stringify(def, null, 2) }],
        isError: false,
    };
}

async function toolProfileBucketSet(args) {
    if (!args.product) throw inputError('product is required');
    if (!args.name) throw inputError('name is required');
    if (!args.source) throw inputError('source is required');

    const payload = await setProfileBucket(args.product, args.name, args.user, {
        source: args.source,
        source_args: args.source_args,
        payload_type: args.payload_type,
        payload: args.payload,
        payload_function: args.payload_function,
        name_label: args.name_label,
        description: args.description,
        enabled: args.enabled,
        backend: args.backend,
        retention: args.retention,
        tags: args.tags,
    });

    return {
        content: [
            {
                type: 'text',
                text: `Upserted profile bucket "${args.name}" on product "${args.product}" (source=${args.source}).\n${JSON.stringify(payload, null, 2)}`,
            },
        ],
        isError: false,
    };
}

async function toolProfileBucketDelete(args) {
    if (!args.product) throw inputError('product is required');
    if (!args.name) throw inputError('name is required');
    const removed = await deleteProductBucket(args.product, args.name, args.user);
    return {
        content: [
            {
                type: 'text',
                text: removed
                    ? `Deleted profile bucket "${args.name}" from product "${args.product}".`
                    : `Profile bucket "${args.name}" was not configured on product "${args.product}".`,
            },
        ],
        isError: false,
    };
}

// ─── Properties ──────────────────────────────────────────────────────

async function toolProfilePropertyList(args) {
    if (!args.product) throw inputError('product is required');
    const map = await getProductProfileProperties(args.product, args.user);
    const names = Object.keys(map);
    if (names.length === 0) {
        return {
            content: [
                {
                    type: 'text',
                    text: `No profile property handlers configured on product "${args.product}".`,
                },
            ],
            isError: false,
        };
    }
    const lines = names.map((n) => {
        const def = map[n] || {};
        const source = def?.data?.source || '?';
        const enabled = def.enabled === false ? '✗' : '✓';
        const patch = def?.data?.patch ? ' patch' : '';
        return `  ${enabled}  ${n}  → source=${source}${patch}`;
    });
    return {
        content: [
            {
                type: 'text',
                text: `${names.length} profile property handler(s) on "${args.product}":\n${lines.join('\n')}`,
            },
        ],
        isError: false,
    };
}

async function toolProfilePropertyGet(args) {
    if (!args.product) throw inputError('product is required');
    if (!args.name) throw inputError('name is required');
    const def = await getProductProfileProperty(args.product, args.name, args.user);
    return {
        content: [{ type: 'text', text: JSON.stringify(def, null, 2) }],
        isError: false,
    };
}

async function toolProfilePropertySet(args) {
    if (!args.product) throw inputError('product is required');
    if (!args.name) throw inputError('name is required');
    if (!args.source) throw inputError('source is required');

    const payload = await setProfileProperty(args.product, args.name, args.user, {
        source: args.source,
        source_args: args.source_args,
        payload_type: args.payload_type,
        payload: args.payload,
        payload_function: args.payload_function,
        name_label: args.name_label,
        description: args.description,
        enabled: args.enabled,
        patch: args.patch,
    });

    return {
        content: [
            {
                type: 'text',
                text: `Upserted profile property handler "${args.name}" on product "${args.product}" (source=${args.source}${args.patch ? ', patch' : ''}).\n${JSON.stringify(payload, null, 2)}`,
            },
        ],
        isError: false,
    };
}

async function toolProfilePropertyDelete(args) {
    if (!args.product) throw inputError('product is required');
    if (!args.name) throw inputError('name is required');
    const removed = await deleteProductProfileProperty(args.product, args.name, args.user);
    return {
        content: [
            {
                type: 'text',
                text: removed
                    ? `Deleted profile property handler "${args.name}" from product "${args.product}".`
                    : `Profile property handler "${args.name}" was not configured on product "${args.product}".`,
            },
        ],
        isError: false,
    };
}

// ─── Tool registration ───────────────────────────────────────────────

const SOURCE_ARGS_DESCRIPTION = `Required keys depend on \`source\`:
- "resource": { resource: "<name>", update?: "interval"|"event", interval?: <number>, magnitude?: "second"|"minute"|"hour" }
- "resource_stream": { resource_stream: "<name>" }
- "product_stream": { product_stream: "<name>", product?: "<other-product-id>" }
- "topic": { topic: "<mqtt-topic>" }
- "event": { event: "<event-name>", filter?: { ...filters... } }`;

const TARGET_ARGS_DESCRIPTION = `Required keys depend on \`target\`:
- "resource": { resource: "<device-resource-name>" }
- "resource_stream": { resource_stream: "<stream-name>" }   (defaults to the API resource name when omitted — pass null target_args for that)
- "product_stream": { product: "<product-id>", product_stream: "<stream-name>" }   (BOTH required)
- "property": { property: "<device-property-name>" }
- "function": { function: "<product-script-function-name>" }
- "endpoint": { endpoint: "<endpoint-name>" }
- "topic": { topic: "<mqtt-topic>" }`;

const BACKUP_USE_CASE = `Canonical use case: fan out a "backup_complete" stream resource → "backups" bucket (history) and "backups" device property (last-known). Three calls — one to declare the stream resource, one for the bucket, one for the property — and the platform handles the wiring on every device of the product automatically.`;

export const tools = [
    // ── API resources ──
    {
        name: 'product_profile_api_list',
        description: `List the API resources declared in a product's \`profile.api\`. These are platform-managed REST endpoints exposed for every device of the product, dispatched server-side to a target (device resource, stream, property, function, endpoint, …) without the device having to implement them.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product'],
        },
        handler: toolProfileApiList,
    },
    {
        name: 'product_profile_api_get',
        description: `Read the full JSON definition of a single profile API resource (request/response/payload blocks). Use this before \`{tool:product_profile_api_set}\` when you want to tweak only one field of an existing resource — read, modify, write back.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                name: { type: 'string', description: 'API resource name.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product', 'name'],
        },
        handler: toolProfileApiGet,
    },
    {
        name: 'product_profile_api_set',
        description: `Upsert a profile API resource: creates it if missing, replaces it in place otherwise. Pick a \`target\` (where the request is dispatched) and a \`payload_type\` (how the body is rendered for the target). Validation is client-side: missing target_args.<key> for the chosen target raises a clean error before contacting the server.

${BACKUP_USE_CASE}

Example: declare a stream-style fire-and-forget resource named "backup_complete" that simply forwards the payload onto the device's own \`backup_complete\` resource_stream:
{ product: "myprod", name: "backup_complete", target: "resource_stream", payload_type: "source_payload", response: { payload_type: "none" } }

Gotchas:
- "resource_stream" target defaults the destination stream name to the API resource name itself. Override only when they should differ.
- "product_stream" target needs BOTH \`target_args.product\` AND \`target_args.product_stream\` — the destination is identified by (product id, stream name).
- payload_type "template_payload" (default) renders a Mustache-style template using \`{{payload}}\` etc.; "source_payload" forwards the incoming body verbatim; "source_event" sends the full event envelope; "none" sends an empty body.
- response defaults to { payload_type: "none" } when omitted, which is the right shape for fire-and-forget stream-style resources. Set \`response: { payload_type: "source_payload" }\` (or similar) when the caller needs to receive a body back.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                name: {
                    type: 'string',
                    description: 'API resource name (becomes profile.api.<name>).',
                },
                target: {
                    type: 'string',
                    enum: PROFILE_API_TARGETS,
                    description: 'Where the platform dispatches the request.',
                },
                target_args: {
                    type: 'object',
                    description: TARGET_ARGS_DESCRIPTION,
                    additionalProperties: true,
                },
                payload_type: {
                    type: 'string',
                    enum: PROFILE_PAYLOAD_TYPES,
                    description:
                        'How the request body is rendered. Default: "template_payload" (server fallback).',
                },
                payload: {
                    type: 'string',
                    description:
                        'Mustache-style template body (only meaningful for payload_type="template_payload"; ignored otherwise).',
                },
                payload_function: {
                    type: 'string',
                    description:
                        'Optional product-code function name applied to the payload before dispatch.',
                },
                response: {
                    type: 'object',
                    description:
                        'Optional response shape. Defaults to { payload_type: "none" } (fire-and-forget). Pass { payload_type, source?, payload?, payload_function? } to send something back.',
                    properties: {
                        payload_type: { type: 'string', enum: PROFILE_PAYLOAD_TYPES },
                        source: {
                            type: 'string',
                            description:
                                'Where the response payload is sourced from (e.g. "request_response" to reuse the upstream body).',
                        },
                        payload: { type: 'string' },
                        payload_function: { type: 'string' },
                    },
                    additionalProperties: false,
                },
                enabled: {
                    type: 'boolean',
                    description:
                        'Default: true. Set to false to stage a definition without activating it.',
                },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product', 'name', 'target'],
        },
        handler: toolProfileApiSet,
    },
    {
        name: 'product_profile_api_delete',
        description: `Remove a profile API resource. Idempotent — reports cleanly when the resource was already absent.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                name: { type: 'string', description: 'API resource name.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product', 'name'],
        },
        handler: toolProfileApiDelete,
    },

    // ── Buckets ──
    {
        name: 'product_profile_bucket_list',
        description: `List buckets declared in a product's \`profile.buckets\`. These are auto-created/maintained time-series buckets fed from a declared source (resource poll, resource_stream, product_stream, topic, or event).`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product'],
        },
        handler: toolProfileBucketList,
    },
    {
        name: 'product_profile_bucket_get',
        description: `Read the full JSON definition of a single profile bucket (source/payload/retention/backend).`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                name: { type: 'string', description: 'Bucket name.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product', 'name'],
        },
        handler: toolProfileBucketGet,
    },
    {
        name: 'product_profile_bucket_set',
        description: `Upsert a profile bucket: creates it if missing, replaces it in place otherwise. The underlying time-series bucket is created lazily by the server on the first event delivery — no separate provisioning step. Picks a \`source\` (where samples come from), \`source_args\` (the matching key), and an optional \`payload\` template / \`payload_function\` to shape the row.

${BACKUP_USE_CASE}

Example: feed every "backup_complete" stream payload into a bucket called "backups" with one-year retention.
{ product: "myprod", name: "backups", source: "resource_stream", source_args: { resource_stream: "backup_complete" }, payload_type: "source_payload", payload: "{{payload}}", retention: { period: 1, unit: "years" } }

Gotchas:
- backend defaults to "mongodb". Use "influxdb" only on accounts where it's enabled.
- If the bucket name (or template) does NOT contain "{{device}}", the server tags samples with a "device" and "group" tag automatically (group_bucket_ in product_bucket_handler.cpp).
- retention.unit accepts: minutes, hours, days, months, years.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                name: { type: 'string', description: 'Bucket name.' },
                source: {
                    type: 'string',
                    enum: PROFILE_DATA_SOURCES,
                    description: 'Where samples come from.',
                },
                source_args: {
                    type: 'object',
                    description: SOURCE_ARGS_DESCRIPTION,
                    additionalProperties: true,
                },
                payload_type: {
                    type: 'string',
                    enum: PROFILE_PAYLOAD_TYPES,
                    description: 'How the row payload is rendered.',
                },
                payload: {
                    type: 'string',
                    description: 'Optional template body (e.g. "{{payload}}" to forward verbatim).',
                },
                payload_function: { type: 'string', description: 'Optional payload function.' },
                name_label: {
                    type: 'string',
                    description:
                        'Display name shown in the platform UI. Defaults to the bucket name.',
                },
                description: { type: 'string', description: 'Free-form description.' },
                enabled: { type: 'boolean', description: 'Default: true.' },
                backend: {
                    type: 'string',
                    description: 'Storage backend. Default: "mongodb".',
                },
                retention: {
                    type: 'object',
                    description:
                        'Retention policy: { period: number, unit: "minutes"|"hours"|"days"|"months"|"years" }.',
                    properties: {
                        period: { type: 'number' },
                        unit: {
                            type: 'string',
                            enum: ['minutes', 'hours', 'days', 'months', 'years'],
                        },
                    },
                    required: ['period', 'unit'],
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Extra tags propagated to every row.',
                },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product', 'name', 'source'],
        },
        handler: toolProfileBucketSet,
    },
    {
        name: 'product_profile_bucket_delete',
        description: `Remove a profile bucket *handler*. Note: this drops the listener configuration only; the underlying time-series bucket is not deleted (preserve historical data unless explicitly removed via the buckets API).`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                name: { type: 'string', description: 'Bucket name.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product', 'name'],
        },
        handler: toolProfileBucketDelete,
    },

    // ── Properties ──
    {
        name: 'product_profile_property_list',
        description: `List property *handlers* declared in a product's \`profile.properties\`. NOT to be confused with product-level properties (\`{family:product_property}\`) — those are JSON values stored on the product itself; these handlers fan listener output into per-device properties.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product'],
        },
        handler: toolProfilePropertyList,
    },
    {
        name: 'product_profile_property_get',
        description: `Read the full JSON definition of a single profile property handler.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                name: { type: 'string', description: 'Property handler name.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product', 'name'],
        },
        handler: toolProfilePropertyGet,
    },
    {
        name: 'product_profile_property_set',
        description: `Upsert a profile property *handler* — server-side wiring that fans listener output into per-device properties named \`<name>\`. Same source/payload grammar as buckets, plus an optional \`patch\` flag.

${BACKUP_USE_CASE}

Example: keep the latest "backup_complete" payload as the device's "backups" property.
{ product: "myprod", name: "backups", source: "resource_stream", source_args: { resource_stream: "backup_complete" }, payload_type: "source_payload", payload: "{{payload}}" }

Gotchas:
- This DOES NOT manage \`/products/{p}/properties/{name}\` (product-level JSON values) — that's the \`{family:product_property}\` family.
- \`patch: true\` flips the handler from "replace" mode to "JSON-merge" mode (the value is merge-patched onto the existing property instead of overwriting it). Useful for listeners that publish only a delta.
- A property handler with source "event" and the same property as event filter is short-circuited server-side to avoid infinite loops.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                name: { type: 'string', description: 'Property handler name.' },
                source: {
                    type: 'string',
                    enum: PROFILE_DATA_SOURCES,
                    description: 'Where samples come from.',
                },
                source_args: {
                    type: 'object',
                    description: SOURCE_ARGS_DESCRIPTION,
                    additionalProperties: true,
                },
                payload_type: { type: 'string', enum: PROFILE_PAYLOAD_TYPES },
                payload: { type: 'string' },
                payload_function: { type: 'string' },
                name_label: {
                    type: 'string',
                    description:
                        'Display name shown in the platform UI. Defaults to the handler name.',
                },
                description: { type: 'string' },
                enabled: { type: 'boolean', description: 'Default: true.' },
                patch: {
                    type: 'boolean',
                    description:
                        'When true, apply the value as a JSON merge-patch on top of the existing device property instead of replacing it (default: false).',
                },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product', 'name', 'source'],
        },
        handler: toolProfilePropertySet,
    },
    {
        name: 'product_profile_property_delete',
        description: `Remove a profile property handler. Idempotent.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                name: { type: 'string', description: 'Property handler name.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['product', 'name'],
        },
        handler: toolProfilePropertyDelete,
    },
];
