import api from './api.js';
import { apiError } from './errors.js';
import { v1 } from './paths.js';

// Backend enums (see backend/src/thinger/features/alarms/alarm_rule.hpp).
// Exported so the dashboard can render labels/colors without re-deriving
// them from string heuristics.
export const ALARM_STATE = {
    NONE: 0,
    ACTIVATED: 1,
    ACKNOWLEDGED: 2,
    LATCHED: 3,
    SHELVED: 4,
    CLEARED: 5,
};

export const ALARM_SEVERITY = {
    NONE: 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4,
};

export const ALARM_STATE_LABEL = {
    0: 'none',
    1: 'active',
    2: 'ack',
    3: 'latched',
    4: 'shelved',
    5: 'cleared',
};

export const ALARM_SEVERITY_LABEL = {
    0: 'none',
    1: 'low',
    2: 'med',
    3: 'high',
    4: 'crit',
};

// Reverse maps so callers can pass human-readable strings ("ack", "shelved",
// "high", …) instead of remembering the numeric enum values.
const STATE_FROM_LABEL = {
    none: ALARM_STATE.NONE,
    active: ALARM_STATE.ACTIVATED,
    activated: ALARM_STATE.ACTIVATED,
    ack: ALARM_STATE.ACKNOWLEDGED,
    acknowledged: ALARM_STATE.ACKNOWLEDGED,
    latched: ALARM_STATE.LATCHED,
    shelved: ALARM_STATE.SHELVED,
    cleared: ALARM_STATE.CLEARED,
};

const SEVERITY_FROM_LABEL = {
    none: ALARM_SEVERITY.NONE,
    low: ALARM_SEVERITY.LOW,
    med: ALARM_SEVERITY.MEDIUM,
    medium: ALARM_SEVERITY.MEDIUM,
    high: ALARM_SEVERITY.HIGH,
    crit: ALARM_SEVERITY.CRITICAL,
    critical: ALARM_SEVERITY.CRITICAL,
};

export function parseAlarmState(value) {
    if (value == null) return undefined;
    if (typeof value === 'number') return value;
    const key = String(value).trim().toLowerCase();
    return STATE_FROM_LABEL[key];
}

export function parseAlarmSeverity(value) {
    if (value == null) return undefined;
    if (typeof value === 'number') return value;
    const key = String(value).trim().toLowerCase();
    return SEVERITY_FROM_LABEL[key];
}

// Repeats a query param as the server expects (`?state=1&state=2`).
function appendMulti(params, key, values) {
    if (values == null) return;
    const arr = Array.isArray(values) ? values : [values];
    for (const v of arr) params.append(key, String(v));
}

/**
 * Query alarm instances from /v1/users/{user}/alarms/instances.
 *
 * `state` and `severity` are repeated query params — pass numbers or
 * arrays of numbers (matching the ALARM_STATE / ALARM_SEVERITY enums).
 *
 * @param {{
 *   user?: string | null,
 *   count?: number,
 *   index?: number,
 *   name?: string,
 *   state?: number | number[],
 *   severity?: number | number[],
 *   sort?: string,
 *   order?: string,
 * }} [opts]
 */
export async function getAlarmInstances({
    user = null,
    count = 100,
    index = 0,
    name,
    state,
    severity,
    sort,
    order,
} = {}) {
    const params = new URLSearchParams();
    params.set('count', String(count));
    params.set('index', String(index));
    if (name) params.set('name', name);
    if (sort) params.set('sort', sort);
    if (order) params.set('order', order);
    appendMulti(params, 'state', state);
    appendMulti(params, 'severity', severity);
    try {
        const res = await api.get(`${v1(user)}/alarms/instances?${params.toString()}`);
        return Array.isArray(res.data) ? res.data : [];
    } catch (e) {
        throw apiError(e);
    }
}

// Counter per state, e.g. { activated: 3, acknowledged: 1, ... }. The
// server seeds zeros for every known state so consumers can render a
// stable layout without null-checks.
export async function getAlarmInstanceStats({ user = null } = {}) {
    try {
        const res = await api.get(`${v1(user)}/alarms/instances/stats`);
        return res.data || {};
    } catch (e) {
        throw apiError(e);
    }
}

export async function getAlarmInstance(instance, { user = null } = {}) {
    try {
        const res = await api.get(`${v1(user)}/alarms/instances/${encodeURIComponent(instance)}`);
        return res.data;
    } catch (e) {
        throw apiError(e, { notFound: `Alarm instance not found: ${instance}` });
    }
}

// PUT-style update. The server accepts only a small whitelist of fields
// (see UPDATE_SCHEMA in alarms_instances.cpp): name, description, state,
// annotation, reactivation. Anything else is rejected.
export async function updateAlarmInstance(instance, body, { user = null } = {}) {
    try {
        const res = await api.put(
            `${v1(user)}/alarms/instances/${encodeURIComponent(instance)}`,
            body,
        );
        return res.data;
    } catch (e) {
        throw apiError(e, { notFound: `Alarm instance not found: ${instance}` });
    }
}

export async function deleteAlarmInstance(instance, { user = null } = {}) {
    try {
        await api.delete(`${v1(user)}/alarms/instances/${encodeURIComponent(instance)}`);
        return true;
    } catch (e) {
        throw apiError(e, { notFound: `Alarm instance not found: ${instance}` });
    }
}

export async function getAlarmRules({ user = null, count = 200, index = 0 } = {}) {
    const params = new URLSearchParams();
    params.set('count', String(count));
    params.set('index', String(index));
    try {
        const res = await api.get(`${v1(user)}/alarms/rules?${params.toString()}`);
        return Array.isArray(res.data) ? res.data : [];
    } catch (e) {
        throw apiError(e);
    }
}

export async function getAlarmRule(rule, { user = null } = {}) {
    try {
        const res = await api.get(`${v1(user)}/alarms/rules/${encodeURIComponent(rule)}`);
        return res.data;
    } catch (e) {
        throw apiError(e, { notFound: `Alarm rule not found: ${rule}` });
    }
}

// POST /v1/users/{user}/alarms/rules. The body must include `rule`,
// `name`, `enabled` and an optional `config` object — see CREATE_SCHEMA
// in alarms_rules.cpp for the full shape.
export async function createAlarmRule(body, { user = null } = {}) {
    try {
        const res = await api.post(`${v1(user)}/alarms/rules`, body);
        return res.data;
    } catch (e) {
        throw apiError(e);
    }
}

export async function updateAlarmRule(rule, body, { user = null } = {}) {
    try {
        const res = await api.put(`${v1(user)}/alarms/rules/${encodeURIComponent(rule)}`, body);
        return res.data;
    } catch (e) {
        throw apiError(e, { notFound: `Alarm rule not found: ${rule}` });
    }
}

export async function deleteAlarmRule(rule, { user = null } = {}) {
    try {
        await api.delete(`${v1(user)}/alarms/rules/${encodeURIComponent(rule)}`);
        return true;
    } catch (e) {
        throw apiError(e, { notFound: `Alarm rule not found: ${rule}` });
    }
}
