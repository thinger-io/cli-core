// @ts-check
import { getDeviceProperties, getDeviceProperty, setDeviceProperty } from '../property.js';
import { inputError } from '../errors.js';
import { toolName } from './naming.js';

async function toolPropertyGet(args) {
    const device = args.device_id;
    if (!device)
        throw inputError(
            `No device specified. Use ${toolName('devices')} to list available devices.`,
        );
    if (args.property) {
        const value = await getDeviceProperty(device, args.property, args.user);
        return {
            content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
            isError: false,
        };
    }
    const list = await getDeviceProperties(device, args.user);
    const names = Array.isArray(list) ? list.map((p) => p.property).filter(Boolean) : [];
    return {
        content: [{ type: 'text', text: names.length ? names.join('\n') : '(no properties)' }],
        isError: false,
    };
}

async function toolPropertySet(args) {
    const device = args.device_id;
    if (!device)
        throw inputError(
            `No device specified. Use ${toolName('devices')} to list available devices.`,
        );
    if (!args.property) throw inputError('property is required');
    if (args.value === undefined) throw inputError('value is required');
    const saved = await setDeviceProperty(device, args.property, args.value, args.user);
    return {
        content: [
            {
                type: 'text',
                text: `Saved property "${saved.property}" on ${saved.device} (value: ${JSON.stringify(saved.value)})`,
            },
        ],
        isError: false,
    };
}

export const tools = [
    {
        name: 'property_get',
        description: `Read a device property. Properties are the device's structured state (e.g. configuration, last values, calibration). Call without \`property\` to list the names of every property the device has.`,
        inputSchema: {
            type: 'object',
            properties: {
                property: {
                    type: 'string',
                    description:
                        'Property name. Omit to list the names of all properties on the device.',
                },
                device_id: { type: 'string', description: 'Device ID' },
                user: { type: 'string', description: 'API user' },
            },
            required: ['device_id'],
        },
        handler: toolPropertyGet,
    },
    {
        name: 'property_set',
        description: `Create or overwrite a device property. The value can be any JSON-serialisable shape (string, number, object, array). Existing properties are replaced wholesale; missing ones are created. Properties live on the server, so they can be written while the device is offline; devices read them on connection, and dashboards can show them.`,
        inputSchema: {
            type: 'object',
            properties: {
                property: { type: 'string', description: 'Property name to create or overwrite.' },
                value: {
                    description:
                        'Any JSON-serialisable value (string, number, boolean, object, array).',
                },
                device_id: { type: 'string', description: 'Device ID' },
                user: { type: 'string', description: 'API user' },
            },
            required: ['property', 'value', 'device_id'],
        },
        handler: toolPropertySet,
    },
];
