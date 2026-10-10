// @ts-check
import {
    getProducts,
    getProduct,
    createProduct,
    productExists,
    updateProduct,
    deleteProduct,
    getProductApi,
    getProductProperties,
    getProductProperty,
    setProductProperty,
    deleteProductProperty,
} from '../product.js';
import { alreadyExistsError, inputError } from '../errors.js';

const PRODUCT_ID_RE = /^[A-Za-z0-9._-]+$/;

/** Validate an `icon` argument and turn it into the server's icon spec. */
function iconSpecFrom(icon) {
    if (!icon.source) throw inputError('icon.source is required when icon is set');
    const type = icon.type || 'fa';
    if (type !== 'fa' && type !== 'svg') {
        throw inputError(`icon.type must be "fa" or "svg" (got "${type}")`);
    }
    return {
        type,
        source: icon.source,
        color: icon.color || '#000000',
        background: icon.background || '#ffffff',
    };
}

async function toolProducts(args) {
    const user = args.user;
    const products = await getProducts(user);
    if (products.length === 0) {
        return { content: [{ type: 'text', text: 'No products configured' }], isError: false };
    }
    const lines = await Promise.all(
        products.map(async (p) => {
            const id = p.product;
            const label = p.name && p.name !== id ? ` (${p.name})` : '';
            const enabled = p.enabled ? '✓' : '✗';
            const apis = await getProductApi(id, user);
            const scripts = Object.keys(apis).length;
            const scriptsLabel = scripts > 0 ? ` — ${scripts} API resource(s)` : '';
            return `${enabled}  ${id}${label}${scriptsLabel}`;
        }),
    );
    return {
        content: [{ type: 'text', text: `${products.length} product(s):\n${lines.join('\n')}` }],
        isError: false,
    };
}

async function toolProductCreate(args) {
    if (!args.product) throw inputError('product is required');
    if (!PRODUCT_ID_RE.test(args.product)) {
        throw inputError(
            `Invalid product id "${args.product}" (allowed: letters, digits, dot, dash, underscore)`,
        );
    }
    if (await productExists(args.product, args.user)) {
        throw alreadyExistsError(`Product "${args.product}" already exists`);
    }

    const config = args.config ? { ...args.config } : {};
    if (args.icon) config.icons = [{ conditions: [], icon: iconSpecFrom(args.icon) }];

    await createProduct(args.product, args.user, {
        name: args.name,
        description: args.description,
        enabled: args.enabled ?? true,
        config,
        profile: args.profile,
    });

    return {
        content: [
            {
                type: 'text',
                text: `Created product "${args.product}"${args.name ? ` (${args.name})` : ''}.`,
            },
        ],
        isError: false,
    };
}

async function toolProductUpdate(args) {
    if (!args.product) throw inputError('product is required');

    const patch = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.description !== undefined) patch.description = args.description;
    if (args.enabled !== undefined) patch.enabled = !!args.enabled;

    if (args.icon) {
        const icon = iconSpecFrom(args.icon);
        // Fetch current config so the icon update doesn't clobber unrelated
        // fields (`type`, custom dashboards, profile-side bits the API
        // groups under config).
        const current = await getProduct(args.product, args.user);
        const config = { ...(current?.config || {}) };
        config.icons = [
            {
                conditions: [],
                icon,
            },
        ];
        patch.config = config;
    }

    const fields = Object.keys(patch);
    if (fields.length === 0) {
        throw inputError('at least one of name, description, enabled, icon must be provided');
    }

    await updateProduct(args.product, args.user, patch);

    const summary = fields.map((f) => (f === 'config' ? 'icon' : f)).join(', ');
    return {
        content: [{ type: 'text', text: `Updated product "${args.product}" (${summary}).` }],
        isError: false,
    };
}

async function toolProductDelete(args) {
    if (!args.product) throw inputError('product is required');
    const removed = await deleteProduct(args.product, args.user);
    return {
        content: [
            {
                type: 'text',
                text: removed
                    ? `Deleted product "${args.product}".`
                    : `Product "${args.product}" did not exist.`,
            },
        ],
        isError: false,
    };
}

async function toolProductPropertyGet(args) {
    if (!args.product) throw inputError('product is required');
    if (args.property) {
        const value = await getProductProperty(args.product, args.property, args.user);
        return {
            content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
            isError: false,
        };
    }
    const list = await getProductProperties(args.product, args.user);
    const names = Array.isArray(list) ? list.map((p) => p.property).filter(Boolean) : [];
    return {
        content: [{ type: 'text', text: names.length ? names.join('\n') : '(no properties)' }],
        isError: false,
    };
}

async function toolProductPropertySet(args) {
    if (!args.product) throw inputError('product is required');
    if (!args.property) throw inputError('property is required');
    if (args.value === undefined) throw inputError('value is required');
    const saved = await setProductProperty(args.product, args.property, args.value, args.user);
    return {
        content: [
            {
                type: 'text',
                text: `Saved property "${saved.property}" on product "${saved.product || args.product}" (value: ${JSON.stringify(saved.value)})`,
            },
        ],
        isError: false,
    };
}

async function toolProductPropertyDelete(args) {
    if (!args.product) throw inputError('product is required');
    if (!args.property) throw inputError('property is required');
    const removed = await deleteProductProperty(args.product, args.property, args.user);
    return {
        content: [
            {
                type: 'text',
                text: removed
                    ? `Deleted property "${args.property}" from product "${args.product}".`
                    : `Property "${args.property}" was not set on product "${args.product}".`,
            },
        ],
        isError: false,
    };
}

export const tools = [
    {
        name: 'products',
        description:
            'List all products configured on the account, with their enabled flag and how many API resources their profile declares. Use this before assigning a device to a product with {tool:device_set_product}, or before editing a product profile with the {family:product_profile} tools.',
        inputSchema: {
            type: 'object',
            properties: {
                user: { type: 'string', description: 'API user' },
            },
            required: [],
        },
        handler: toolProducts,
    },
    {
        name: 'product_create',
        description: `Create a new product. The product ID is immutable — pick it carefully (letters, digits, dot, dash, underscore). Optionally set the display name, description and icon at creation time.

A product can be created bare and configured afterwards with the profile tools ({tool:product_profile_bucket_set}, {tool:product_profile_api_set}, {tool:product_profile_property_set}), or in one call by passing the whole \`profile\` object (and \`config\`) as the server stores them.

Failure mode: refuses to overwrite an existing product. Use {tool:product_update} to change metadata on a product that already exists.

Typical flow: {tool:products} to discover what is already there, {tool:product_create} to register the new one, the profile tools to declare its buckets / API resources / property handlers, {tool:device_set_product} to assign devices.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: {
                    type: 'string',
                    description:
                        'Stable product ID (letters, digits, dot, dash, underscore). Cannot be changed later.',
                },
                name: {
                    type: 'string',
                    description:
                        'Display name shown across the platform UI. Defaults to the product ID.',
                },
                description: {
                    type: 'string',
                    description: 'Free-form description.',
                },
                enabled: {
                    type: 'boolean',
                    description: 'Whether the product starts enabled. Default: true.',
                },
                icon: {
                    type: 'object',
                    description:
                        "Optional icon. Pick `type: 'fa'` for a Font Awesome class or `type: 'svg'` for inline SVG markup. Defaults to the platform's generic product icon.",
                    properties: {
                        type: {
                            type: 'string',
                            enum: ['fa', 'svg'],
                            description:
                                "Icon kind: 'fa' (default) for Font Awesome class, 'svg' for inline SVG markup.",
                        },
                        source: {
                            type: 'string',
                            description:
                                'Font Awesome class (e.g. "fab fa-linux", "fas fa-server") or full SVG markup including the `<svg>` wrapper.',
                        },
                        color: {
                            type: 'string',
                            description: 'Hex foreground color. Default: #000000.',
                        },
                        background: {
                            type: 'string',
                            description: 'Hex background color. Default: #ffffff.',
                        },
                    },
                    required: ['source'],
                },
                config: {
                    type: 'object',
                    description:
                        'Raw product `config` as the server stores it (e.g. autoprovisioning rules). `icon` is merged into it.',
                },
                profile: {
                    type: 'object',
                    description:
                        'Raw product `profile` as the server stores it: `{ api, buckets, properties, ... }`. Prefer the profile tools for incremental changes.',
                },
                user: { type: 'string', description: 'API user' },
            },
            required: ['product'],
        },
        handler: toolProductCreate,
    },
    {
        name: 'product_update',
        description: `Update product metadata in place. Pass any subset of fields (\`name\`, \`description\`, \`enabled\`, \`icon\`) — only the supplied ones are modified, the rest are left untouched. Useful to set a friendlier display name shown across the platform UI, change the description, toggle the product on or off, or replace its icon.

Icons accept Font Awesome classes (\`{ type: "fa", source: "fab fa-linux" }\`) or inline SVG markup (\`{ type: "svg", source: "<svg ...>...</svg>" }\`). When an icon is supplied, the current product config is fetched first so unrelated fields are preserved.

Does not change the product ID. To rename the ID itself, the product has to be recreated and devices reassigned.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID to update.' },
                name: {
                    type: 'string',
                    description:
                        'Display name shown across the platform UI (dashboards, lists, etc.).',
                },
                description: {
                    type: 'string',
                    description: 'Free-form description.',
                },
                enabled: {
                    type: 'boolean',
                    description:
                        'Enable or disable the product. Disabled products do not apply their profile to devices.',
                },
                icon: {
                    type: 'object',
                    description:
                        "Replace the product's icon. Pick `type: 'fa'` for a Font Awesome class or `type: 'svg'` for inline SVG markup.",
                    properties: {
                        type: {
                            type: 'string',
                            enum: ['fa', 'svg'],
                            description:
                                "Icon kind: 'fa' (default) for Font Awesome class, 'svg' for inline SVG markup.",
                        },
                        source: {
                            type: 'string',
                            description:
                                'Font Awesome class (e.g. "fab fa-linux", "fas fa-server") or full SVG markup including the `<svg>` wrapper.',
                        },
                        color: {
                            type: 'string',
                            description: 'Hex foreground color. Default: #000000.',
                        },
                        background: {
                            type: 'string',
                            description: 'Hex background color. Default: #ffffff.',
                        },
                    },
                    required: ['source'],
                },
                user: { type: 'string', description: 'API user' },
            },
            required: ['product'],
        },
        handler: toolProductUpdate,
    },
    {
        name: 'product_delete',
        description:
            'Delete a product. Destructive: confirm with the user before calling. Devices assigned to it are left in place, unassigned. Idempotent: succeeds when the product was already absent.',
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID to delete.' },
                user: { type: 'string', description: 'API user' },
            },
            required: ['product'],
        },
        handler: toolProductDelete,
    },
    {
        name: 'product_property_get',
        description: `Read a product-level property (not a device property). Product properties are structured JSON values attached to the product itself — typical uses include dashboard configuration or shared feature flags. Call without \`property\` to list the names of every property configured on the product.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                property: {
                    type: 'string',
                    description:
                        'Property name. Omit to list the names of all properties on the product.',
                },
                user: { type: 'string', description: 'API user' },
            },
            required: ['product'],
        },
        handler: toolProductPropertyGet,
    },
    {
        name: 'product_property_set',
        description: `Upsert a product-level property: creates the property if missing, overwrites it wholesale if it already exists. The value can be any JSON-serialisable shape (string, number, object, array).

Naming convention: this tool follows the upsert pattern shared by every per-product leaf (\`*_set\`, \`*_write\`). Container-level operations (the product itself) split create and update into separate tools so a fresh registration cannot accidentally overwrite an existing product's metadata.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                property: { type: 'string', description: 'Property name to create or overwrite.' },
                value: {
                    description:
                        'Any JSON-serialisable value (string, number, boolean, object, array).',
                },
                user: { type: 'string', description: 'API user' },
            },
            required: ['product', 'property', 'value'],
        },
        handler: toolProductPropertySet,
    },
    {
        name: 'product_property_delete',
        description: `Delete a product-level property. Idempotent — returns success even if the property was not set.`,
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product ID.' },
                property: { type: 'string', description: 'Property name to delete.' },
                user: { type: 'string', description: 'API user' },
            },
            required: ['product', 'property'],
        },
        handler: toolProductPropertyDelete,
    },
];
