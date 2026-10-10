// @ts-check
import api from '../api.js';
import { apiError, inputError } from '../errors.js';
import { v1 } from '../paths.js';
import { deleteStorageFile, readStorageFile, writeStorageFile } from '../storage.js';

/** Files of a storage (the storages themselves are the catalog type "storage"). */

const text = (t) => ({ content: [{ type: 'text', text: t }], isError: false });
const userParam = { type: 'string', description: 'Account to act on (admin only).' };
const storageParam = { type: 'string', description: 'Storage id.' };

function required(args, ...names) {
    for (const name of names) {
        if (args[name] === undefined || args[name] === '') throw inputError(`${name} is required`);
    }
}

/** A path inside the storage, without leading slashes (they would double up in the URL). */
const clean = (p) => String(p).replace(/^\/+/, '');

async function toolList(args) {
    required(args, 'storage');
    const params = args.path ? { path: clean(args.path) } : undefined;
    try {
        const res = await api.get(
            `${v1(args.user)}/storages/${encodeURIComponent(args.storage)}/files`,
            { params },
        );
        const files = Array.isArray(res.data) ? res.data : [];
        return text(files.length ? files.map((f) => JSON.stringify(f)).join('\n') : 'No files.');
    } catch (e) {
        // The server keeps files on disk and creates a storage's folder with
        // its first file: an empty storage answers 404 too.
        if (e.response?.status === 404) {
            return text(
                `No files${args.path ? ` under ${clean(args.path)}` : ''} (or no storage ${args.storage}).`,
            );
        }
        throw apiError(e);
    }
}

async function toolRead(args) {
    required(args, 'storage', 'path');
    return text(await readStorageFile(args.storage, clean(args.path), args.user));
}

async function toolWrite(args) {
    required(args, 'storage', 'path');
    if (typeof args.content !== 'string') throw inputError('content must be a string');
    await writeStorageFile(args.storage, clean(args.path), args.content, args.user);
    return text(
        `Wrote ${clean(args.path)} (${Buffer.byteLength(args.content)} bytes) to storage ${args.storage}.`,
    );
}

async function toolDelete(args) {
    required(args, 'storage', 'path');
    const deleted = await deleteStorageFile(args.storage, clean(args.path), args.user);
    return text(deleted ? `Deleted ${clean(args.path)}.` : `No such file: ${clean(args.path)}.`);
}

const pathParam = {
    type: 'string',
    description: 'File path inside the storage, e.g. "web/index.html".',
};

export const tools = [
    {
        name: 'storage_file_list',
        description:
            'List the files of a storage (path, size, modification time), optionally only under a folder.',
        inputSchema: {
            type: 'object',
            properties: {
                storage: storageParam,
                path: { type: 'string', description: 'Folder to list.' },
                user: userParam,
            },
            required: ['storage'],
        },
        handler: toolList,
    },
    {
        name: 'storage_file_read',
        description: 'Read a text file of a storage.',
        inputSchema: {
            type: 'object',
            properties: { storage: storageParam, path: pathParam, user: userParam },
            required: ['storage', 'path'],
        },
        handler: toolRead,
    },
    {
        name: 'storage_file_write',
        description:
            'Create or overwrite a text file in a storage; folders on the path are created.',
        inputSchema: {
            type: 'object',
            properties: {
                storage: storageParam,
                path: pathParam,
                content: { type: 'string', description: 'File content.' },
                user: userParam,
            },
            required: ['storage', 'path', 'content'],
        },
        handler: toolWrite,
    },
    {
        name: 'storage_file_delete',
        description: 'Delete a file of a storage. Permanent: confirm with the user first.',
        inputSchema: {
            type: 'object',
            properties: { storage: storageParam, path: pathParam, user: userParam },
            required: ['storage', 'path'],
        },
        handler: toolDelete,
    },
];
