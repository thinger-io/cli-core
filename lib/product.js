import api from './api.js';
import { apiError } from './errors.js';
import { v1 } from './paths.js';
import { identity } from './identity.js';

/**
 * Helpers for products: the templates devices are assigned to, carrying the
 * profile (API resources, buckets, property handlers) and product-level
 * properties.
 *
 * Each helper maps to a single REST endpoint and throws `apiError` on
 * failure — except `*Exists` (boolean) and `delete*` (true if removed,
 * false if the resource was already absent).
 */

// ─── Low-level: products ─────────────────────────────────────────────

export async function getProducts(user) {
    try {
        const res = await api.get(`${v1(user)}/products`);
        return res.data || [];
    } catch (e) {
        throw apiError(e);
    }
}

export async function getProduct(productId, user) {
    try {
        const res = await api.get(`${v1(user)}/products/${productId}`);
        return res.data || {};
    } catch (e) {
        throw apiError(e, { notFound: `Product not found: ${productId}` });
    }
}

export async function productExists(productId, user) {
    try {
        await api.get(`${v1(user)}/products/${productId}`);
        return true;
    } catch (e) {
        if (e.response?.status === 404) return false;
        throw apiError(e);
    }
}

/**
 * Create a product. `config` and `profile` go to the server as given, so
 * callers can create a bare product (just an id) or a fully configured one
 * (autoprovisioning, buckets, API resources, properties) in a single call.
 *
 * The CLI's product template fills in what the caller leaves out: its
 * description, its `config` keys (the caller's keys win) and its whole
 * `profile` when the caller passes none.
 *
 * @param {string} productId
 * @param {string | null | undefined} user
 * @param {{ name?: string, description?: string, enabled?: boolean, config?: object, profile?: object }} [opts]
 */
export async function createProduct(
    productId,
    user,
    { name, description, enabled = true, config, profile } = {},
) {
    const template = identity().productTemplate;
    const mergedConfig = { ...structuredClone(template.config || {}), ...(config || {}) };
    const mergedProfile = profile || (template.profile && structuredClone(template.profile));
    try {
        await api.post(`${v1(user)}/products`, {
            product: productId,
            name: name || productId,
            description: description || template.description || '',
            enabled,
            ...(Object.keys(mergedConfig).length ? { config: mergedConfig } : {}),
            ...(mergedProfile ? { profile: mergedProfile } : {}),
        });
    } catch (e) {
        throw apiError(e);
    }
}

export async function updateProduct(productId, user, patch) {
    try {
        await api.put(`${v1(user)}/products/${productId}`, patch);
    } catch (e) {
        throw apiError(e, { notFound: `Product not found: ${productId}` });
    }
}

export async function deleteProduct(productId, user) {
    try {
        await api.delete(`${v1(user)}/products/${productId}`);
        return true;
    } catch (e) {
        if (e.response?.status === 404) return false;
        throw apiError(e);
    }
}

// ─── Low-level: product API resources (profile/api) ──────────────────

/** Returns the `{ resourceName: definition }` map; `{}` when none. */
export async function getProductApi(productId, user) {
    try {
        const res = await api.get(`${v1(user)}/products/${productId}/profile/api`);
        return res.data || {};
    } catch (e) {
        if (e.response?.status === 404) return {};
        throw apiError(e);
    }
}

// ─── Low-level: product properties (/v1/.../products/<id>/properties) ─
//
// Product-level properties are structured JSON values attached to the
// product itself (not to any single device). Typical uses: dashboard
// configuration, shared feature flags, a list of metrics to stream.
// Endpoint mirrors device properties but lives under the v1 product
// namespace on the server.

export async function getProductProperties(productId, user) {
    try {
        const res = await api.get(`${v1(user)}/products/${productId}/properties`);
        return res.data || [];
    } catch (e) {
        throw apiError(e, { notFound: `Product not found: ${productId}` });
    }
}

export async function getProductProperty(productId, propertyId, user) {
    try {
        const res = await api.get(`${v1(user)}/products/${productId}/properties/${propertyId}`);
        return res.data?.value;
    } catch (e) {
        throw apiError(e, {
            notFound: `Property not found: ${propertyId} on product ${productId}`,
        });
    }
}

export async function setProductProperty(productId, propertyId, value, user) {
    try {
        const res = await api.put(`${v1(user)}/products/${productId}/properties/${propertyId}`, {
            value,
        });
        return res.data;
    } catch (e) {
        throw apiError(e, { notFound: `Product not found: ${productId}` });
    }
}

export async function deleteProductProperty(productId, propertyId, user) {
    try {
        await api.delete(`${v1(user)}/products/${productId}/properties/${propertyId}`);
        return true;
    } catch (e) {
        if (e.response?.status === 404) return false;
        throw apiError(e);
    }
}

// ─── Low-level: device ↔ product binding ─────────────────────────────

export async function setDeviceProduct(deviceId, productId, user) {
    try {
        await api.put(`${v1(user)}/devices/${deviceId}`, { product: productId });
    } catch (e) {
        throw apiError(e, { notFound: `Device not found: ${deviceId}` });
    }
}
