// @ts-check
import { v1, v2, v3 } from '../paths.js';
import { inputError } from '../errors.js';

/**
 * The resource catalog: every server collection the generic `resource_*`
 * tools can reach, as data.
 *
 * Each entry says where the collection lives and which operations the
 * tools may run on it, with the server's operationId for each (the tests
 * check every one against the server's OpenAPI document, and
 * `resource_describe` uses them to find the request schemas). A draft of
 * this table comes from `scripts/catalog-draft.js`; the table itself is
 * reviewed by hand and never discovered at run time, so a collection the
 * server adds (an administration one, say) reaches the model only when
 * someone decides it should.
 *
 * Paths are relative to the parent's item path, or to the account
 * (`/v{N}/users/{account}`) for top-level types; `version` applies to the
 * whole path. Verbs map to requests as follows:
 *
 *   list     GET    <collection>
 *   create   POST   <collection>      (PUT <item> when `upsert`)
 *   get      GET    <item>
 *   update   PUT    <item>
 *   patch    PATCH  <item>            (update with `merge: true`)
 *   delete   DELETE <item>
 *   clone    POST   <item>/clone
 *   projects PUT    <item>/projects   (the `projects` field of an update)
 *
 * A type without `id` is a single resource of its parent (get / update on
 * the path itself).
 */

/**
 * @typedef {'list' | 'create' | 'get' | 'update' | 'patch' | 'delete' | 'clone' | 'projects'} Verb
 *
 * @typedef {object} ResourceType
 * @property {string} description  One line, shown in the catalog summary.
 * @property {'v1' | 'v2' | 'v3'} version
 * @property {string} path         Collection path, relative to the parent item or the account.
 * @property {string} [parent]     Type this one hangs off.
 * @property {string | string[]} [id]  Name of the item id (or names, for ids in several segments).
 * @property {string[]} [bodyId]   Body fields `create` copies the id into, when they differ
 *   from the id names; empty when the server generates the id.
 * @property {Partial<Record<Verb, string>>} ops  Allowed verbs → server operationId.
 * @property {boolean} [upsert]    Created with PUT on the item path, so `create` needs the id.
 * @property {boolean} [admin]     Only served when the MCP server runs in admin mode.
 * @property {string} [notes]      Longer guidance returned by `resource_describe`.
 * @property {boolean} [sdk]       `resource_describe` adds the dashboard SDK reference, read from the server.
 */

const PROPERTY_NOTES =
    'Properties hold any JSON `value`. Create with body {property, name?, description?, value}; update replaces the value ({value}), while update with merge: true patches it (JSON merge of objects).';

const PROFILE_NOTES =
    'Product profile entries are keyed by name: create and update both store the entry under `id` (PUT), replacing what was there, so read it first to change one field.';

/** Where profile listeners (buckets, properties) take their data from. */
const LISTENER_SOURCE =
    'data.source is one of: "resource" (poll a device resource: {resource, update: "interval"|"event", interval, magnitude: "second"|"minute"|"hour"…}), "resource_stream" ({resource_stream}), "product_stream" ({product_stream, product?}), "topic" ({topic}, MQTT), "event" ({event, filter?}). Optional: data.payload_type ("template_payload" with data.payload such as "{{payload}}", "source_payload" to keep the payload as is, "source_event", "none") and data.payload_function (a function of the product code).';

const PROFILE_API_NOTES = `${PROFILE_NOTES} An API resource is a REST endpoint added to every device of the product and dispatched by the server: {enabled, request: {data: {target, payload_type?, payload?, payload_function?, ...}}, response: {data: {payload_type, source?, payload?, payload_function?}}}. request.data.target is one of: "resource" ({resource}: a device resource), "resource_stream" ({resource_stream}; defaults to the API resource name), "product_stream" ({product, product_stream}), "property" ({property}), "function" ({function}: product code), "endpoint" ({endpoint}), "topic" ({topic}). Payload types: "template_payload" (default; data.payload is a template such as "{{payload}}"), "source_payload" (forward the body), "source_event" (the whole event), "none". response.data {payload_type: "none"} is fire-and-forget; "source_payload" returns the target's answer. Example: {"enabled": true, "request": {"data": {"target": "resource_stream", "resource_stream": "backup_complete", "payload_type": "source_payload"}}, "response": {"data": {"payload_type": "none"}}}. Called by device ({tool:device_resource_call} on a device of the product), or for the product as a whole with {tool:product_resource_call}, which needs "device_id_resolver": "<function of the product code>" in the entry to find each payload's device.`;

const PROFILE_BUCKET_NOTES = `${PROFILE_NOTES} A profile bucket stores, for each device of the product, the samples of a data source; the bucket itself is created on the first sample. Shape: {enabled, name, description, backend: "mongodb" (default) or "influxdb", data: {source, ...}, retention?: {period, unit: "minutes"|"hours"|"days"|"months"|"years"}, tags?: []}. ${LISTENER_SOURCE} Unless the bucket name has "{{device}}", samples get "device" and "group" tags, so one bucket holds the whole fleet. Deleting the entry stops recording but keeps the bucket and its data. Example: {"enabled": true, "name": "backups", "backend": "mongodb", "data": {"source": "resource_stream", "resource_stream": "backup_complete", "payload_type": "source_payload"}, "retention": {"period": 1, "unit": "years"}}.`;

const PROFILE_PROPERTY_NOTES = `${PROFILE_NOTES} A profile property writes a data source into a property of each device of the product (not to be confused with product_property, a value stored on the product itself). Shape: {enabled, name, description, data: {source, ..., patch?: true to merge into the existing value}}. ${LISTENER_SOURCE}`;

/** @type {Record<string, ResourceType>} */
export const CATALOG = {
    // ─── Account resources ──────────────────────────────────────────
    device: {
        description: 'Devices of the account (IOTMP, MQTT, HTTP, virtual).',
        version: 'v1',
        path: 'devices',
        id: 'device',
        ops: {
            list: 'Device_List',
            create: 'Device_Create',
            get: 'Device_ReadStatus',
            update: 'Device_Update',
            delete: 'Device_Delete',
            clone: 'Device_Clone',
            projects: 'Device_UpdateProjects',
        },
        notes: '`type` defaults to Generic (IOTMP). Generic and MQTT devices authenticate with `credentials`: when creating one without them, credentials are generated and returned once (the server stores them hashed). HTTP devices send data through {tool:device_data_send}; assign a product with update {product} ("" unassigns).',
    },
    product: {
        description:
            'Products: shared configuration and profile (APIs, buckets, properties…) for a fleet of devices.',
        version: 'v1',
        path: 'products',
        id: 'product',
        ops: {
            list: 'Product_List',
            create: 'Product_Create',
            get: 'Product_ReadConfig',
            update: 'Product_Update',
            delete: 'Product_Delete',
            clone: 'Product_Clone',
            projects: 'Product_UpdateProjects',
        },
        notes: 'The profile can be sent whole in create or update, or edited entry by entry through the product_profile_* types.',
    },
    bucket: {
        description:
            'Data buckets (time series). Data is read and written with {tool:bucket_data_read} / {tool:bucket_data_write}.',
        version: 'v1',
        path: 'buckets',
        id: 'bucket',
        ops: {
            list: 'Bucket_List',
            create: 'Bucket_Create',
            get: 'Bucket_ReadConfig',
            update: 'Bucket_Update',
            delete: 'Bucket_Delete',
            clone: 'Bucket_Clone',
            projects: 'Bucket_UpdateProjects',
        },
    },
    dashboard: {
        description:
            'Dashboards: widget layouts, or HTML apps published with {tool:dashboard_publish}.',
        version: 'v1',
        path: 'dashboards',
        id: 'dashboard',
        sdk: true,
        notes: 'A dashboard is either a widget layout (source "widgets") or an HTML app (source "url", the page at `url`) that uses the dashboard SDK: build those with {tool:dashboard_publish}, which uploads the app and points the dashboard at it. The SDK reference is under `sdk`. A per-device, product, asset type, asset group or project dashboard is the "dashboard" property of that resource instead ({tool:dashboard_publish} with `target`).',
        ops: {
            list: 'Dashboard_List',
            create: 'Dashboard_Create',
            get: 'Dashboard_ReadConfig',
            update: 'Dashboard_Update',
            delete: 'Dashboard_Delete',
            clone: 'Dashboard_Clone',
            projects: 'Dashboard_UpdateProjects',
        },
    },
    endpoint: {
        description:
            'Endpoints: outgoing HTTP calls, emails, notifications (run one with endpoint_call).',
        version: 'v1',
        path: 'endpoints',
        id: 'endpoint',
        ops: {
            list: 'Endpoint_List',
            create: 'Endpoint_Create',
            get: 'Endpoint_ReadConfig',
            update: 'Endpoint_Update',
            delete: 'Endpoint_Delete',
            clone: 'Endpoint_Clone',
            projects: 'Endpoint_UpdateProjects',
        },
    },
    storage: {
        description: 'File storages (their files are handled with the storage_file_* tools).',
        version: 'v1',
        path: 'storages',
        id: 'storage',
        ops: {
            list: 'Storage_List',
            create: 'Storage_Create',
            get: 'Storage_ReadConfig',
            update: 'Storage_Update',
            delete: 'Storage_Delete',
            clone: 'Storage_Clone',
            projects: 'Storage_UpdateProjects',
        },
    },
    asset_type: {
        description: 'Asset types: a category of device (e.g. "boiler"), with its own properties.',
        version: 'v1',
        path: 'types',
        id: 'type',
        ops: {
            list: 'Type_List',
            create: 'Type_Create',
            get: 'Type_ReadConfig',
            update: 'Type_Update',
            delete: 'Type_Delete',
            clone: 'Type_Clone',
            projects: 'Type_UpdateProjects',
        },
    },
    asset_group: {
        description: 'Asset groups: a set of devices (e.g. a site), with its own properties.',
        version: 'v1',
        path: 'groups',
        id: 'group',
        ops: {
            list: 'Group_List',
            create: 'Group_Create',
            get: 'Group_ReadConfig',
            update: 'Group_Update',
            delete: 'Group_Delete',
            clone: 'Group_Clone',
            projects: 'Group_UpdateProjects',
        },
    },
    project: {
        description: 'Projects: group resources of any type to share them or show them together.',
        version: 'v1',
        path: 'projects',
        id: 'project',
        ops: {
            list: 'Project_List',
            create: 'Project_Create',
            get: 'Project_ReadConfig',
            update: 'Project_Update',
            delete: 'Project_Delete',
            clone: 'Project_Clone',
        },
        notes: 'Resources join a project through their own update: {projects: ["<owner>@<project>"]}, e.g. "alice@plant_a"; the list replaces the previous one. List the resources of a project with filter {project: "<project>"}.',
    },
    token: {
        description: 'Access tokens of the account, with their permission tree.',
        version: 'v1',
        path: 'tokens',
        id: 'token',
        ops: {
            list: 'Token_List',
            create: 'Token_Create',
            get: 'Token_ReadConfig',
            update: 'Token_Update',
            delete: 'Token_Delete',
            clone: 'Token_Clone',
            projects: 'Token_UpdateProjects',
        },
        notes: 'Permissions: `allow` (and optional `deny`) is {ResourceType: {id or "*": [actions] or "*"}}, e.g. {"Device": {"*": "*"}} or {"Device": {"sensor_1": ["ReadDeviceStatus", "AccessDeviceResources"]}}; {"*": {"*": "*"}} is full access. {tool:resource_describe} of any type lists its ResourceType and actions under `permissions`. `expire` takes unix seconds or a duration such as "30d". The JWT (`access_token`) is returned by create and get, never by list.',
    },
    alarm_rule: {
        description: 'Alarm rules: conditions on device or bucket data that raise alarm instances.',
        version: 'v1',
        path: 'alarms/rules',
        id: 'rule',
        ops: {
            list: 'Alarm_ListRules',
            create: 'Alarm_CreateRule',
            get: 'Alarm_ReadRuleConfig',
            update: 'Alarm_UpdateRule',
            delete: 'Alarm_DeleteRule',
            clone: 'Alarm_CloneRule',
            projects: 'Alarm_UpdateRuleProjects',
        },
        notes: 'Try a rule before saving it with {tool:alarm_rule_test}.',
    },
    alarm_instance: {
        description:
            'Alarm instances raised by the rules; update them to acknowledge, shelve or clear.',
        version: 'v1',
        path: 'alarms/instances',
        id: 'instance',
        ops: {
            list: 'Alarm_ListInstances',
            get: 'Alarm_ReadInstanceConfig',
            update: 'Alarm_UpdateInstance',
            delete: 'Alarm_DeleteInstance',
            projects: 'Alarm_UpdateInstanceProjects',
        },
        notes: 'States: 0 none, 1 active, 2 acknowledged, 3 latched, 4 shelved, 5 cleared; severities: 0 none, 1 low, 2 medium, 3 high, 4 critical. Acknowledge with update {state: 2, annotation?}; shelve with {state: 4, reactivation: {type: "timespan", timespan: {value, magnitude: "minute"|"hour"|"day"…}}}; clear with {state: 5} (a cleared alarm cannot be reactivated). Prefer clearing to deleting: delete removes the history. List filters: state and severity (arrays allowed), name, sort, order.',
    },
    claim: {
        description: 'Device claims: codes that let end users take ownership of a device.',
        version: 'v1',
        path: 'claims',
        id: 'claim',
        ops: {
            list: 'Claim_List',
            create: 'Claim_Create',
            get: 'Claim_ReadConfig',
            update: 'Claim_Update',
            delete: 'Claim_Delete',
            clone: 'Claim_Clone',
            projects: 'Claim_UpdateProjects',
        },
    },
    property: {
        description: 'Account properties: JSON values stored on the account.',
        version: 'v1',
        path: 'properties',
        id: 'property',
        ops: {
            list: 'Property_ListProperties',
            create: 'Property_Create',
            get: 'Property_Read',
            update: 'Property_Update',
            patch: 'Property_Patch',
            delete: 'Property_Delete',
            clone: 'Property_Clone',
        },
        notes: PROPERTY_NOTES,
    },
    role: {
        description: 'Roles: named permission sets for project members.',
        version: 'v1',
        path: 'roles',
        id: 'role',
        admin: true,
        ops: {
            list: 'Role_List',
            create: 'Role_Create',
            get: 'Role_ReadConfig',
            update: 'Role_Update',
            delete: 'Role_Delete',
            clone: 'Role_Clone',
        },
    },
    sync: {
        description: 'Syncs: replication of resources with another server.',
        version: 'v1',
        path: 'syncs',
        id: 'sync',
        admin: true,
        ops: {
            list: 'Sync_List',
            create: 'Sync_Create',
            get: 'Sync_ReadConfig',
            update: 'Sync_Update',
            delete: 'Sync_Delete',
            clone: 'Sync_Clone',
            projects: 'Sync_UpdateProjects',
        },
    },

    // ─── Device children ────────────────────────────────────────────
    device_property: {
        description: 'Properties of a device: its structured state (configuration, calibration…).',
        version: 'v3',
        parent: 'device',
        path: 'properties',
        id: 'property',
        ops: {
            list: 'Device_ListProperties',
            create: 'Device_CreateProperty',
            get: 'Device_ReadProperty',
            update: 'Device_UpdateProperty',
            patch: 'Device_PatchProperty',
            delete: 'Device_DeleteProperty',
            clone: 'Device_CloneProperty',
        },
        notes: PROPERTY_NOTES,
    },
    device_token: {
        description: 'Tokens scoped to one device and some of its resources.',
        version: 'v1',
        parent: 'device',
        path: 'tokens',
        id: 'token',
        bodyId: [],
        ops: {
            list: 'Device_ListTokens',
            create: 'Device_CreateToken',
            delete: 'Device_DeleteToken',
        },
        notes: 'Create with {token_name, token_resources?: [resource names] (all when omitted), token_expiration?: unix seconds or a duration such as "30d"}.',
    },
    device_bucket: {
        description: 'Buckets that hold data of a device (read-only listing).',
        version: 'v3',
        parent: 'device',
        path: 'buckets',
        id: 'bucket',
        ops: { list: 'Device_ListBuckets' },
    },
    device_bucket_tag: {
        description: 'Tags of a device bucket (parent: "<device>/<bucket>").',
        version: 'v3',
        parent: 'device_bucket',
        path: 'tags',
        id: 'tag',
        ops: { list: 'Device_ListBucketTags', get: 'Device_ReadBucketTag' },
    },
    device_service: {
        description: 'Services a device exposes (web, VNC…).',
        version: 'v3',
        parent: 'device',
        path: 'services',
        id: 'service',
        ops: { list: 'Device_ListServices', get: 'Device_ReadService' },
    },
    device_callback: {
        description:
            'HTTP callback settings of a device: what the server does with the data it receives.',
        version: 'v3',
        parent: 'device',
        path: 'callback',
        ops: { get: 'Device_ReadCallbackConfig', update: 'Device_UpdateCallback' },
    },

    // ─── Product children ───────────────────────────────────────────
    product_property: {
        description: 'Properties of a product.',
        version: 'v1',
        parent: 'product',
        path: 'properties',
        id: 'property',
        ops: {
            list: 'Product_ListProperties',
            create: 'Product_CreateProperty',
            get: 'Product_ReadProperty',
            update: 'Product_UpdateProperty',
            patch: 'Product_PatchProperty',
            delete: 'Product_DeleteProperty',
            clone: 'Product_CloneProperty',
        },
        notes: PROPERTY_NOTES,
    },
    product_profile_api: {
        description:
            'API resources a product adds to its devices (calls to device resources, endpoints, scripts).',
        version: 'v1',
        parent: 'product',
        path: 'profile/api',
        id: 'resource',
        upsert: true,
        ops: {
            list: 'Product_ReadProfile',
            create: 'Product_UpdateProductProfileResource',
            get: 'Product_ReadProductProfileResource',
            update: 'Product_UpdateProductProfileResource',
            delete: 'Product_DeleteProductProfileResource',
        },
        notes: PROFILE_API_NOTES,
    },
    product_profile_bucket: {
        description: 'Buckets a product keeps for each of its devices.',
        version: 'v1',
        parent: 'product',
        path: 'profile/buckets',
        id: 'resource',
        upsert: true,
        ops: {
            list: 'Product_ReadProfile',
            create: 'Product_UpdateProductProfileResource',
            get: 'Product_ReadProductProfileResource',
            update: 'Product_UpdateProductProfileResource',
            delete: 'Product_DeleteProductProfileResource',
        },
        notes: PROFILE_BUCKET_NOTES,
    },
    product_profile_property: {
        description: 'Properties a product creates on each of its devices.',
        version: 'v1',
        parent: 'product',
        path: 'profile/properties',
        id: 'resource',
        upsert: true,
        ops: {
            list: 'Product_ReadProfile',
            create: 'Product_UpdateProductProfileResource',
            get: 'Product_ReadProductProfileResource',
            update: 'Product_UpdateProductProfileResource',
            delete: 'Product_DeleteProductProfileResource',
        },
        notes: PROFILE_PROPERTY_NOTES,
    },
    product_profile_autoprovision: {
        description: 'Autoprovisioning rules: which connecting devices join the product.',
        version: 'v1',
        parent: 'product',
        path: 'profile/autoprovisions',
        id: 'resource',
        upsert: true,
        ops: {
            list: 'Product_ReadProfile',
            create: 'Product_UpdateProductProfileResource',
            get: 'Product_ReadProductProfileResource',
            update: 'Product_UpdateProductProfileResource',
            delete: 'Product_DeleteProductProfileResource',
        },
        notes: PROFILE_NOTES,
    },
    product_profile_flow: {
        description: 'Data flows of a product: periodic reads of device resources.',
        version: 'v1',
        parent: 'product',
        path: 'profile/flows',
        id: 'resource',
        upsert: true,
        ops: {
            list: 'Product_ReadProfile',
            create: 'Product_UpdateProductProfileResource',
            get: 'Product_ReadProductProfileResource',
            update: 'Product_UpdateProductProfileResource',
            delete: 'Product_DeleteProductProfileResource',
        },
        notes: PROFILE_NOTES,
    },
    product_profile_code: {
        description: 'Script code of a product (JavaScript run by the server for its devices).',
        version: 'v1',
        parent: 'product',
        path: 'profile/code',
        ops: { get: 'Product_ReadProfileCode', update: 'Product_UpdateProfileCode' },
    },
    product_service: {
        description: 'Services a product exposes on its devices.',
        version: 'v1',
        parent: 'product',
        path: 'services',
        id: 'service',
        upsert: true,
        ops: {
            list: 'Product_ReadServices',
            create: 'Product_UpdateServices',
            get: 'Product_ReadServices',
            update: 'Product_UpdateServices',
            delete: 'Product_DeleteServices',
        },
    },

    // ─── Bucket children ────────────────────────────────────────────
    bucket_tag: {
        description: 'Tags of a bucket and their values.',
        version: 'v1',
        parent: 'bucket',
        path: 'tags',
        id: 'tag',
        ops: { list: 'Bucket_ListTags', get: 'Bucket_ReadTag' },
    },
    bucket_export: {
        description: 'Exports of a bucket (files generated from its data).',
        version: 'v1',
        parent: 'bucket',
        path: 'exports',
        id: 'file',
        bodyId: [],
        ops: {
            list: 'Bucket_ListExports',
            create: 'Bucket_CreateExport',
            delete: 'Bucket_DeleteExport',
        },
    },

    // ─── Asset and project children ─────────────────────────────────
    asset_type_property: {
        description: 'Properties of an asset type.',
        version: 'v1',
        parent: 'asset_type',
        path: 'properties',
        id: 'property',
        ops: {
            list: 'Type_ListProperties',
            create: 'Type_CreateProperty',
            get: 'Type_ReadProperty',
            update: 'Type_UpdateProperty',
            patch: 'Type_PatchProperty',
            delete: 'Type_DeleteProperty',
            clone: 'Type_CloneProperty',
        },
        notes: PROPERTY_NOTES,
    },
    asset_group_property: {
        description: 'Properties of an asset group.',
        version: 'v1',
        parent: 'asset_group',
        path: 'properties',
        id: 'property',
        ops: {
            list: 'Group_ListProperties',
            create: 'Group_CreateProperty',
            get: 'Group_ReadProperty',
            update: 'Group_UpdateProperty',
            patch: 'Group_PatchProperty',
            delete: 'Group_DeleteProperty',
            clone: 'Group_CloneProperty',
        },
        notes: PROPERTY_NOTES,
    },
    project_property: {
        description: 'Properties of a project.',
        version: 'v1',
        parent: 'project',
        path: 'properties',
        id: 'property',
        ops: {
            list: 'Project_ListProperties',
            create: 'Project_CreateProperty',
            get: 'Project_ReadProperty',
            update: 'Project_UpdateProperty',
            patch: 'Project_PatchProperty',
            delete: 'Project_DeleteProperty',
            clone: 'Project_CloneProperty',
        },
        notes: PROPERTY_NOTES,
    },
    project_member: {
        description: 'Members a project is shared with, and their roles.',
        version: 'v1',
        parent: 'project',
        path: 'members',
        id: 'member',
        admin: true,
        ops: {
            list: 'Project_ListMembers',
            create: 'Project_CreateMember',
            get: 'Project_ReadMemberConfig',
            update: 'Project_UpdateMember',
            delete: 'Project_DeleteMember',
        },
    },
    project_role: {
        description: 'Roles defined inside a project.',
        version: 'v1',
        parent: 'project',
        path: 'roles',
        id: 'role',
        admin: true,
        ops: {
            list: 'Project_ListRoles',
            create: 'Project_CreateRole',
            get: 'Project_ReadRoleConfig',
            update: 'Project_UpdateRole',
            delete: 'Project_DeleteRole',
            clone: 'Project_CloneRole',
        },
    },
};

/** HTTP method of each verb, and what it appends to the item path. */
export const VERBS = /** @type {const} */ ({
    list: { method: 'get', on: 'collection' },
    create: { method: 'post', on: 'collection' },
    get: { method: 'get', on: 'item' },
    update: { method: 'put', on: 'item' },
    patch: { method: 'patch', on: 'item' },
    delete: { method: 'delete', on: 'item' },
    clone: { method: 'post', on: 'item', suffix: 'clone' },
    projects: { method: 'put', on: 'item', suffix: 'projects' },
});

/**
 * Names of the types served, optionally only those supporting `verb`.
 *
 * @param {{ admin?: boolean, verb?: Verb }} [opts]
 */
export function typeNames({ admin = false, verb } = {}) {
    return Object.entries(CATALOG)
        .filter(([, t]) => (admin || !t.admin) && (!verb || verb in t.ops))
        .map(([name]) => name);
}

/** Parents of a type, outermost first: `device_bucket_tag` → [device, device_bucket]. */
export function ancestry(name) {
    const chain = [];
    for (let t = CATALOG[name]?.parent; t; t = CATALOG[t].parent) chain.unshift(t);
    return chain;
}

/** Id names of a type, as an array (empty for single resources). */
export function idNames(type) {
    return type.id === undefined ? [] : [type.id].flat();
}

/** How a type's ids are written: `<device>`. */
export function idHint(name) {
    return idNames(CATALOG[name])
        .map((n) => `<${n}>`)
        .join('/');
}

/** How the parent of a type is written: `<device>/<bucket>`. */
export function parentHint(name) {
    return ancestry(name).map(idHint).join('/');
}

/**
 * Split a `a/b` reference into exactly `count` non-empty segments.
 *
 * @param {unknown} value
 * @param {number} count
 * @param {string} what  Argument name and expected shape, for the error.
 */
function segments(value, count, what) {
    if (count === 0) return [];
    const parts = value === undefined || value === null ? [] : String(value).split('/');
    if (parts.length !== count || parts.some((p) => !p)) {
        throw inputError(`${what} is required`);
    }
    return parts;
}

/**
 * Resolve the request a verb maps to.
 *
 * @param {string} name  Catalog type.
 * @param {Verb} verb
 * @param {{ parent?: string, id?: string, user?: string | null }} [args]
 * @returns {{ method: string, url: string }}
 */
export function requestFor(name, verb, { parent, id, user } = {}) {
    const type = CATALOG[name];
    if (!type) throw inputError(`Unknown type "${name}"`);
    if (!(verb in type.ops)) {
        throw inputError(`Type "${name}" does not support ${verb}`);
    }

    const chain = ancestry(name);
    const parentIds = segments(
        parent,
        chain.reduce((n, t) => n + idNames(CATALOG[t]).length, 0),
        `parent (${parentHint(name)})`,
    );

    // Build the path from the outermost ancestor down, consuming parent ids.
    let path = '';
    for (const t of chain) {
        path += `/${CATALOG[t].path}`;
        for (const _ of idNames(CATALOG[t])) path += `/${encodeURIComponent(parentIds.shift())}`;
    }
    path += `/${type.path}`;

    const spec = VERBS[verb];
    const onItem = spec.on === 'item' || (verb === 'create' && type.upsert);
    if (onItem && idNames(type).length) {
        const ids = segments(id, idNames(type).length, `id (${idHint(name)})`);
        path += ids.map((i) => `/${encodeURIComponent(i)}`).join('');
    }
    if ('suffix' in spec) path += `/${spec.suffix}`;

    const method = verb === 'create' && type.upsert ? 'put' : spec.method;
    const base = { v1, v2, v3 }[type.version];
    return { method, url: `${base(user)}${path}` };
}

/**
 * The OpenAPI path template and method a verb maps to, account part
 * included (`/v1/users/{user}/devices/{}`): what the tests and
 * `resource_describe` match against the server's document. Ids appear
 * as `{}`.
 *
 * @param {string} name
 * @param {Verb} verb
 */
export function templateFor(name, verb) {
    const type = CATALOG[name];
    const chain = ancestry(name);
    let path = `/${type.version}/users/{}`;
    for (const t of chain) {
        path += `/${CATALOG[t].path}`;
        for (const _ of idNames(CATALOG[t])) path += '/{}';
    }
    path += `/${type.path}`;
    const spec = VERBS[verb];
    if (spec.on === 'item' || (verb === 'create' && type.upsert)) {
        for (const _ of idNames(type)) path += '/{}';
    }
    if ('suffix' in spec) path += `/${spec.suffix}`;
    const method = verb === 'create' && type.upsert ? 'put' : spec.method;
    return { method, path };
}
