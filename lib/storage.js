import api from './api.js';
import { apiError } from './errors.js';
import { v1, v2 } from './paths.js';

/**
 * Helpers for file storages — independent buckets that the
 * platform exposes alongside products. The product script workflow
 * uses them to host the actual JS files; storages are also useful on
 * their own (config blobs, firmware artefacts, etc.).
 *
 * Functions return raw data and throw `apiError` on failure, except
 * the `*Exists` and `delete*` helpers which use boolean return values
 * so orchestration code can stay branch-light.
 */

export async function getStorage(storageId, user) {
    try {
        const res = await api.get(`${v1(user)}/storages/${storageId}`);
        return res.data || {};
    } catch (e) {
        throw apiError(e, { notFound: `Storage not found: ${storageId}` });
    }
}

export async function storageExists(storageId, user) {
    try {
        await api.get(`${v1(user)}/storages/${storageId}`);
        return true;
    } catch (e) {
        if (e.response?.status === 404) return false;
        throw apiError(e);
    }
}

export async function createStorage(
    storageId,
    user,
    { name, description, public: isPublic = false } = {},
) {
    try {
        await api.post(`${v1(user)}/storages`, {
            storage: storageId,
            name: name || storageId,
            description: description || `Storage for ${storageId}`,
            public: isPublic,
        });
    } catch (e) {
        throw apiError(e);
    }
}

export async function deleteStorage(storageId, user) {
    try {
        await api.delete(`${v1(user)}/storages/${storageId}`);
        return true;
    } catch (e) {
        if (e.response?.status === 404) return false;
        throw apiError(e);
    }
}

export async function listStorageFiles(storageId, user) {
    try {
        const res = await api.get(`${v1(user)}/storages/${storageId}/files`);
        return res.data || [];
    } catch (e) {
        if (e.response?.status === 404) return [];
        throw apiError(e);
    }
}

/**
 * Read a file as raw text (no JSON parsing). The agent stores script
 * bodies as `text/plain` — parsing them as JSON would corrupt them.
 */
export async function readStorageFile(storageId, filePath, user) {
    try {
        const res = await api.get(`${v2(user)}/storages/${storageId}/files/${filePath}`, {
            transformResponse: [(x) => x],
        });
        return res.data;
    } catch (e) {
        throw apiError(e, { notFound: `File not found in storage "${storageId}": ${filePath}` });
    }
}

export async function storageFileExists(storageId, filePath, user) {
    try {
        await api.get(`${v2(user)}/storages/${storageId}/files/${filePath}`);
        return true;
    } catch (e) {
        if (e.response?.status === 404) return false;
        throw apiError(e);
    }
}

export async function writeStorageFile(storageId, filePath, content, user) {
    try {
        await api.put(
            `${v2(user)}/storages/${storageId}/files/${filePath}?overwrite=true`,
            content,
            { headers: { 'Content-Type': 'text/plain' } },
        );
    } catch (e) {
        throw apiError(e);
    }
}

export async function deleteStorageFile(storageId, filePath, user) {
    try {
        await api.delete(`${v2(user)}/storages/${storageId}/files/${filePath}`);
        return true;
    } catch (e) {
        if (e.response?.status === 404) return false;
        throw apiError(e);
    }
}
