import { resolveUser } from './config.js';
import { device } from './paths.js';
import api from './api.js';
import { apiError } from './errors.js';
import { info, warning, hint } from './format.js';

// Drops internal resources whose keys start with `$`; those belong to
// the agent's own framework (cmd, fs, scripts…) and shouldn't surface
// through the user-facing resource list.
export async function getDeviceResources(deviceId, options = {}) {
    const user = resolveUser(options.user);

    try {
        // `/resources/api` merges firmware resources with API resources
        // inherited from the product profile, which `/resources` alone omits.
        const response = await api.get(`${device(user, deviceId)}/resources/api`);
        return Object.fromEntries(
            Object.entries(response.data).filter(([key]) => !key.startsWith('$')),
        );
    } catch (error) {
        throw apiError(error, {
            notFound: `Device not found: ${deviceId} (account ${user})`,
        });
    }
}

/**
 * Read the current value of a resource via GET. Appropriate for
 * output-only (fn=3) or fn=4 resources when you only want the latest
 * sample, not to trigger the input side.
 */
export async function readDeviceResource(deviceId, resourceId, options = {}) {
    const user = resolveUser(options.user);
    try {
        const response = await api.get(`${device(user, deviceId)}/resources/${resourceId}`);
        return response.data;
    } catch (error) {
        throw apiError(error, {
            notFound: `Resource not found: ${resourceId} on device ${deviceId} (account ${user})`,
        });
    }
}

/**
 * Introspect a single resource. Returns the `{in, out}` schema the
 * agent advertises for that resource, e.g. for `cmd`:
 *   { in: { cmd: "", mode: "api", timeout: 30 }, out: { stdout: "", stderr: "", retcode: 0 } }
 *
 * Read-only resources (fn=3) only return `out`; input-only (fn=2) only
 * return `in`; fn=1 may return an empty object. Not every agent/firmware
 * exposes /api — callers should tolerate 404/501.
 */
export async function getDeviceResourceApi(deviceId, resourceId, options = {}) {
    const user = resolveUser(options.user);
    try {
        const response = await api.get(`${device(user, deviceId)}/resources/${resourceId}/api`);
        return response.data;
    } catch (error) {
        throw apiError(error, {
            notFound: `Resource not found: ${resourceId} on device ${deviceId} (account ${user})`,
        });
    }
}

export async function executeDeviceResource(deviceId, resourceId, inputs, options = {}) {
    const user = resolveUser(options.user);

    try {
        const response = await api.post(
            `${device(user, deviceId)}/resources/${resourceId}`,
            inputs,
        );
        return response.data;
    } catch (error) {
        throw apiError(error, {
            notFound: `Resource not found: ${resourceId} on device ${deviceId} (account ${user})`,
        });
    }
}

/**
 * Decide GET vs POST based on whether the caller passed real inputs.
 * No inputs (undefined, null, or an empty object) → GET, which reads
 * the output side of fn=3/4 resources without triggering the input
 * handler. Otherwise POST with the payload.
 */
export async function callDeviceResource(deviceId, resourceId, inputs, options = {}) {
    const hasInputs =
        inputs !== undefined &&
        inputs !== null &&
        !(typeof inputs === 'object' && !Array.isArray(inputs) && Object.keys(inputs).length === 0);
    return hasInputs
        ? executeDeviceResource(deviceId, resourceId, inputs, options)
        : readDeviceResource(deviceId, resourceId, options);
}

/**
 * Fetch the resource list and, in parallel, introspect each resource's
 * `/api` schema. Returns an array with `{name, fn, in?, out?}` so both
 * the CLI and the MCP can render the same information.
 */
export async function listDeviceResourcesWithSchemas(deviceId, options = {}) {
    const resources = await getDeviceResources(deviceId, options);
    const names = Object.keys(resources);
    const entries = await Promise.all(
        names.map(async (name) => {
            const fn = resources[name]?.fn;
            try {
                const schema = await getDeviceResourceApi(deviceId, name, options);
                return { name, fn, ...schema };
            } catch {
                return { name, fn };
            }
        }),
    );
    return entries;
}

/**
 * Format the resource entries produced by listDeviceResourcesWithSchemas
 * (`{name, fn, in?, out?}`). Shared between CLI (with chalk) and any
 * other human-facing surface.
 */
export function formatDeviceResourcesWithSchemas(deviceId, entries) {
    let out = `\nResources for device ${info(deviceId)}:\n`;
    if (!entries || entries.length === 0) {
        return out + warning('No resources found for this device.\n');
    }
    for (const e of entries) {
        const kind = getResourceType({ fn: e.fn });
        out += `\n- ${info(e.name)}  ${hint('[' + kind + ']')}\n`;
        if (e.in !== undefined) out += `    in:  ${JSON.stringify(e.in)}\n`;
        if (e.out !== undefined) out += `    out: ${JSON.stringify(e.out)}\n`;
    }
    return out;
}

function getResourceType(value) {
    switch (value.fn) {
        case 1:
            return 'no parameters';
        case 2:
            return 'input';
        case 3:
            return 'output';
        case 4:
            return 'input/output';
        default:
            return 'unknown';
    }
}
