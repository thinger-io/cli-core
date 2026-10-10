// @ts-check
import api from '../api.js';
import { apiError, inputError } from '../errors.js';
import { findOperation, resolveRefs, serverSpec } from '../openapi.js';
import {
    CATALOG,
    ancestry,
    idHint,
    idNames,
    parentHint,
    requestFor,
    templateFor,
    typeNames,
} from './catalog.js';
import { toolName } from './naming.js';
import { mergeHooks } from './resource-hooks.js';

/**
 * The generic `resource_*` tools: one tool per verb over every type of the
 * catalog, instead of one tool per type and verb. What a type looks like
 * (its fields, the examples the server documents) is not in the tool list
 * but behind `resource_describe`, read from the server's own OpenAPI
 * document when the model needs it.
 */

/** Verbs whose request carries a body. */
const BODY_VERBS = new Set(['create', 'update', 'patch', 'clone']);

/** Examples named like this document one field each: noise in a description. */
const FIELD_EXAMPLE = /^Update '/;

const text = (t) => ({ content: [{ type: 'text', text: t }], isError: false });

/**
 * A type and the ids that locate it, for messages: `device_property thermostat/setpoint`.
 *
 * @param {string} type
 * @param {{ parent?: string, id?: string }} [where]
 */
function label(type, { parent, id } = {}) {
    const where = [parent, id].filter(Boolean).join('/');
    return where ? `${type} ${where}` : type;
}

/**
 * @param {string} type
 * @param {import('./catalog.js').Verb} verb
 * @param {{ parent?: string, id?: string, user?: string | null }} args
 * @param {{ data?: any, params?: Record<string, any> }} [request]
 */
async function send(type, verb, args, { data, params } = {}) {
    const { method, url } = requestFor(type, verb, args);
    try {
        const res = await api.request({
            method,
            url,
            data,
            params,
            // Repeated keys (`state=1&state=2`), as the server expects them.
            paramsSerializer: { indexes: null },
        });
        return res.data;
    } catch (e) {
        throw apiError(e, { notFound: `Not found: ${label(type, args)}` });
    }
}

/** One record per line: lists stay readable without paying for indentation. */
function formatList(type, data, pageSize) {
    if (!Array.isArray(data)) return JSON.stringify(data, null, 2);
    if (!data.length) return `No ${type} found.`;
    const lines = data.map((item) => JSON.stringify(item));
    const full =
        data.length === pageSize
            ? `\n(page full: there may be more; pass index: ${data.length} for the next page)`
            : '';
    return `${data.length} ${type}:\n${lines.join('\n')}${full}`;
}

/** Request body schema and examples of an operation, `$ref`s resolved. */
function bodyOf(doc, operation) {
    const content = operation?.requestBody?.content?.['application/json'];
    if (!content) return undefined;
    const out = {};
    if (content.schema) out.schema = resolveRefs(doc, content.schema);
    const examples = Object.entries(content.examples || {})
        .filter(([name]) => !FIELD_EXAMPLE.test(name))
        .slice(0, 4);
    if (examples.length) {
        out.examples = Object.fromEntries(examples.map(([name, ex]) => [name, ex.value]));
    } else if (content.example !== undefined) {
        out.examples = { example: content.example };
    }
    return out;
}

/** First record of the documented response, to show the shape of the data. */
function responseExample(operation) {
    const ok = operation?.responses?.['200']?.content?.['application/json'];
    const example = ok?.example ?? Object.values(ok?.examples || {})[0]?.value;
    return Array.isArray(example) ? example[0] : example;
}

/** Which tool runs each verb of a type. */
function operationsOf(type) {
    const tools = {
        list: toolName('resource_list'),
        get: toolName('resource_get'),
        create: toolName('resource_create'),
        update: toolName('resource_update'),
        patch: `${toolName('resource_update')} with merge: true`,
        delete: toolName('resource_delete'),
        clone: toolName('resource_clone'),
        projects: `${toolName('resource_update')} with {projects: [...]}`,
    };
    return Object.fromEntries(Object.keys(type.ops).map((verb) => [verb, tools[verb]]));
}

function catalogSummary(names) {
    const lines = names.map((name) => {
        const t = CATALOG[name];
        const parent = t.parent ? ` (parent ${parentHint(name)})` : '';
        const id = idNames(t).length ? '' : ' (single, no id)';
        return `${name}${parent}${id}: ${t.description} [${Object.keys(t.ops).join(' ')}]`;
    });
    return `Resource types. ${toolName('resource_describe')} with a type gives its schemas and examples.\n\n${lines.join('\n')}`;
}

/**
 * The tools, for the types this server mode exposes.
 *
 * @param {{ admin?: boolean, hooks?: Record<string, import('./resource-hooks.js').ResourceHooks> }} [opts]
 */
export function resourceTools({ admin = false, hooks: extraHooks } = {}) {
    const hooks = mergeHooks(extraHooks);
    const served = new Set(typeNames({ admin }));

    /**
     * Validate the type for a verb and build the hook context.
     *
     * @param {Record<string, any>} args
     * @param {import('./catalog.js').Verb} verb
     */
    function prepare(args, verb) {
        const type = args.type;
        if (!type || !served.has(type)) {
            throw inputError(
                `Unknown type "${type ?? ''}". ${toolName('resource_describe')} lists them.`,
            );
        }
        if (!(verb in CATALOG[type].ops)) {
            const allowed = Object.keys(CATALOG[type].ops).join(', ');
            throw inputError(`Type "${type}" does not support ${verb} (it supports: ${allowed})`);
        }
        const ctx = {
            type,
            parent: args.parent,
            id: args.id,
            user: args.user,
            state: {},
        };
        return { type, ctx, hook: hooks[type] || {} };
    }

    function bodyArg(args, verb) {
        const body = args.body ?? {};
        if (typeof body !== 'object' || body === null) {
            throw inputError('body must be a JSON object (or array where the type takes one)');
        }
        if (BODY_VERBS.has(verb) && verb !== 'create' && !Object.keys(body).length) {
            throw inputError('body is required');
        }
        return body;
    }

    async function toolDescribe(args) {
        if (!args.type) return text(catalogSummary([...served]));
        if (!served.has(args.type)) {
            throw inputError(`Unknown type "${args.type}".\n\n${catalogSummary([...served])}`);
        }
        const name = args.type;
        const type = CATALOG[name];
        const out = { type: name, description: type.description };
        const chain = ancestry(name);
        if (chain.length) out.parent = `${chain.join(' > ')} (write it as "${parentHint(name)}")`;
        out.id = idNames(type).length ? idHint(name) : 'none: a single resource of its parent';
        out.operations = operationsOf(type);
        if (type.notes) out.notes = type.notes;

        const spec = await serverSpec();
        if (spec.doc) {
            for (const verb of /** @type {const} */ (['create', 'update', 'clone'])) {
                if (!(verb in type.ops)) continue;
                const { method, path } = templateFor(name, verb);
                const body = bodyOf(spec.doc, findOperation(spec.doc, method, path)?.operation);
                if (body) out[verb] = body;
            }
            // What a token needs to allow each verb: the server names the
            // action in each operation's summary, its ResourceType in the
            // operationId prefix (Device_ReadStatus → Device:ReadDeviceStatus).
            const actions = {};
            let resourceType;
            for (const verb of Object.keys(type.ops)) {
                const { method, path } = templateFor(name, /** @type {any} */ (verb));
                const op = findOperation(spec.doc, method, path)?.operation;
                if (!op?.summary) continue;
                resourceType ??= String(op.operationId || '').split('_')[0];
                actions[verb] = op.summary;
            }
            if (resourceType) out.permissions = { resource_type: resourceType, actions };
            const read = 'get' in type.ops ? 'get' : /** @type {const} */ ('list');
            if (read in type.ops) {
                const { method, path } = templateFor(name, read);
                const example = responseExample(findOperation(spec.doc, method, path)?.operation);
                if (example !== undefined) out.record_example = example;
            }
        }
        out.schema_source = spec.source;
        // One line per key, schemas without indentation: half the size of
        // pretty-printed JSON, and still easy to read.
        return text(
            Object.entries(out)
                .map(
                    ([key, value]) =>
                        `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
                )
                .join('\n'),
        );
    }

    async function toolList(args) {
        const { type } = prepare(args, 'list');
        const params = { ...(args.filter || {}) };
        if (args.count !== undefined) params.count = args.count;
        if (args.index !== undefined) params.index = args.index;
        const data = await send(type, 'list', args, { params });
        return text(formatList(type, data, args.count ?? 50));
    }

    async function toolGet(args) {
        const { type, ctx, hook } = prepare(args, 'get');
        let record = await send(type, 'get', args);
        if (hook.afterGet) record = await hook.afterGet(record, ctx);
        return text(JSON.stringify(record, null, 2));
    }

    async function toolCreate(args) {
        const { type, ctx, hook } = prepare(args, 'create');
        const t = CATALOG[type];
        let body = bodyArg(args, 'create');
        // The id can come apart from the body: copy it into the body's id
        // fields when the server takes it there (POST), unless already set.
        if (!t.upsert && args.id !== undefined && !Array.isArray(body)) {
            const fields = t.bodyId ?? idNames(t);
            if (!fields.length) throw inputError(`${type} ids are generated by the server`);
            const ids = String(args.id).split('/');
            if (ids.length !== fields.length) throw inputError(`id must be ${idHint(type)}`);
            body = { ...Object.fromEntries(fields.map((f, i) => [f, ids[i]])), ...body };
        }
        if (hook.beforeCreate) body = await hook.beforeCreate(body, ctx);
        const result = await send(type, 'create', args, { data: body });
        const lines = [`Created ${label(type, args)}.`];
        if (result && typeof result === 'object' && Object.keys(result).length) {
            lines.push(JSON.stringify(result, null, 2));
        }
        const note = hook.afterCreate && (await hook.afterCreate(result, ctx));
        if (note) lines.push('', note);
        return text(lines.join('\n'));
    }

    async function toolUpdate(args) {
        /** @type {import('./catalog.js').Verb} */
        const verb = args.merge ? 'patch' : 'update';
        const { projects, ...fields } = bodyArg(args, 'update');
        const { type, ctx, hook } = prepare(args, projects !== undefined ? 'projects' : verb);
        const done = [];
        if (projects !== undefined) {
            if (!Array.isArray(projects)) {
                throw inputError('projects must be an array of "<owner>@<project>"');
            }
            await send(type, 'projects', args, { data: projects });
            done.push(`projects set to ${JSON.stringify(projects)}`);
        }
        if (Object.keys(fields).length) {
            prepare(args, verb);
            let body = fields;
            if (hook.beforeUpdate) body = await hook.beforeUpdate(body, ctx);
            await send(type, verb, args, { data: body });
            done.push(`${args.merge ? 'merged' : 'updated'} ${Object.keys(fields).join(', ')}`);
        }
        return text(`Updated ${label(type, args)}: ${done.join('; ')}.`);
    }

    async function toolDelete(args) {
        const { type, ctx, hook } = prepare(args, 'delete');
        await send(type, 'delete', args);
        const lines = [`Deleted ${label(type, args)}.`];
        const note = hook.afterDelete && (await hook.afterDelete(ctx));
        if (note) lines.push(note);
        return text(lines.join('\n'));
    }

    async function toolClone(args) {
        const { type } = prepare(args, 'clone');
        const body = bodyArg(args, 'clone');
        await send(type, 'clone', args, { data: body });
        return text(`Cloned ${label(type, args)} as ${JSON.stringify(body)}.`);
    }

    const typeParam = (verb) => ({
        type: 'string',
        enum: typeNames({ admin, verb }),
        description: 'Resource type (see {tool:resource_describe}).',
    });
    const common = {
        parent: {
            type: 'string',
            description:
                'Parent id, for child types: the device of a device_property, "<device>/<bucket>" for a device_bucket_tag.',
        },
        user: {
            type: 'string',
            description: 'Account to act on (admin only). Omit for your own.',
        },
    };
    const id = { type: 'string', description: 'Resource id.' };
    const body = (description) => ({ type: 'object', description });

    return [
        {
            name: 'resource_describe',
            description:
                "Describe a resource type: its parent and id, the operations it supports and, from this server's API, the request schemas and examples for create, update and clone. Call it before writing a type for the first time. Without `type`, lists all types.",
            inputSchema: {
                type: 'object',
                properties: { type: { ...typeParam(), enum: [...served] } },
                required: [],
            },
            handler: toolDescribe,
        },
        {
            name: 'resource_list',
            description:
                'List resources of a type, one JSON record per line. Account collections come in pages of 50 (`count`, `index`). `filter` narrows the list by name (partial match), product, type, asset_type, asset_group, project or labels (key present), e.g. {"product": "boiler"}; alarm instances also take state and severity.',
            inputSchema: {
                type: 'object',
                properties: {
                    type: typeParam('list'),
                    parent: common.parent,
                    filter: { type: 'object', description: 'Query filters (see above).' },
                    count: { type: 'number', description: 'Page size (default 50).' },
                    index: { type: 'number', description: 'Offset of the first record.' },
                    user: common.user,
                },
                required: ['type'],
            },
            handler: toolList,
        },
        {
            name: 'resource_get',
            description:
                'Read one resource as JSON. Single resources (device_callback, product_profile_code) take only `parent`.',
            inputSchema: {
                type: 'object',
                properties: {
                    type: typeParam('get'),
                    parent: common.parent,
                    id,
                    user: common.user,
                },
                required: ['type'],
            },
            handler: toolGet,
        },
        {
            name: 'resource_create',
            description:
                "Create a resource from `body`, shaped as {tool:resource_describe} shows. `id` goes into the body's id field when the body lacks it; product_profile_* and product_service entries are stored under `id`, replacing any entry of that name.",
            inputSchema: {
                type: 'object',
                properties: {
                    type: typeParam('create'),
                    parent: common.parent,
                    id,
                    body: body('Fields of the new resource.'),
                    user: common.user,
                },
                required: ['type'],
            },
            handler: toolCreate,
        },
        {
            name: 'resource_update',
            description:
                'Update a resource with the fields in `body`; fields left out are kept, except for property values, which are replaced unless `merge` is true. `projects` in the body (["<owner>@<project>"]) sets the projects the resource belongs to.',
            inputSchema: {
                type: 'object',
                properties: {
                    type: typeParam('update'),
                    parent: common.parent,
                    id,
                    body: body('Fields to change.'),
                    merge: {
                        type: 'boolean',
                        description: 'Patch (JSON merge) instead of replacing: property types.',
                    },
                    user: common.user,
                },
                required: ['type', 'body'],
            },
            handler: toolUpdate,
        },
        {
            name: 'resource_delete',
            description: 'Delete a resource. Immediate and permanent: confirm with the user first.',
            inputSchema: {
                type: 'object',
                properties: {
                    type: typeParam('delete'),
                    parent: common.parent,
                    id,
                    user: common.user,
                },
                required: ['type'],
            },
            handler: toolDelete,
        },
        {
            name: 'resource_clone',
            description:
                'Copy a resource under a new id. `body` holds the new id in the type\'s id field (e.g. {"device": "copy_1"}) and optionally name, description and enabled.',
            inputSchema: {
                type: 'object',
                properties: {
                    type: typeParam('clone'),
                    parent: common.parent,
                    id,
                    body: body('New id and overrides.'),
                    user: common.user,
                },
                required: ['type', 'id', 'body'],
            },
            handler: toolClone,
        },
    ];
}
