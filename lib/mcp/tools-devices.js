// @ts-check
import {
    CREDENTIAL_DEVICE_TYPES,
    DEVICE_TYPES,
    createDevice,
    deleteDevice,
    generateDeviceCredentials,
    getDevice,
    getDevices,
} from '../devices.js';
import { setDeviceProduct } from '../product.js';
import { inputError } from '../errors.js';

async function toolDevices(args) {
    const query = args.query ? String(args.query).trim() : '';
    const filter = query ? { name: query } : {};
    const devices = await getDevices(filter, args.user);

    // `connection.ts` is when the state last changed, so it reads as
    // "connected since" for a live device and "offline since" for a dead
    // one: it tells at a glance whether something dropped a minute ago
    // or back in July.
    const since = (d) => {
        const ts = d.connection?.ts;
        if (!ts) return '';
        const when = new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
        return d.connection?.active ? `  connected since ${when}` : `  offline since ${when}`;
    };

    const renderLine = (d) => {
        const status = d.connection?.active ? 'online ' : 'offline';
        const label = d.name ? ` (${d.name})` : '';
        const type = d.type && d.type !== 'Generic' ? ` <${d.type}>` : '';
        const product = d.product ? ` [${d.product}]` : '';
        return `${status}  ${d.device ?? '(record without id)'}${label}${type}${product}${since(d)}`;
    };

    if (!query) {
        return {
            content: [
                { type: 'text', text: devices.map(renderLine).join('\n') || 'No devices found' },
            ],
            isError: false,
        };
    }

    const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 20;
    const limited = devices.slice(0, limit);
    const header =
        devices.length === 0
            ? `No devices match "${query}"`
            : `${devices.length} match(es) for "${query}"${devices.length > limit ? ` — showing first ${limit}` : ''}:`;
    return {
        content: [{ type: 'text', text: [header, ...limited.map(renderLine)].join('\n') }],
        isError: false,
    };
}

async function toolDeviceInfo(args) {
    const device = args.device_id;
    if (!device) throw inputError('device_id is required');
    const record = await getDevice(device, args.user);
    const c = record.connection || {};
    const meta = [];
    const add = (key, value) => {
        if (value !== undefined && value !== null && value !== '') {
            meta.push(`${(key + ':').padEnd(15)}${value}`);
        }
    };
    add('device', record.device);
    add('name', record.name);
    add('type', record.type);
    add('protocol', record.protocol);
    add('product', record.product);
    add('asset_group', record.asset_group);
    add('asset_type', record.asset_type);
    add('description', record.description);
    add('enabled', record.enabled);
    if (record.labels && Object.keys(record.labels).length) {
        add('labels', JSON.stringify(record.labels));
    }
    if (record.connection) {
        const since = c.ts ? ` since ${new Date(c.ts).toISOString()}` : '';
        add('connection', `${c.active ? 'online' : 'offline'}${since}`);
        add('ip_address', c.ip ?? c.ip_address);
    }
    // Everything else the server reports (traffic counters, location,
    // security, timeouts…) as JSON: the fields vary with the device type.
    const shown = new Set(['ts', 'active', 'ip', 'ip_address']);
    const rest = Object.fromEntries(Object.entries(c).filter(([k]) => !shown.has(k)));
    const text = Object.keys(rest).length
        ? `${meta.join('\n')}\n\nconnection details:\n${JSON.stringify(rest, null, 2)}`
        : meta.join('\n');
    return { content: [{ type: 'text', text }], isError: false };
}

async function toolDeviceCreate(args) {
    if (!args.device_id) throw inputError('device_id is required');
    const type = args.type || 'Generic';
    if (!DEVICE_TYPES.includes(type)) {
        throw inputError(`type must be one of ${DEVICE_TYPES.join(', ')} (got "${type}")`);
    }
    const needsCredentials = CREDENTIAL_DEVICE_TYPES.has(type);
    if (!needsCredentials && args.credentials) {
        throw inputError(`${type} devices do not take credentials`);
    }
    if (needsCredentials && args.credentials && args.credentials.length < 6) {
        throw inputError('credentials must be at least 6 characters');
    }
    const credentials = needsCredentials
        ? args.credentials || generateDeviceCredentials()
        : undefined;
    const sent = await createDevice(
        {
            device: args.device_id,
            type,
            name: args.name,
            description: args.description,
            credentials,
            product: args.product,
            asset_group: args.asset_group,
            asset_type: args.asset_type,
            labels: args.labels,
        },
        args.user,
    );
    const lines = [`Created ${type} device "${sent.device}".`];
    if (credentials) {
        lines.push(
            `credentials: ${credentials}`,
            '',
            'The server stores credentials hashed: this is the only time they can be read. Hand them to whoever flashes the device now.',
        );
    }
    return { content: [{ type: 'text', text: lines.join('\n') }], isError: false };
}

async function toolDeviceSetProduct(args) {
    const device = args.device_id;
    if (!device) throw inputError('device is required');
    if (args.product === undefined || args.product === null)
        throw inputError('product is required (pass "" to unassign)');
    await setDeviceProduct(device, args.product, args.user);
    const label =
        args.product === ''
            ? `Unassigned ${device} from its product.`
            : `Assigned ${device} → product "${args.product}".`;
    return { content: [{ type: 'text', text: label }], isError: false };
}

async function toolDeviceDelete(args) {
    const device = args.device_id;
    if (!device) throw inputError('device is required');
    const removed = await deleteDevice(device, args.user);
    return {
        content: [
            {
                type: 'text',
                text: removed ? `Deleted ${device}` : `Device ${device} did not exist`,
            },
        ],
        isError: false,
    };
}

export const tools = [
    {
        name: 'devices',
        description:
            'List devices with their online/offline status (and since when), type <in angle brackets> when not Generic, and assigned [product]. Pass `query` to filter by device id or name (case-insensitive regex on the server side, so plain substrings, anchors, wildcards and alternations all work). Use this before any other device tool to discover or narrow down ids.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description:
                        'Optional pattern matched against device id and name. Plain substrings work ("office"); regex metacharacters are also honoured ("^raspberry", "mac|book"). Case-insensitive.',
                },
                limit: {
                    type: 'number',
                    description:
                        'Maximum matches to return when `query` is set (default: 20). Ignored when listing without a query.',
                },
                user: {
                    type: 'string',
                    description:
                        'API user (for admin impersonation). Omit to use your own account.',
                },
            },
            required: [],
        },
        handler: toolDevices,
    },
    {
        name: 'device_info',
        description:
            'Get the server record of a device: type, protocol, assigned product, asset group/type, labels, description, and its connection state (online/offline since when, IP address, traffic counters and whatever else the server reports for that device type).',
        inputSchema: {
            type: 'object',
            properties: {
                device_id: { type: 'string', description: 'Device ID' },
                user: { type: 'string', description: 'API user' },
            },
            required: ['device_id'],
        },
        handler: toolDeviceInfo,
    },
    {
        name: 'device_create',
        description: `Register a new device on the server.

Types: "Generic" (default; devices using the platform client libraries over IOTMP), "MQTT", "HTTP" (devices pushing data through HTTP callbacks), "Virtual", "Subdevice". Generic and MQTT devices authenticate with credentials: pass \`credentials\` (6+ characters) or omit them to get random ones generated. The server stores them hashed, so the response is the only place they can be read — give them to the user right away.

Pass \`product\` to have the device inherit that product's profile (buckets, API resources, property handlers) from the start. Fails with code already_exists if the id is taken.`,
        inputSchema: {
            type: 'object',
            properties: {
                device_id: {
                    type: 'string',
                    description: 'New device ID (letters, digits, dash, underscore).',
                },
                type: {
                    type: 'string',
                    enum: ['Generic', 'MQTT', 'HTTP', 'Virtual', 'Subdevice'],
                    description: 'Device type. Default: Generic.',
                },
                credentials: {
                    type: 'string',
                    description:
                        'Device credentials for Generic/MQTT devices (6+ characters). Omit to generate random ones.',
                },
                name: { type: 'string', description: 'Display name.' },
                description: { type: 'string', description: 'Free-form description.' },
                product: { type: 'string', description: 'Product ID to assign the device to.' },
                asset_group: { type: 'string', description: 'Asset group ID.' },
                asset_type: { type: 'string', description: 'Asset type ID.' },
                labels: {
                    type: 'object',
                    description: 'Key/value string labels, e.g. {"site": "madrid"}.',
                    additionalProperties: { type: 'string' },
                },
                user: { type: 'string', description: 'API user' },
            },
            required: ['device_id'],
        },
        handler: toolDeviceCreate,
    },
    {
        name: 'device_set_product',
        description:
            "Assign a device to a product, or unassign it by passing an empty string. Devices inherit the product's API resources and profile configuration (scripts, buckets, etc.) once assigned. Typical flow: configure the product profile with {tool:product_profile_bucket_set} / {tool:product_profile_api_set}, then assign devices here.",
        inputSchema: {
            type: 'object',
            properties: {
                device_id: { type: 'string', description: 'Device ID' },
                product: {
                    type: 'string',
                    description: 'Product ID to assign, or empty string "" to unassign.',
                },
                user: { type: 'string', description: 'API user' },
            },
            required: ['device_id', 'product'],
        },
        handler: toolDeviceSetProduct,
    },
    {
        name: 'device_delete',
        description:
            'Delete a device record from the platform. Destructive and irreversible — drops the device, its server-side metadata, and stored properties. A device still running with the old credentials will fail to connect until it is registered again. Idempotent: returns success when the device was already absent.',
        inputSchema: {
            type: 'object',
            properties: {
                device_id: { type: 'string', description: 'Device ID to delete.' },
                user: { type: 'string', description: 'API user' },
            },
            required: ['device_id'],
        },
        handler: toolDeviceDelete,
    },
];
