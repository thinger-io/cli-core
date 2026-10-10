// @ts-check
import { getBucketData, getBuckets } from '../bucket.js';
import { inputError } from '../errors.js';
import { toolName } from './naming.js';

async function toolBuckets(args) {
    const buckets = await getBuckets(args.user);
    if (!buckets.length) {
        return { content: [{ type: 'text', text: 'No buckets configured' }], isError: false };
    }
    const lines = buckets.map((b) => {
        const enabled = b.enabled === false ? '✗' : '✓';
        const name = b.name && b.name !== b.bucket ? ` (${b.name})` : '';
        const source = b.config?.source ? `  source: ${b.config.source}` : '';
        const product = b.product ? `  [product ${b.product}]` : '';
        const description = b.description ? `  — ${b.description}` : '';
        return `${enabled}  ${b.bucket}${name}${product}${source}${description}`;
    });
    return {
        content: [{ type: 'text', text: `${buckets.length} bucket(s):\n${lines.join('\n')}` }],
        isError: false,
    };
}

async function toolBucketRead(args) {
    if (!args.bucket)
        throw inputError(`bucket is required. Use ${toolName('buckets')} to list them.`);
    const data = await getBucketData({
        bucket: args.bucket,
        device: args.device_id,
        user: args.user,
        items: args.items || 10,
        sort: args.sort || 'desc',
        minutes: args.minutes,
        min_ts: args.min_ts,
        max_ts: args.max_ts,
        agg: args.agg,
        agg_type: args.agg_type,
        fields: args.fields,
        group_by: args.group_by,
    });
    const text =
        Array.isArray(data) && data.length === 0 ? 'No data' : JSON.stringify(data, null, 2);
    return {
        content: [{ type: 'text', text }],
        isError: false,
    };
}

export const tools = [
    {
        name: 'buckets',
        description:
            'List the data buckets of the account with their enabled flag, name, owning product (for buckets declared in a product profile), data source and description. Use it to find bucket ids for {tool:bucket_read}.',
        inputSchema: {
            type: 'object',
            properties: {
                user: { type: 'string', description: 'API user' },
            },
            required: [],
        },
        handler: toolBuckets,
    },
    {
        name: 'bucket_read',
        description: `Query a time-series bucket.

Modes:
- no device: the account bucket (see {tool:buckets}). For a bucket declared in a product profile this holds the samples of every device of the product, interleaved; pass \`group_by=device\` (when samples are tagged with \`device\`) to get one row per device.
- device set: the series a product bucket records for that one device.

Don't assume a \`device\` tag exists unless the bucket or product profile defines it.`,
        inputSchema: {
            type: 'object',
            properties: {
                bucket: {
                    type: 'string',
                    description:
                        'Bucket ID, as listed by {tool:buckets} or declared in a product profile.',
                },
                device_id: {
                    type: 'string',
                    description:
                        'Device ID, to read the series a product bucket keeps for that device. Omit to read the account bucket.',
                },
                items: {
                    type: 'number',
                    description:
                        'Number of data points to return (default: 10). In multi-device mode set ≥ number of devices.',
                },
                minutes: {
                    type: 'number',
                    description: 'Get data from the last N minutes. Alternative to min_ts/max_ts.',
                },
                min_ts: { type: 'number', description: 'Minimum timestamp in milliseconds' },
                max_ts: {
                    type: 'number',
                    description: 'Maximum timestamp in milliseconds (0 = now)',
                },
                sort: {
                    type: 'string',
                    description:
                        'Sort order by timestamp: "asc" or "desc" (default: "desc"). Does NOT sort by metric — do that client-side.',
                },
                agg: {
                    type: 'string',
                    description:
                        'Time-window size for windowed aggregation: "5m", "10m", "1h", "6h". Only meaningful with a specific device. For a per-device single value across the whole range, omit `agg` and pass `agg_type` alone.',
                },
                agg_type: {
                    type: 'string',
                    description:
                        'Reducer applied to each group/window. Supported: "mean", "max", "min", "sum", "count", "first", "last", "median", "spread", "stddev".',
                },
                fields: {
                    type: 'string',
                    description:
                        'Comma-separated fields to return (e.g., "temperature,humidity"). Narrower queries are cheaper.',
                },
                group_by: {
                    type: 'string',
                    description:
                        'Optional group key (e.g. "device" for a one-row-per-device fleet view). Omit for raw samples — custom buckets may not carry a "device" tag.',
                },
                user: { type: 'string', description: 'API user' },
            },
            required: ['bucket'],
        },
        handler: toolBucketRead,
    },
];
