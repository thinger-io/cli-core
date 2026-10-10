// @ts-check
import api from '../api.js';
import { apiError, inputError } from '../errors.js';
import { v1 } from '../paths.js';

const json = (data) => ({
    content: [{ type: 'text', text: JSON.stringify(data ?? null, null, 2) }],
    isError: false,
});

function productPath(args) {
    if (!args.product) throw inputError('product is required');
    return `${v1(args.user)}/products/${encodeURIComponent(args.product)}`;
}

async function toolResourceCall(args) {
    if (!args.resource) throw inputError('resource is required');
    try {
        const res = await api.post(
            `${productPath(args)}/resources/${encodeURIComponent(args.resource)}`,
            args.data ?? {},
        );
        return json(res.data);
    } catch (e) {
        throw apiError(e, {
            notFound: `Not found: product ${args.product} or its resource ${args.resource}`,
        });
    }
}

async function toolExport(args) {
    try {
        const res = await api.get(`${productPath(args)}/export`);
        return json(res.data);
    } catch (e) {
        throw apiError(e, { notFound: `Product not found: ${args.product}` });
    }
}

const userParam = { type: 'string', description: 'Account to act on (admin only).' };

export const tools = [
    {
        name: 'product_resource_call',
        description:
            "Call a product API resource with a payload, as a device or an external system feeding data in would (ingestion: the product's API decides which device and bucket the data lands in).",
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product id.' },
                resource: { type: 'string', description: 'Resource name in the product profile.' },
                data: { description: 'JSON payload.' },
                user: userParam,
            },
            required: ['product', 'resource'],
        },
        handler: toolResourceCall,
    },
    {
        name: 'product_export',
        description:
            'Export a product with what it depends on as one JSON document, to back it up or recreate it elsewhere.',
        inputSchema: {
            type: 'object',
            properties: {
                product: { type: 'string', description: 'Product id.' },
                user: userParam,
            },
            required: ['product'],
        },
        handler: toolExport,
    },
];
