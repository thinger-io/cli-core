// @ts-check
import api from '../api.js';
import { apiError, inputError } from '../errors.js';
import { readDoc } from '../docs.js';
import { findOperation, resolveRefs, serverSpec } from '../openapi.js';
import {
    CATALOG,
    actionRequest,
    actionTemplate,
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

/** `{tool:x}` in catalog notes → full tool names (tests check they exist). */
const expandNotes = (notes) => notes.replace(/\{tool:([a-z0-9_]+)\}/g, (_, base) => toolName(base));

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

/** The id a create or clone body names, when it carries every id field. */
function bodyIdOf(t, body) {
    const fields = t.bodyId ?? idNames(t);
    if (!fields.length || !body || typeof body !== 'object' || Array.isArray(body))
        return undefined;
    const ids = fields.map((f) => body[f]);
    return ids.every((v) => v !== undefined && v !== null && v !== '') ? ids.join('/') : undefined;
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

/** The given dot paths of a record, for lists whose records are too big. */
export function pick(record, fields) {
    if (!record || typeof record !== 'object') return record;
    const out = {};
    for (const field of fields) {
        const keys = field.split('.');
        const value = keys.reduce(
            (v, k) => (v && typeof v === 'object' ? v[k] : undefined),
            record,
        );
        if (value === undefined) continue;
        let node = out;
        keys.slice(0, -1).forEach((k) => (node = node[k] ??= {}));
        node[keys[keys.length - 1]] = value;
    }
    return out;
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
/**
 * The description with each request schema written once. Profile entries,
 * for one, take the same 16 KB schema to create, to update and, as the
 * values of a map, to replace the whole category: the copies become a
 * pointer to the first. Actions move after the schemas they refer to.
 *
 * @param {Record<string, any>} out
 */
export function shareSchemas(out) {
    const seen = new Map();
    const visit = (node) => {
        if (!node || typeof node !== 'object') return node;
        const json = JSON.stringify(node);
        if (json.length > 400 && seen.has(json)) return `(same as the ${seen.get(json)} schema)`;
        return Array.isArray(node)
            ? node.map(visit)
            : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, visit(v)]));
    };
    const take = (body, label) => {
        if (!body?.schema) return body;
        const shared = { ...body, schema: visit(body.schema) };
        const json = JSON.stringify(body.schema);
        if (!seen.has(json)) seen.set(json, label);
        return shared;
    };
    const { actions, ...rest } = out;
    for (const verb of ['create', 'update', 'clone']) {
        if (rest[verb]) rest[verb] = take(rest[verb], verb);
    }
    if (!actions) return rest;
    const shared = Object.fromEntries(
        Object.entries(actions).map(([a, spec]) => [
            a,
            spec.body ? { ...spec, body: take(spec.body, `${a} body`) } : spec,
        ]),
    );
    const { schema_source, record_example, permissions, ...head } = rest;
    return Object.fromEntries(
        Object.entries({
            ...head,
            actions: shared,
            permissions,
            record_example,
            schema_source,
        }).filter(([, value]) => value !== undefined),
    );
}

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
        const actions = Object.keys(t.actions || {});
        const ops =
            Object.keys(t.ops).join(' ') + (actions.length ? ` | ${actions.join(' ')}` : '');
        return `${name}${parent}${id}: ${expandNotes(t.description)} [${ops}]`;
    });
    return `Resource types, with their operations and, after |, their actions (run with ${toolName('resource_call')}). ${toolName('resource_describe')} with a type gives its schemas and examples.\n\n${lines.join('\n')}`;
}

/**
 * The tools, for the types this server mode exposes.
 *
 * @param {{ hooks?: Record<string, import('./resource-hooks.js').ResourceHooks> }} [opts]
 */
export function resourceTools({ hooks: extraHooks } = {}) {
    const hooks = mergeHooks(extraHooks);
    const served = new Set(typeNames());

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
        if (!args.type) {
            // The overview call: the types, plus the server's guide to its
            // concepts when it publishes one (older servers do not).
            const concepts = await readDoc('concepts').then(
                (d) => d.text,
                () => '',
            );
            return text(
                concepts
                    ? `${catalogSummary([...served])}\n\n---\n\n${concepts}`
                    : catalogSummary([...served]),
            );
        }
        if (!served.has(args.type)) {
            throw inputError(`Unknown type "${args.type}".\n\n${catalogSummary([...served])}`);
        }
        const name = args.type;
        const type = CATALOG[name];
        const out = { type: name, description: expandNotes(type.description) };
        const chain = ancestry(name);
        if (chain.length) out.parent = `${chain.join(' > ')} (write it as "${parentHint(name)}")`;
        out.id = idNames(type).length ? idHint(name) : 'none: a single resource of its parent';
        out.operations = operationsOf(type);
        if (type.actions) {
            out.actions = Object.fromEntries(
                Object.entries(type.actions).map(([a, spec]) => [
                    a,
                    {
                        run: `${toolName('resource_call')} action "${a}"`,
                        does: expandNotes(spec.description),
                    },
                ]),
            );
        }
        if (type.notes) out.notes = expandNotes(type.notes);
        if (type.sdk) {
            out.sdk = await readDoc('dashboard-sdk').then(
                (d) => d.text,
                (e) => `unavailable: ${e.message}`,
            );
        }

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
            for (const [a] of Object.entries(type.actions || {})) {
                const { method, path } = actionTemplate(name, a);
                const op = findOperation(spec.doc, method, path)?.operation;
                if (op?.summary) {
                    resourceType ??= String(op.operationId || '').split('_')[0];
                    actions[a] = op.summary;
                }
                const body = bodyOf(spec.doc, op);
                if (body && body.schema && JSON.stringify(body.schema) !== '{"type":"object"}') {
                    out.actions[a].body = body;
                }
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
            Object.entries(shareSchemas(out))
                .map(
                    ([key, value]) =>
                        `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
                )
                .join('\n'),
        );
    }

    async function toolList(args) {
        const { type } = prepare(args, 'list');
        const params = { ...(CATALOG[type].listQuery || {}), ...(args.filter || {}) };
        // Search: the server matches `name` against ids and names (partial,
        // case-insensitive, as a regular expression: escape it). Lists the
        // server answers whole are searched here instead, over every field.
        const whole = CATALOG[type].listWhole;
        if (args.search && !whole && params.name === undefined) {
            params.name = String(args.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        if (args.count !== undefined) params.count = args.count;
        if (args.index !== undefined) params.index = args.index;
        let data = await send(type, 'list', args, { params });
        const fields = CATALOG[type].listFields;
        if (fields && Array.isArray(data)) data = data.map((record) => pick(record, fields));
        // Lists answered whole: every word must appear in what a record shows.
        if (args.search && whole && Array.isArray(data)) {
            const words = String(args.search).toLowerCase().split(/\s+/).filter(Boolean);
            data = data.filter((record) => {
                const haystack = JSON.stringify(record).toLowerCase();
                return words.every((w) => haystack.includes(w));
            });
        }
        // Some collections ignore count/index and answer everything: page
        // them here so one call cannot flood the conversation.
        const pageSize = args.count ?? 50;
        if (Array.isArray(data) && data.length > pageSize) {
            const from = args.index ?? 0;
            const page = data.slice(from, from + pageSize);
            const next =
                from + page.length < data.length
                    ? `; pass index: ${from + page.length} for more, or narrow it with filter`
                    : '';
            return text(
                `${formatList(type, page, Infinity)}\n(${data.length} in total, showing ${from}–${from + page.length - 1}${next})`,
            );
        }
        return text(formatList(type, data, pageSize));
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
        // `projects` is not a field the server takes on create: set it right
        // after, as update does, so one call leaves the resource in place.
        let projects;
        if (body && typeof body === 'object' && !Array.isArray(body) && 'projects' in body) {
            ({ projects, ...body } = body);
            if (!Array.isArray(projects)) {
                throw inputError('projects must be an array of "<owner>@<project>"');
            }
            if (!('projects' in t.ops)) throw inputError(`${type} cannot belong to projects`);
        }
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
        const createdId = args.id ?? bodyIdOf(t, body);
        if (projects && createdId === undefined) {
            throw inputError(`give the ${type} id to set its projects on create`);
        }
        const result = await send(type, 'create', args, { data: body });
        const lines = [`Created ${label(type, { parent: args.parent, id: createdId })}.`];
        if (projects) {
            await send(type, 'projects', { ...args, id: createdId }, { data: projects });
            lines[0] = lines[0].replace(/\.$/, ` in projects ${JSON.stringify(projects)}.`);
        }
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
        const copy = bodyIdOf(CATALOG[type], body);
        return text(
            `Cloned ${label(type, args)} as ${copy ? label(type, { parent: args.parent, id: copy }) : JSON.stringify(body)}.`,
        );
    }

    async function toolCall(args) {
        const type = args.type;
        if (!type || !served.has(type) || !CATALOG[type].actions) {
            throw inputError(
                `Type "${type ?? ''}" has no actions. ${toolName('resource_describe')} lists them after |.`,
            );
        }
        const { method, url, query } = actionRequest(type, args.action, args);
        try {
            const res = await api.request({
                method,
                url,
                data: method === 'get' ? undefined : (args.body ?? {}),
                params: { ...(args.query || {}), ...(query || {}) },
                paramsSerializer: { indexes: null },
            });
            const data = res.data;
            if (data === undefined || data === null || data === '') {
                return text(`Ran ${args.action} on ${label(type, args)}.`);
            }
            return text(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
        } catch (e) {
            throw apiError(e, { notFound: `Not found: ${label(type, args)}` });
        }
    }

    const typeParam = (verb) => ({
        type: 'string',
        enum: typeNames({ verb }),
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
                "Describe a resource type: its parent and id, the operations it supports and, from this server's API, the request schemas and examples for create, update and clone. Call it before writing a type for the first time. Without `type`: all types and a guide to the platform's concepts (start here).",
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
                'List resources of a type, one JSON record per line, in pages of 50 (`count`, `index`). `search` finds by id or name. `filter` narrows by product, type, asset_type, asset_group, project or labels (key present), e.g. {"product": "boiler"}; alarm instances also take state and severity.',
            inputSchema: {
                type: 'object',
                properties: {
                    type: typeParam('list'),
                    parent: common.parent,
                    filter: { type: 'object', description: 'Query filters (see above).' },
                    search: {
                        type: 'string',
                        description:
                            'Text to look for in ids and names (partial, any case; descriptions are not searched). On the plugin catalog, words matched against every field shown.',
                    },
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
                'Create a resource from `body`, shaped as {tool:resource_describe} shows. `id` goes into the body\'s id field when the body lacks it; product_profile_* and product_service entries are stored under `id`, replacing any entry of that name. `projects` in the body (["<owner>@<project>"]) also puts the new resource in those projects.',
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
                        description:
                            'Patch (JSON merge) instead of replacing: property types and brands.',
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
        {
            name: 'resource_call',
            description:
                "Run an action of a resource that is not create/read/update/delete: verify a domain, restart a host, call an endpoint, export a product, test an alarm rule… {tool:resource_describe} lists each type's actions (after |) and their bodies.",
            inputSchema: {
                type: 'object',
                properties: {
                    type: {
                        type: 'string',
                        enum: Object.keys(CATALOG).filter((n) => CATALOG[n].actions),
                        description: 'Resource type.',
                    },
                    action: { type: 'string', description: 'Action name, e.g. "verify".' },
                    parent: common.parent,
                    id,
                    body: { description: 'Action input, when it takes one.' },
                    query: { type: 'object', description: 'Query parameters, when it takes them.' },
                    user: common.user,
                },
                required: ['type', 'action'],
            },
            handler: toolCall,
        },
    ];
}
