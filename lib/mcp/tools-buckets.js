// @ts-check
import api from '../api.js';
import { getBucketData } from '../bucket.js';
import { apiError, inputError } from '../errors.js';
import { v1 } from '../paths.js';

async function toolBucketDataRead(args) {
    if (!args.bucket) throw inputError('bucket is required');
    const data = await getBucketData({
        bucket: args.bucket,
        device: args.device,
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
    return { content: [{ type: 'text', text }], isError: false };
}

async function toolBucketDataWrite(args) {
    if (!args.bucket) throw inputError('bucket is required');
    if (!args.data || typeof args.data !== 'object') {
        throw inputError('data must be a JSON object (one sample)');
    }
    const params = args.ts !== undefined ? { ts: args.ts } : undefined;
    try {
        await api.post(
            `${v1(args.user)}/buckets/${encodeURIComponent(args.bucket)}/data`,
            args.data,
            { params },
        );
    } catch (e) {
        throw apiError(e, { notFound: `Bucket not found: ${args.bucket}` });
    }
    return {
        content: [{ type: 'text', text: `Wrote 1 sample to bucket ${args.bucket}.` }],
        isError: false,
    };
}

const userParam = { type: 'string', description: 'Account to act on (admin only).' };

export const tools = [
    {
        name: 'bucket_data_read',
        description: `Query the time series of a bucket (find them with {tool:resource_list}: type "bucket", or "device_bucket" for one device).

- Without \`device\`: the whole bucket. A bucket declared in a product profile holds every device of the product interleaved; \`group_by: "device"\` gives one row per device, when samples carry that tag.
- With \`device\`: the series the bucket keeps for that device.`,
        inputSchema: {
            type: 'object',
            properties: {
                bucket: { type: 'string', description: 'Bucket id.' },
                device: {
                    type: 'string',
                    description:
                        'Device id, to read only its records: the bucket needs the `device` tag (product buckets have it).',
                },
                items: { type: 'number', description: 'Samples to return (default 10).' },
                minutes: {
                    type: 'number',
                    description: 'Last N minutes (instead of min_ts/max_ts).',
                },
                min_ts: { type: 'number', description: 'From (unix ms).' },
                max_ts: { type: 'number', description: 'To (unix ms, 0 = now).' },
                sort: { type: 'string', description: '"desc" (default) or "asc", by time.' },
                agg: { type: 'string', description: 'Aggregation window: "5m", "1h"…' },
                agg_type: {
                    type: 'string',
                    description:
                        'Reducer: mean, max, min, sum, count, first, last, median, spread, stddev.',
                },
                fields: { type: 'string', description: 'Comma-separated fields to return.' },
                group_by: { type: 'string', description: 'Group key, e.g. "device".' },
                user: userParam,
            },
            required: ['bucket'],
        },
        handler: toolBucketDataRead,
    },
    {
        name: 'bucket_data_write',
        description:
            'Write one sample to a bucket whose data source accepts API writes. It is stored with the current time, or with `ts`. Servers limit how often a bucket can be written (429 when exceeded).',
        inputSchema: {
            type: 'object',
            properties: {
                bucket: { type: 'string', description: 'Bucket id.' },
                data: { type: 'object', description: 'Sample fields, e.g. {"temperature": 21.5}.' },
                ts: { type: 'number', description: 'Timestamp of the sample (unix ms).' },
                user: userParam,
            },
            required: ['bucket', 'data'],
        },
        handler: toolBucketDataWrite,
    },
];
