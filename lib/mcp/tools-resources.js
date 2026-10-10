// @ts-check
import { callDeviceResource, listDeviceResourcesWithSchemas } from '../resource.js';
import { inputError } from '../errors.js';
import { toolName } from './naming.js';

async function toolResourceList(args) {
    const device = args.device_id;
    if (!device)
        throw inputError(
            `No device specified. Use ${toolName('devices')} to list available devices.`,
        );
    const entries = await listDeviceResourcesWithSchemas(device, { user: args.user });
    const fnLabel = (f) =>
        ({ 1: 'no params', 2: 'input', 3: 'output', 4: 'input/output' })[f] || 'unknown';
    const lines = entries.map((e) => {
        const parts = [`${e.name} [${fnLabel(e.fn)}]`];
        if (e.in !== undefined) parts.push(`  in:  ${JSON.stringify(e.in)}`);
        if (e.out !== undefined) parts.push(`  out: ${JSON.stringify(e.out)}`);
        return parts.join('\n');
    });
    return {
        content: [{ type: 'text', text: lines.length ? lines.join('\n\n') : '(no resources)' }],
        isError: false,
    };
}

async function toolResourceCall(args) {
    const device = args.device_id;
    if (!device)
        throw inputError(
            `No device specified. Use ${toolName('devices')} to list available devices.`,
        );
    if (!args.resource) throw inputError('resource is required');
    const result = await callDeviceResource(device, args.resource, args.inputs, {
        user: args.user,
    });
    return {
        content: [
            {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
        ],
        isError: false,
    };
}

export const tools = [
    {
        name: 'resource_list',
        description: `List the callable resources exposed by a device, with their input/output schemas when available. Resources are the device's public API, declared by its firmware (e.g. "temperature" to read a sensor, "led" to switch an output) plus any API resources inherited from its product profile. Each is input-only, output-only, input/output or parameterless. The device must be online. Prefer this before calling {tool:resource_call} to discover what a device offers and how to call each resource.`,
        inputSchema: {
            type: 'object',
            properties: {
                device_id: { type: 'string', description: 'Device ID' },
                user: { type: 'string', description: 'API user' },
            },
            required: ['device_id'],
        },
        handler: toolResourceList,
    },
    {
        name: 'resource_call',
        description: `Invoke a resource on a device. Pass \`inputs\` when the resource declares an input schema; omit them to read an output-only resource (a GET that does not trigger the input side). Returns the resource's output. The device must be online. Use {tool:resource_list} first to discover available resources and their expected inputs.`,
        inputSchema: {
            type: 'object',
            properties: {
                resource: {
                    type: 'string',
                    description: 'Resource name as returned by {tool:resource_list}.',
                },
                inputs: {
                    description:
                        'JSON object with the input parameters declared by the resource. Omit or pass {} for input-less resources.',
                },
                device_id: { type: 'string', description: 'Device ID' },
                user: { type: 'string', description: 'API user' },
            },
            required: ['resource', 'device_id'],
        },
        handler: toolResourceCall,
    },
];
