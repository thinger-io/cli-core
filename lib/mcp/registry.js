// @ts-check
import { tools as devicesTools } from './tools-devices.js';
import { tools as resourcesTools } from './tools-resources.js';
import { tools as propertiesTools } from './tools-properties.js';
import { tools as productsTools } from './tools-products.js';
import { tools as profilesTools } from './tools-profiles.js';
import { tools as bucketsTools } from './tools-buckets.js';
import { tools as productProfileTools } from './tools-profile.js';
import { tools as tokensTools } from './tools-tokens.js';
import { tools as alarmsTools } from './tools-alarms.js';
import { expandToolRefs, toolName } from './naming.js';

/** Tools available to every CLI, declared with their bare names. */
export const genericTools = [
    ...devicesTools,
    ...resourcesTools,
    ...propertiesTools,
    ...productsTools,
    ...profilesTools,
    ...bucketsTools,
    ...productProfileTools,
    ...tokensTools,
    ...alarmsTools,
];

// `profiles` is the lookup of the profiles themselves, so it takes none.
const PROFILE_EXEMPT = new Set(['profiles']);

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
 */
export function buildTools(extraTools = []) {
    // A CLI may replace a generic tool with its own (same name, flagged
    // `replaces: true`): its platform knows more about that operation.
    // Without the flag a clash is a mistake and fails loudly.
    const replaced = new Set();
    const extraNames = new Set();
    for (const t of extraTools) {
        if (extraNames.has(t.name)) throw new Error(`Duplicate MCP tool name: ${t.name}`);
        extraNames.add(t.name);
        const generic = genericTools.some((g) => g.name === t.name);
        if (t.replaces && !generic) {
            throw new Error(`MCP tool "${t.name}" replaces no generic tool`);
        }
        if (generic && !t.replaces) throw new Error(`Duplicate MCP tool name: ${t.name}`);
        if (generic) replaced.add(t.name);
    }
    const declared = [...genericTools.filter((t) => !replaced.has(t.name)), ...extraTools];
    const known = new Set(declared.map((t) => t.name));

    return declared.map((t) => {
        const inputSchema = expandSchema(structuredClone(t.inputSchema), known, t.name);
        if (!PROFILE_EXEMPT.has(t.name)) {
            inputSchema.properties = inputSchema.properties || {};
            inputSchema.properties.profile = {
                type: 'string',
                description: `CLI profile to use for this call (see ${toolName('profiles')}). Omit for the default.`,
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
