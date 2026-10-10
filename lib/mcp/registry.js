// @ts-check
import { tools as bucketTools } from './tools-buckets.js';
import { tools as dashboardTools } from './tools-dashboards.js';
import { tools as deviceTools } from './tools-devices.js';
import { tools as miscTools } from './tools-misc.js';
import { tools as productTools } from './tools-products.js';
import { resourceTools } from './tools-resource.js';
import { tools as storageTools } from './tools-storage.js';
import { readSdkReference } from '../dashboard.js';
import { identity } from '../identity.js';
import { expandToolRefs, toolName } from './naming.js';

/**
 * @typedef {object} ToolOptions
 * @property {boolean} [admin]  Also serve the administration types (roles, syncs,
 *   project members and roles) through the `resource_*` tools.
 * @property {Record<string, import('./resource-hooks.js').ResourceHooks>} [hooks]
 *   The CLI's own hooks on catalog types (see resource-hooks.js).
 */

/**
 * Tools available to every CLI, declared with their bare names: the
 * generic `resource_*` ones over the catalog, and the few operations that
 * are not CRUD.
 *
 * @param {ToolOptions} [opts]
 */
export function genericTools(opts = {}) {
    return [
        ...resourceTools(opts),
        ...deviceTools,
        ...productTools,
        ...bucketTools,
        ...storageTools,
        ...dashboardTools,
        ...miscTools,
    ];
}

// `profile_list` is the lookup of the profiles themselves, so it takes none.
const PROFILE_EXEMPT = new Set(['profile_list']);

/**
 * Build the tool list a CLI serves: its own tools on top of the generic
 * ones, every name prefixed with the identity's tool prefix, `{tool:x}`
 * references in descriptions expanded, and the optional `profile`
 * parameter injected so callers can target any configured environment
 * per call without changing the saved default.
 *
 * Returns fresh objects: the declarations stay untouched, so building
 * twice (tests, a CLI adding tools) never double-prefixes anything.
 *
 * @param {Array<object>} [extraTools] CLI-specific tools, same shape as the
 *   generic ones; `replaces: true` swaps out the generic tool of that name.
 * @param {ToolOptions} [opts]
 */
export function buildTools(extraTools = [], opts = {}) {
    const generic = genericTools(opts);
    // A CLI may replace a generic tool with its own (same name, flagged
    // `replaces: true`): its platform knows more about that operation.
    // Without the flag a clash is a mistake and fails loudly.
    const replaced = new Set();
    const extraNames = new Set();
    for (const t of extraTools) {
        if (extraNames.has(t.name)) throw new Error(`Duplicate MCP tool name: ${t.name}`);
        extraNames.add(t.name);
        const isGeneric = generic.some((g) => g.name === t.name);
        if (t.replaces && !isGeneric) {
            throw new Error(`MCP tool "${t.name}" replaces no generic tool`);
        }
        if (isGeneric && !t.replaces) throw new Error(`Duplicate MCP tool name: ${t.name}`);
        if (isGeneric) replaced.add(t.name);
    }
    const declared = [...generic.filter((t) => !replaced.has(t.name)), ...extraTools];
    const known = new Set(declared.map((t) => t.name));

    return declared.map((t) => {
        const inputSchema = expandSchema(structuredClone(t.inputSchema), known, t.name);
        if (!PROFILE_EXEMPT.has(t.name)) {
            inputSchema.properties = inputSchema.properties || {};
            inputSchema.properties.profile = {
                type: 'string',
                description: `CLI profile (server) for this call, see ${toolName('profile_list')}. Omit for the default.`,
            };
        }
        const { replaces: _replaces, ...rest } = t;
        return {
            ...rest,
            name: toolName(t.name),
            description: expandToolRefs(t.description, known, t.name),
            inputSchema,
        };
    });
}

/** Expand tool references in every `description` of a JSON schema. */
function expandSchema(node, known, where) {
    if (Array.isArray(node)) return node.map((n) => expandSchema(n, known, where));
    if (!node || typeof node !== 'object') return node;
    for (const [key, value] of Object.entries(node)) {
        node[key] =
            key === 'description' && typeof value === 'string'
                ? expandToolRefs(value, known, where)
                : expandSchema(value, known, where);
    }
    return node;
}

/**
 * MCP resources every CLI serves: reference documents read from the server
 * of the default profile, so they match the version it runs.
 */
export function buildResources() {
    const prefix = identity().mcp.toolPrefix;
    return [
        {
            uri: `${prefix}://dashboard-sdk`,
            name: 'dashboard-sdk',
            title: 'Dashboard SDK reference',
            description: `Reference of the SDK that HTML dashboards use (/sdk/thinger-dashboard.js), read from the server. Publish such a dashboard with ${toolName('dashboard_publish')}.`,
            mimeType: 'text/plain',
            read: readSdkReference,
        },
    ];
}
