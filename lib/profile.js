// @ts-check
import api from './api.js';
import { apiError, inputError } from './errors.js';
import { v1 } from './paths.js';

/**
 * Helpers for product *profile* configuration.
 *
 * Concept primer
 * ──────────────
 * A product `profile` is the server-side wiring of a product. It bundles
 * the four declarative subsystems the platform consumes when a device of
 * that product emits or receives data:
 *
 *   - `profile.api.<name>`        — REST API resources callable on every
 *                                    device of the product (or invoked by
 *                                    a script). Pick a `target` and the
 *                                    platform proxies the request there.
 *   - `profile.buckets.<name>`    — auto-managed time-series buckets fed
 *                                    from a declared source (`resource`,
 *                                    `resource_stream`, `product_stream`,
 *                                    `topic`, `event`).
 *   - `profile.properties.<name>` — auto-managed device properties fed
 *                                    from the same family of sources, with
 *                                    optional JSON-merge semantics via
 *                                    `data.patch`.
 *   - `profile.code`              — script-storage link (handled
 *                                    elsewhere; not exposed here).
 *
 * REST endpoints these helpers wrap:
 *   - GET    /v1/users/{user}/products/{p}/profile/api
 *   - PUT    /v1/users/{user}/products/{p}/profile/api/{name}
 *   - GET    /v1/users/{user}/products/{p}/profile/api/{name}
 *   - DELETE /v1/users/{user}/products/{p}/profile/api/{name}
 *   - …same shape for /buckets and /properties.
 *
 * IMPORTANT: do NOT confuse `profile/properties/<name>` with
 * `/products/{p}/properties/{name}`. The former is a *handler* that fans
 * incoming source data into device properties; the latter (handled by
 * `getProductProperty`/`setProductProperty` in `product.js`) is a JSON
 * value attached to the product itself. Same word, completely different
 * concept — the helpers in this file consistently use the
 * `getProductProfileProperty` naming to keep callers honest.
 *
 * Canonical end-to-end use case
 * ─────────────────────────────
 * Fan-out a `backup_complete` stream resource → `backups` bucket
 * (history) and `backups` device property (last-known):
 *
 *   1. setProductApiResource(p, 'backup_complete', user, {
 *        enabled: true,
 *        request:  { data: { target: 'resource_stream', resource_stream: 'backup_complete', payload_type: 'source_payload', payload: '' } },
 *        response: { data: { payload_type: 'none' } },
 *      })
 *   2. setProductBucket(p, 'backups', user, {
 *        enabled: true, name: 'Backups', backend: 'mongodb',
 *        retention: { period: 1, unit: 'years' },
 *        data: { source: 'resource_stream', resource_stream: 'backup_complete', payload_type: 'source_payload', payload: '{{payload}}' },
 *      })
 *   3. setProductProfileProperty(p, 'backups', user, {
 *        enabled: true, name: 'Backups',
 *        data: { source: 'resource_stream', resource_stream: 'backup_complete', payload_type: 'source_payload', payload: '{{payload}}' },
 *      })
 *
 * After this, every device of the product can call its own `backup_complete`
 * stream resource. The platform fans the payload out to the bucket (history)
 * and to the device property `backups` (last-known) automatically — no
 * device code change.
 */

// ─── Listener config validators ──────────────────────────────────────
//
// Each `data.source` shape (for buckets/properties) and each request
// `target` (for API resources) demands a matching key in the data block.
// We enforce these client-side so the caller gets a clear error long
// before the server returns a generic 400.

/** Sources accepted by `profile.buckets[*].data.source` and `profile.properties[*].data.source`. */
export const PROFILE_DATA_SOURCES = [
    'resource',
    'resource_stream',
    'product_stream',
    'topic',
    'event',
];

/** Targets accepted by `profile.api[*].request.data.target`. */
export const PROFILE_API_TARGETS = [
    'resource',
    'resource_stream',
    'product_stream',
    'property',
    'function',
    'endpoint',
    'topic',
];

/** Payload types recognised by the platform on both request and response sides. */
export const PROFILE_PAYLOAD_TYPES = ['template_payload', 'source_payload', 'source_event', 'none'];

/** Required key in `source_args` for each `data.source` value. */
const SOURCE_KEY = {
    resource: 'resource',
    resource_stream: 'resource_stream',
    product_stream: 'product_stream',
    topic: 'topic',
    event: 'event',
};

/** Required key in `target_args` for each `request.data.target` value. */
const TARGET_KEY = {
    resource: 'resource',
    resource_stream: 'resource_stream',
    property: 'property',
    function: 'function',
    endpoint: 'endpoint',
    topic: 'topic',
    // product_stream needs BOTH `product` and `product_stream` — handled inline.
    product_stream: 'product_stream',
};

function assertValidSource(source) {
    if (!PROFILE_DATA_SOURCES.includes(source)) {
        throw inputError(
            `Invalid source "${source}". Allowed: ${PROFILE_DATA_SOURCES.join(', ')}.`,
        );
    }
}

function assertValidTarget(target) {
    if (!PROFILE_API_TARGETS.includes(target)) {
        throw inputError(`Invalid target "${target}". Allowed: ${PROFILE_API_TARGETS.join(', ')}.`);
    }
}

function assertValidPayloadType(value, label = 'payload_type') {
    if (value === undefined || value === null) return;
    if (!PROFILE_PAYLOAD_TYPES.includes(value)) {
        throw inputError(
            `Invalid ${label} "${value}". Allowed: ${PROFILE_PAYLOAD_TYPES.join(', ')}.`,
        );
    }
}

/**
 * Build the `data` block for a bucket or property listener from the
 * caller's source + source_args + payload bits. Returns a plain object
 * the server will accept verbatim.
 *
 * @param {{
 *   source: string,
 *   source_args?: Record<string, unknown>,
 *   payload_type?: string,
 *   payload?: string,
 *   payload_function?: string,
 *   patch?: boolean,
 * }} opts
 */
export function buildListenerDataBlock(opts) {
    const source = opts.source;
    assertValidSource(source);
    const args = opts.source_args || {};

    const data = { source };

    const requiredKey = SOURCE_KEY[source];
    if (requiredKey) {
        const value = args[requiredKey];
        if (typeof value !== 'string' || !value) {
            throw inputError(
                `source "${source}" requires source_args.${requiredKey} to be a non-empty string`,
            );
        }
        data[requiredKey] = value;
    }

    if (source === 'resource') {
        // `resource` source supports an optional polling cadence. When
        // omitted, the server defaults to event mode (interval = 0).
        const update = args.update;
        if (update !== undefined) {
            if (update !== 'interval' && update !== 'event') {
                throw inputError(
                    `source_args.update must be "interval" or "event" (got "${update}")`,
                );
            }
            data.update = update;
        }
        if (args.interval !== undefined) {
            const n = Number(args.interval);
            if (!Number.isFinite(n) || n < 0) {
                throw inputError('source_args.interval must be a non-negative number');
            }
            data.interval = n;
        }
        if (args.magnitude !== undefined) {
            data.magnitude = String(args.magnitude);
        }
    }

    if (source === 'product_stream') {
        // The bucket/property listener listens on the *current* product's
        // stream by default. A foreign-product listener is unusual — the
        // server checks `data.product` only when present. Pass it through.
        if (args.product !== undefined) {
            if (typeof args.product !== 'string' || !args.product) {
                throw inputError('source_args.product must be a non-empty string');
            }
            data.product = args.product;
        }
    }

    if (source === 'event' && args.filter !== undefined) {
        if (typeof args.filter !== 'object' || Array.isArray(args.filter)) {
            throw inputError('source_args.filter must be an object');
        }
        data.filter = args.filter;
    }

    // Payload shape — common to every listener kind.
    assertValidPayloadType(opts.payload_type);
    if (opts.payload_type !== undefined) data.payload_type = opts.payload_type;
    if (opts.payload !== undefined) {
        if (typeof opts.payload !== 'string') {
            throw inputError('payload must be a string (template or "{{payload}}")');
        }
        data.payload = opts.payload;
    }
    if (opts.payload_function !== undefined) {
        if (typeof opts.payload_function !== 'string') {
            throw inputError('payload_function must be a string');
        }
        data.payload_function = opts.payload_function;
    }

    // Property handler flag — only meaningful for property listeners but
    // accepted on the base helper for symmetry; the bucket handler simply
    // ignores it.
    if (opts.patch !== undefined) {
        data.patch = !!opts.patch;
    }

    return data;
}

/**
 * Build the `request.data` block for a profile API resource.
 *
 * @param {{
 *   target: string,
 *   target_args?: Record<string, unknown>,
 *   resource_name?: string,
 *   payload_type?: string,
 *   payload?: string,
 *   payload_function?: string,
 * }} opts
 */
export function buildApiRequestData(opts) {
    const target = opts.target;
    assertValidTarget(target);
    const args = opts.target_args || {};
    const data = { target };

    if (target === 'product_stream') {
        if (typeof args.product !== 'string' || !args.product) {
            throw inputError(
                'target "product_stream" requires target_args.product (the destination product id)',
            );
        }
        if (typeof args.product_stream !== 'string' || !args.product_stream) {
            throw inputError(
                'target "product_stream" requires target_args.product_stream (the destination stream name)',
            );
        }
        data.product = args.product;
        data.product_stream = args.product_stream;
    } else if (target === 'resource_stream') {
        // resource_stream defaults to the API resource name itself, so the
        // caller can omit target_args entirely for a self-named stream.
        const stream = args.resource_stream || opts.resource_name;
        if (!stream) {
            throw inputError(
                'target "resource_stream" needs target_args.resource_stream (defaults to the API resource name when omitted)',
            );
        }
        data.resource_stream = stream;
    } else {
        const requiredKey = TARGET_KEY[target];
        if (requiredKey) {
            const value = args[requiredKey];
            if (typeof value !== 'string' || !value) {
                throw inputError(
                    `target "${target}" requires target_args.${requiredKey} to be a non-empty string`,
                );
            }
            data[requiredKey] = value;
        }
    }

    assertValidPayloadType(opts.payload_type);
    // template_payload is the platform default. The frontend encodes it
    // as an empty string when round-tripping, but we accept the explicit
    // value here too and pass it through unchanged.
    if (opts.payload_type !== undefined) data.payload_type = opts.payload_type;
    if (opts.payload !== undefined) {
        if (typeof opts.payload !== 'string') {
            throw inputError('payload must be a string');
        }
        data.payload = opts.payload;
    }
    if (opts.payload_function !== undefined) {
        if (typeof opts.payload_function !== 'string') {
            throw inputError('payload_function must be a string');
        }
        data.payload_function = opts.payload_function;
    }

    return data;
}

/**
 * Build the `response.data` block for a profile API resource. `response`
 * is optional on the wire; this helper produces a sensible default of
 * `{ payload_type: 'none' }` when the caller wants a fire-and-forget
 * resource, which matches the stream-style shape used by the
 * `backup_complete` example.
 *
 * @param {{
 *   payload_type?: string,
 *   source?: string,
 *   payload?: string,
 *   payload_function?: string,
 * } | undefined | null} response
 */
export function buildApiResponseData(response) {
    if (!response) return { payload_type: 'none' };
    const data = {};
    assertValidPayloadType(response.payload_type, 'response.payload_type');
    if (response.payload_type !== undefined) data.payload_type = response.payload_type;
    if (response.source !== undefined) {
        if (typeof response.source !== 'string') {
            throw inputError('response.source must be a string');
        }
        data.source = response.source;
    }
    if (response.payload !== undefined) {
        if (typeof response.payload !== 'string') {
            throw inputError('response.payload must be a string');
        }
        data.payload = response.payload;
    }
    if (response.payload_function !== undefined) {
        if (typeof response.payload_function !== 'string') {
            throw inputError('response.payload_function must be a string');
        }
        data.payload_function = response.payload_function;
    }
    if (Object.keys(data).length === 0) {
        return { payload_type: 'none' };
    }
    return data;
}

// ─── Low-level: profile/api/<name> ───────────────────────────────────

/** Returns the `{ resourceName: definition }` map; `{}` when none. */
export async function getProductApiResources(productId, user) {
    try {
        const res = await api.get(`${v1(user)}/products/${productId}/profile/api`);
        return res.data || {};
    } catch (e) {
        if (e.response?.status === 404) return {};
        throw apiError(e);
    }
}

export async function getProductApiResource(productId, name, user) {
    try {
        const res = await api.get(`${v1(user)}/products/${productId}/profile/api/${name}`);
        return res.data || {};
    } catch (e) {
        throw apiError(e, {
            notFound: `API resource not found: ${name} on product ${productId}`,
        });
    }
}

/**
 * Upsert a profile API resource by passing the full `{request, response, ...}`
 * document straight through. Use `setProfileApiResource` (below) for the
 * higher-level builder that takes target/target_args/payload* fields and
 * assembles the document for you.
 */
export async function setProductApiResource(productId, name, user, payload) {
    try {
        await api.put(`${v1(user)}/products/${productId}/profile/api/${name}`, payload);
    } catch (e) {
        throw apiError(e);
    }
}

export async function deleteProductApiResource(productId, name, user) {
    try {
        await api.delete(`${v1(user)}/products/${productId}/profile/api/${name}`);
        return true;
    } catch (e) {
        if (e.response?.status === 404) return false;
        throw apiError(e);
    }
}

/**
 * Upsert a profile API resource using the structured target/payload shape.
 * Lets callers configure any of the platform's dispatch targets without
 * hand-rolling the JSON. Required fields per target are validated client-
 * side: missing `target_args.resource` for `target: "resource"` raises
 * `inputError` instead of waiting for a 400 from the server.
 *
 * @param {string} productId
 * @param {string} name  API resource name (becomes `profile.api.<name>`).
 * @param {string|null|undefined} user
 * @param {{
 *   target: string,
 *   target_args?: Record<string, unknown>,
 *   payload_type?: string,
 *   payload?: string,
 *   payload_function?: string,
 *   response?: {
 *     payload_type?: string,
 *     source?: string,
 *     payload?: string,
 *     payload_function?: string,
 *   } | null,
 *   enabled?: boolean,
 * }} opts
 */
export async function setProfileApiResource(productId, name, user, opts) {
    if (!productId) throw inputError('productId is required');
    if (!name) throw inputError('name is required');
    const requestData = buildApiRequestData({ ...opts, resource_name: name });
    const responseData = buildApiResponseData(opts.response);
    const payload = {
        enabled: opts.enabled !== false,
        request: { data: requestData },
        response: { data: responseData },
    };
    await setProductApiResource(productId, name, user, payload);
    return payload;
}

// ─── Low-level: profile/buckets/<name> ───────────────────────────────

export async function getProductBuckets(productId, user) {
    try {
        const res = await api.get(`${v1(user)}/products/${productId}/profile/buckets`);
        return res.data || {};
    } catch (e) {
        if (e.response?.status === 404) return {};
        throw apiError(e);
    }
}

export async function getProductBucket(productId, name, user) {
    try {
        const res = await api.get(`${v1(user)}/products/${productId}/profile/buckets/${name}`);
        return res.data || {};
    } catch (e) {
        throw apiError(e, {
            notFound: `Profile bucket not found: ${name} on product ${productId}`,
        });
    }
}

export async function setProductBucket(productId, name, user, payload) {
    try {
        await api.put(`${v1(user)}/products/${productId}/profile/buckets/${name}`, payload);
    } catch (e) {
        throw apiError(e);
    }
}

export async function deleteProductBucket(productId, name, user) {
    try {
        await api.delete(`${v1(user)}/products/${productId}/profile/buckets/${name}`);
        return true;
    } catch (e) {
        if (e.response?.status === 404) return false;
        throw apiError(e);
    }
}

const RETENTION_UNITS = ['minutes', 'hours', 'days', 'months', 'years'];

function buildRetention(retention) {
    if (retention === undefined || retention === null) return undefined;
    if (typeof retention !== 'object' || Array.isArray(retention)) {
        throw inputError('retention must be an object { period, unit }');
    }
    const period = Number(retention.period);
    if (!Number.isFinite(period) || period <= 0) {
        throw inputError('retention.period must be a positive number');
    }
    const unit = retention.unit;
    if (!RETENTION_UNITS.includes(unit)) {
        throw inputError(`retention.unit must be one of: ${RETENTION_UNITS.join(', ')}`);
    }
    return { period, unit };
}

/**
 * Upsert a profile bucket using the structured source/payload shape. The
 * server creates / migrates the underlying time-series bucket lazily on
 * the first event delivery (see `product_bucket_handler::initialize_bucket`).
 *
 * @param {string} productId
 * @param {string} name
 * @param {string|null|undefined} user
 * @param {{
 *   source: string,
 *   source_args?: Record<string, unknown>,
 *   payload_type?: string,
 *   payload?: string,
 *   payload_function?: string,
 *   name_label?: string,
 *   description?: string,
 *   enabled?: boolean,
 *   backend?: string,
 *   retention?: { period: number, unit: string },
 *   tags?: string[],
 * }} opts
 */
export async function setProfileBucket(productId, name, user, opts) {
    if (!productId) throw inputError('productId is required');
    if (!name) throw inputError('name is required');

    const data = buildListenerDataBlock(opts);
    const payload = {
        enabled: opts.enabled !== false,
        name: opts.name_label || name,
        description: opts.description || `Bucket for ${productId} product`,
        backend: opts.backend || 'mongodb',
        data,
        tags: Array.isArray(opts.tags) ? opts.tags : [],
    };
    const retention = buildRetention(opts.retention);
    if (retention) payload.retention = retention;

    await setProductBucket(productId, name, user, payload);
    return payload;
}

// ─── Low-level: profile/properties/<name> ────────────────────────────
//
// NOTE: `getProductProfileProperty` ≠ `getProductProperty`. The former
// lives under `profile/properties/<name>` and configures a *handler* that
// fans listener output into device properties. The latter (in product.js)
// reads a JSON value attached to the product itself. See file header.

export async function getProductProfileProperties(productId, user) {
    try {
        const res = await api.get(`${v1(user)}/products/${productId}/profile/properties`);
        return res.data || {};
    } catch (e) {
        if (e.response?.status === 404) return {};
        throw apiError(e);
    }
}

export async function getProductProfileProperty(productId, name, user) {
    try {
        const res = await api.get(`${v1(user)}/products/${productId}/profile/properties/${name}`);
        return res.data || {};
    } catch (e) {
        throw apiError(e, {
            notFound: `Profile property not found: ${name} on product ${productId}`,
        });
    }
}

export async function setProductProfileProperty(productId, name, user, payload) {
    try {
        await api.put(`${v1(user)}/products/${productId}/profile/properties/${name}`, payload);
    } catch (e) {
        throw apiError(e);
    }
}

export async function deleteProductProfileProperty(productId, name, user) {
    try {
        await api.delete(`${v1(user)}/products/${productId}/profile/properties/${name}`);
        return true;
    } catch (e) {
        if (e.response?.status === 404) return false;
        throw apiError(e);
    }
}

/**
 * Upsert a profile property handler using the structured source/payload
 * shape. When `patch: true` is passed, the platform applies the resulting
 * value as a JSON merge-patch on top of the existing device property
 * instead of replacing it wholesale (see
 * `product_property_handler::set_config` for the `data.patch` flag).
 *
 * @param {string} productId
 * @param {string} name
 * @param {string|null|undefined} user
 * @param {{
 *   source: string,
 *   source_args?: Record<string, unknown>,
 *   payload_type?: string,
 *   payload?: string,
 *   payload_function?: string,
 *   name_label?: string,
 *   description?: string,
 *   enabled?: boolean,
 *   patch?: boolean,
 * }} opts
 */
export async function setProfileProperty(productId, name, user, opts) {
    if (!productId) throw inputError('productId is required');
    if (!name) throw inputError('name is required');

    const data = buildListenerDataBlock(opts);
    const payload = {
        enabled: opts.enabled !== false,
        name: opts.name_label || name,
        description: opts.description || `Property handler for ${productId} product`,
        data,
    };
    await setProductProfileProperty(productId, name, user, payload);
    return payload;
}
