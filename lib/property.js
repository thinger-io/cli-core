import { resolveUser } from './config.js';
import { device } from './paths.js';
import api from './api.js';
import { apiError } from './errors.js';
import { info, success } from './format.js';

export async function getDeviceProperties(deviceId, user) {
    try {
        const response = await api.get(`${device(user, deviceId)}/properties`);
        return response.data;
    } catch (error) {
        throw apiError(error, {
            notFound: `Device not found: ${deviceId} (account ${resolveUser(user)})`,
        });
    }
}

export async function getDeviceProperty(deviceId, propertyId, user) {
    try {
        const response = await api.get(`${device(user, deviceId)}/properties/${propertyId}`);
        return response.data.value;
    } catch (error) {
        throw apiError(error, {
            notFound: `Property not found: ${propertyId} on device ${deviceId}`,
        });
    }
}

// PUT so the operation is idempotent — missing properties are created,
// existing ones are overwritten wholesale.
export async function setDeviceProperty(deviceId, propertyId, value, user) {
    try {
        const response = await api.put(`${device(user, deviceId)}/properties/${propertyId}`, {
            value,
        });
        return response.data;
    } catch (error) {
        throw apiError(error, {
            notFound: `Device not found: ${deviceId} (account ${resolveUser(user)})`,
        });
    }
}

export function formatDeviceProperties(deviceId, properties) {
    let formattedProperties = '\nProperties of device ' + info(deviceId) + ':\n';

    properties.forEach((property) => {
        formattedProperties += `- ${property.property}\n`;
    });

    return formattedProperties;
}

export function formatDeviceProperty(deviceId, propertyId, propertyValue) {
    let formattedValue =
        '\nValue of property ' + info(propertyId) + ' for device ' + info(deviceId) + ':\n';
    const flattenedValue = flatten(propertyValue);
    for (const key in flattenedValue) {
        formattedValue += `${key}: ${success(flattenedValue[key])}\n`;
    }
    return formattedValue;
}

function flatten(obj, prefix = '', res = {}) {
    for (const key in obj) {
        const val = obj[key];
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof val === 'object' && val !== null) {
            flatten(val, path, res);
        } else {
            res[path] = val;
        }
    }
    return res;
}
