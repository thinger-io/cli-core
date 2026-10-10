import { randomBytes } from 'node:crypto';
import api from './api.js';
import { alreadyExistsError, apiError } from './errors.js';
import { v1 } from './paths.js';

export async function getDevices(filter, user = null) {
    let devices = [];

    let queryParametersString = '';
    for (const [key, value] of Object.entries(filter)) {
        if (value) queryParametersString += key + '=' + encodeURIComponent(value) + '&';
    }

    try {
        const count = 50;
        const url = `${v1(user)}/devices?count=${count}&${queryParametersString}`;
        let index = 0;
        let res_length = 0;

        do {
            const response = await api.get(`${url}index=${index}`);
            res_length = response.data.length;
            index += res_length;
            devices = devices.concat(response.data);
        } while (res_length === count);

        return devices;
    } catch (error) {
        const product = filter && filter.product;
        const notFound = product ? `Product not found: ${product}` : 'Devices not found';
        throw apiError(error, { notFound });
    }
}

// Server-side metadata (assigned product, description, asset group,
// connection state…). For device-side data — system_info, monitoring —
// hit the agent resources directly instead.
export async function getDevice(deviceId, user = null) {
    try {
        const response = await api.get(`${v1(user)}/devices/${deviceId}`);
        return response.data || {};
    } catch (error) {
        throw apiError(error, { notFound: `Device not found: ${deviceId}` });
    }
}

// Device types and what they need. Generic (IOTMP) and MQTT devices
// authenticate with credentials; HTTP, Virtual and Subdevice ones don't.
export const DEVICE_TYPES = ['Generic', 'MQTT', 'HTTP', 'Virtual', 'Subdevice'];
export const CREDENTIAL_DEVICE_TYPES = new Set(['Generic', 'MQTT']);

/**
 * Credentials for a new device: 16 characters from a URL- and shell-safe
 * alphabet. The server stores them hashed, so they are only ever shown
 * once, in the response to the creation.
 */
export function generateDeviceCredentials() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789_-';
    const bytes = randomBytes(16);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Create a device. `body` goes to the server as given, minus empty
 * optional strings (the server rejects an empty description on some
 * types). Returns the body that was sent, credentials included.
 */
export async function createDevice(body, user = null) {
    const payload = Object.fromEntries(
        Object.entries(body).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    try {
        await api.post(`${v1(user)}/devices`, payload);
        return payload;
    } catch (error) {
        if (error.response?.status === 409) {
            throw alreadyExistsError(`Device already exists: ${body.device}`);
        }
        throw apiError(error);
    }
}

// Idempotent: returns true if the device record was removed, false if it
// was already absent. Other failures (auth, network) propagate as apiError.
export async function deleteDevice(deviceId, user = null) {
    try {
        await api.delete(`${v1(user)}/devices/${deviceId}`);
        return true;
    } catch (error) {
        if (error.response?.status === 404) return false;
        throw apiError(error);
    }
}

export function filterActiveDevices(devices) {
    return devices.filter((device) => device.connection && device.connection.active === true);
}
