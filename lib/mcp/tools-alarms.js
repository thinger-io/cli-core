// @ts-check
import {
    getAlarmInstances,
    getAlarmInstance,
    getAlarmInstanceStats,
    updateAlarmInstance,
    deleteAlarmInstance,
    getAlarmRules,
    getAlarmRule,
    createAlarmRule,
    updateAlarmRule,
    deleteAlarmRule,
    parseAlarmState,
    parseAlarmSeverity,
    ALARM_STATE_LABEL,
    ALARM_SEVERITY_LABEL,
    ALARM_STATE,
} from '../alarms.js';
import { inputError } from '../errors.js';

// Helpers ------------------------------------------------------------------

function normalizeStateInput(value) {
    if (value == null) return undefined;
    const arr = Array.isArray(value) ? value : [value];
    const out = [];
    for (const v of arr) {
        const parsed = parseAlarmState(v);
        if (parsed === undefined) {
            throw inputError(
                `Unknown alarm state "${v}". Valid: active, ack, latched, shelved, cleared.`,
            );
        }
        out.push(parsed);
    }
    return out;
}

function normalizeSeverityInput(value) {
    if (value == null) return undefined;
    const arr = Array.isArray(value) ? value : [value];
    const out = [];
    for (const v of arr) {
        const parsed = parseAlarmSeverity(v);
        if (parsed === undefined) {
            throw inputError(`Unknown alarm severity "${v}". Valid: low, medium, high, critical.`);
        }
        out.push(parsed);
    }
    return out;
}

function originLabel(inst) {
    const origin = inst?.origin || {};
    if (!origin.id && !origin.name) return '';
    const id = origin.id || '';
    const name = origin.name && origin.name !== id ? ` (${origin.name})` : '';
    return ` ${id}${name}`;
}

function ageMsToHuman(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
}

function instanceAgeMs(inst) {
    const v = inst?.created;
    if (v == null) return 0;
    if (typeof v === 'number') return Date.now() - v;
    if (typeof v === 'object' && v.$date != null) {
        const t = typeof v.$date === 'number' ? v.$date : Date.parse(v.$date);
        return Number.isFinite(t) ? Date.now() - t : 0;
    }
    if (typeof v === 'string') {
        const t = Date.parse(v);
        return Number.isFinite(t) ? Date.now() - t : 0;
    }
    return 0;
}

function renderInstanceRow(inst) {
    const id = inst?.instance || '?';
    const rule = inst?.alarm?.rule || '?';
    const sev = ALARM_SEVERITY_LABEL[inst?.severity ?? 0] || '?';
    const state = ALARM_STATE_LABEL[inst?.state ?? 0] || '?';
    const age = ageMsToHuman(instanceAgeMs(inst));
    const ann = inst?.annotation ? `  note="${inst.annotation}"` : '';
    return `[${state.padEnd(8)}] ${sev.padEnd(5)} ${id}  rule=${rule}${originLabel(inst)}${age ? `  age=${age}` : ''}${ann}`;
}

// Tools --------------------------------------------------------------------

async function toolAlarmInstances(args) {
    const state = normalizeStateInput(args.state);
    const severity = normalizeSeverityInput(args.severity);
    const list = await getAlarmInstances({
        user: args.user,
        count: Number.isFinite(args.count) && args.count > 0 ? Math.floor(args.count) : 100,
        index: Number.isFinite(args.index) && args.index >= 0 ? Math.floor(args.index) : 0,
        name: args.name,
        state,
        severity,
        sort: args.sort,
        order: args.order,
    });

    if (list.length === 0) {
        return {
            content: [{ type: 'text', text: 'No alarm instances match the filter.' }],
            isError: false,
        };
    }

    const lines = list.map(renderInstanceRow);
    return {
        content: [
            {
                type: 'text',
                text: `${list.length} alarm instance(s):\n${lines.join('\n')}`,
            },
        ],
        isError: false,
    };
}

async function toolAlarmInstanceStats(args) {
    const stats = await getAlarmInstanceStats({ user: args.user });
    return {
        content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
        isError: false,
    };
}

async function toolAlarmInstanceGet(args) {
    if (!args.instance) throw inputError('instance is required');
    const inst = await getAlarmInstance(args.instance, { user: args.user });
    return {
        content: [{ type: 'text', text: JSON.stringify(inst, null, 2) }],
        isError: false,
    };
}

async function toolAlarmInstanceUpdate(args) {
    if (!args.instance) throw inputError('instance is required');

    const body = {};

    if (args.state !== undefined) {
        const parsed = parseAlarmState(args.state);
        if (parsed === undefined) {
            throw inputError(
                `Unknown alarm state "${args.state}". Valid: active, ack, latched, shelved, cleared.`,
            );
        }
        body.state = parsed;
    }

    if (args.annotation !== undefined) {
        body.annotation = String(args.annotation);
    }

    if (args.reactivation_minutes !== undefined) {
        const minutes = Number(args.reactivation_minutes);
        if (!Number.isFinite(minutes) || minutes < 0) {
            throw inputError('reactivation_minutes must be a non-negative number');
        }
        // The server expects the timespan with magnitude + value. Zero
        // resets the scheduled reactivation, so we pass it through as-is.
        body.reactivation = {
            type: minutes > 0 ? 'timespan' : 'none',
            timespan: { magnitude: 'minute', value: minutes },
        };
    } else if (args.reactivation !== undefined) {
        body.reactivation = args.reactivation;
    }

    if (Object.keys(body).length === 0) {
        throw inputError(
            'Nothing to update. Pass at least one of: state, annotation, reactivation_minutes.',
        );
    }

    const updated = await updateAlarmInstance(args.instance, body, { user: args.user });
    const stateLabel = ALARM_STATE_LABEL[updated?.state ?? 0] || '?';
    return {
        content: [
            {
                type: 'text',
                text:
                    `Updated ${args.instance} → state=${stateLabel}` +
                    (updated?.annotation ? `, annotation="${updated.annotation}"` : ''),
            },
        ],
        isError: false,
    };
}

async function toolAlarmInstanceDelete(args) {
    if (!args.instance) throw inputError('instance is required');
    await deleteAlarmInstance(args.instance, { user: args.user });
    return {
        content: [{ type: 'text', text: `Deleted alarm instance ${args.instance}.` }],
        isError: false,
    };
}

async function toolAlarmRules(args) {
    const rules = await getAlarmRules({ user: args.user });
    if (rules.length === 0) {
        return {
            content: [{ type: 'text', text: 'No alarm rules configured.' }],
            isError: false,
        };
    }
    const lines = rules.map((r) => {
        const id = r.rule || r._id || '?';
        const name = r.name && r.name !== id ? ` (${r.name})` : '';
        const enabled = r.enabled ? '✓' : '✗';
        const desc = r.description ? ` — ${r.description}` : '';
        return `${enabled}  ${id}${name}${desc}`;
    });
    return {
        content: [{ type: 'text', text: `${rules.length} alarm rule(s):\n${lines.join('\n')}` }],
        isError: false,
    };
}

async function toolAlarmRuleRead(args) {
    if (!args.rule) throw inputError('rule is required');
    const rule = await getAlarmRule(args.rule, { user: args.user });
    return {
        content: [{ type: 'text', text: JSON.stringify(rule, null, 2) }],
        isError: false,
    };
}

async function toolAlarmRuleWrite(args) {
    if (!args.rule) throw inputError('rule is required');

    // Decide create vs update by probing the server. The CREATE schema
    // requires `rule`, `name`, `enabled`; UPDATE only accepts a subset.
    let exists = false;
    try {
        await getAlarmRule(args.rule, { user: args.user });
        exists = true;
    } catch (e) {
        if (e?.code !== 'not_found') throw e;
    }

    if (exists) {
        const body = {};
        if (args.name !== undefined) body.name = args.name;
        if (args.description !== undefined) body.description = args.description;
        if (args.enabled !== undefined) body.enabled = !!args.enabled;
        if (args.config !== undefined) body.config = args.config;
        if (Object.keys(body).length === 0) {
            throw inputError(
                'Nothing to update. Pass at least one of: name, description, enabled, config.',
            );
        }
        await updateAlarmRule(args.rule, body, { user: args.user });
        return {
            content: [{ type: 'text', text: `Updated alarm rule "${args.rule}".` }],
            isError: false,
        };
    }

    if (!args.name) throw inputError('name is required when creating a rule');
    if (args.enabled === undefined) {
        throw inputError('enabled is required when creating a rule (true or false)');
    }
    const body = {
        rule: args.rule,
        name: args.name,
        enabled: !!args.enabled,
    };
    if (args.description !== undefined) body.description = args.description;
    if (args.config !== undefined) body.config = args.config;
    await createAlarmRule(body, { user: args.user });
    return {
        content: [{ type: 'text', text: `Created alarm rule "${args.rule}".` }],
        isError: false,
    };
}

async function toolAlarmRuleDelete(args) {
    if (!args.rule) throw inputError('rule is required');
    await deleteAlarmRule(args.rule, { user: args.user });
    return {
        content: [{ type: 'text', text: `Deleted alarm rule "${args.rule}".` }],
        isError: false,
    };
}

// Description boilerplate shared by every tool that takes a state string.
const STATE_DESC = `Alarm state, accepted as label or number: "active" (1), "ack" (2), "latched" (3), "shelved" (4), "cleared" (5). Numbers also accepted.`;
const SEVERITY_DESC = `Alarm severity, accepted as label or number: "low" (1), "medium" (2), "high" (3), "critical" (4). Numbers also accepted.`;

export const tools = [
    {
        name: 'alarm_instances',
        description: `List active alarm instances across the fleet. Returns one row per instance with state, severity, instance id, originating rule, the device it fired on, and age. Filter by \`state\`, \`severity\` (single value or array), or \`name\` substring. By default the server returns up to 100 instances sorted state-asc, severity-desc, created-desc — use \`count\`/\`index\` to paginate. Use this first when triaging alerts; pair with {tool:alarm_instance_get} for full evaluation/notification details and {tool:alarm_instance_update} to acknowledge or shelve.`,
        inputSchema: {
            type: 'object',
            properties: {
                state: {
                    description: `Filter by ${STATE_DESC} Pass an array to combine ("active" + "ack").`,
                    oneOf: [
                        { type: 'string' },
                        { type: 'number' },
                        { type: 'array', items: { type: ['string', 'number'] } },
                    ],
                },
                severity: {
                    description: `Filter by ${SEVERITY_DESC} Pass an array to combine.`,
                    oneOf: [
                        { type: 'string' },
                        { type: 'number' },
                        { type: 'array', items: { type: ['string', 'number'] } },
                    ],
                },
                name: {
                    type: 'string',
                    description: 'Server-side regex matched against the instance name.',
                },
                count: {
                    type: 'number',
                    description: 'Page size (default 100).',
                },
                index: {
                    type: 'number',
                    description: 'Page offset (default 0).',
                },
                sort: { type: 'string', description: 'Field to sort by.' },
                order: { type: 'string', description: '"asc" or "desc".' },
                user: { type: 'string', description: 'API user (admin impersonation).' },
            },
            required: [],
        },
        handler: toolAlarmInstances,
    },
    {
        name: 'alarm_instance_stats',
        description:
            'Return counts of alarm instances grouped by state ({ activated, acknowledged, latched, shelved, cleared, none }). Use this to get a high-level health summary without pulling every instance.',
        inputSchema: {
            type: 'object',
            properties: {
                user: { type: 'string', description: 'API user.' },
            },
            required: [],
        },
        handler: toolAlarmInstanceStats,
    },
    {
        name: 'alarm_instance_get',
        description:
            'Fetch the full document for a single alarm instance, including evaluation values, notification history, annotation, and reactivation schedule. Use after {tool:alarm_instances} to drill into a specific alert.',
        inputSchema: {
            type: 'object',
            properties: {
                instance: { type: 'string', description: 'Instance ID.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['instance'],
        },
        handler: toolAlarmInstanceGet,
    },
    {
        name: 'alarm_instance_update',
        description: `Modify an active alarm instance. Common operations:

- Acknowledge: { state: "ack" } — the alert is muted but stays visible until cleared.
- Shelve (silence temporarily): { state: "shelved", reactivation_minutes: 60 } — the rule is paused for that timespan.
- Clear (mark resolved): { state: "cleared" }. Cleared alarms cannot be reactivated.
- Annotate: { annotation: "investigated, false positive" } — adds a note visible in the UI.

Pass any combination of fields. The backend rejects re-activating a cleared alarm. \`reactivation_minutes\` is a convenience that maps to the server's reactivation timespan; pass 0 to remove the schedule. For lower-level control pass \`reactivation\` as a raw object ({ type, timespan: { magnitude, value } }).`,
        inputSchema: {
            type: 'object',
            properties: {
                instance: { type: 'string', description: 'Instance ID.' },
                state: {
                    description: STATE_DESC,
                    oneOf: [{ type: 'string' }, { type: 'number' }],
                },
                annotation: {
                    type: 'string',
                    description: 'Free-form note (max 512 chars). Visible in the dashboard.',
                },
                reactivation_minutes: {
                    type: 'number',
                    description:
                        'Schedule the rule to reactivate after N minutes. 0 cancels any pending reactivation. Convenience wrapper over the raw `reactivation` object.',
                },
                reactivation: {
                    type: 'object',
                    description:
                        'Raw reactivation object: { type: "none"|"timespan", timespan: { value, magnitude: "second"|"minute"|"hour"|"day"|"week"|"month"|"year" } }. Prefer reactivation_minutes for the common case.',
                },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['instance'],
        },
        handler: toolAlarmInstanceUpdate,
    },
    {
        name: 'alarm_instance_delete',
        description:
            'Permanently delete an alarm instance from history. Prefer {tool:alarm_instance_update} with state="cleared" for normal lifecycle handling — deletion removes the audit trail.',
        inputSchema: {
            type: 'object',
            properties: {
                instance: { type: 'string', description: 'Instance ID.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['instance'],
        },
        handler: toolAlarmInstanceDelete,
    },
    {
        name: 'alarm_rules',
        description:
            'List configured alarm rules with their enabled flag and description. Each row is one rule (the template that creates instances when its conditions fire). Use {tool:alarm_rule_read} to see the full configuration of a single rule.',
        inputSchema: {
            type: 'object',
            properties: {
                user: { type: 'string', description: 'API user.' },
            },
            required: [],
        },
        handler: toolAlarmRules,
    },
    {
        name: 'alarm_rule_read',
        description:
            'Read the full configuration of a single alarm rule (activation conditions, data sources, severity, notifications, reminder, normalization). Returns the document as stored in the database — feed it back to {tool:alarm_rule_write} to clone or edit.',
        inputSchema: {
            type: 'object',
            properties: {
                rule: { type: 'string', description: 'Rule ID.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['rule'],
        },
        handler: toolAlarmRuleRead,
    },
    {
        name: 'alarm_rule_write',
        description: `Create or update an alarm rule. The tool first checks whether the rule exists: if missing it issues a CREATE (\`name\` and \`enabled\` are required); if present it issues an UPDATE with only the supplied fields. The \`config\` block carries the activation conditions, data sources, severity, normalization, reminder and notifications — its shape mirrors the backend's alarm_rule schema. To copy an existing rule, read it with {tool:alarm_rule_read}, change \`rule\`, and pass the rest back here.`,
        inputSchema: {
            type: 'object',
            properties: {
                rule: {
                    type: 'string',
                    description: 'Stable rule ID. Cannot be changed after creation.',
                },
                name: { type: 'string', description: 'Display name (required on create).' },
                description: { type: 'string', description: 'Free-form description.' },
                enabled: {
                    type: 'boolean',
                    description:
                        'Whether the rule is active. Required on create. On update, omit to keep the current value.',
                },
                config: {
                    type: 'object',
                    description:
                        'Rule configuration: activation, normalization, data sources, severity, reminder, check_interval, notifications. Pass the full object as returned by {tool:alarm_rule_read}.',
                },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['rule'],
        },
        handler: toolAlarmRuleWrite,
    },
    {
        name: 'alarm_rule_delete',
        description:
            'Delete an alarm rule. Active instances generated from the rule are stopped immediately, but historical instances stay in the database.',
        inputSchema: {
            type: 'object',
            properties: {
                rule: { type: 'string', description: 'Rule ID.' },
                user: { type: 'string', description: 'API user.' },
            },
            required: ['rule'],
        },
        handler: toolAlarmRuleDelete,
    },
];

// Re-export for tests / consumers that want to know which states are
// considered "active" (everything except cleared).
export const ALARM_NON_CLEARED_STATES = [
    ALARM_STATE.NONE,
    ALARM_STATE.ACTIVATED,
    ALARM_STATE.ACKNOWLEDGED,
    ALARM_STATE.LATCHED,
    ALARM_STATE.SHELVED,
];
