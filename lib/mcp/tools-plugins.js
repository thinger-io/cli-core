// @ts-check
import api from '../api.js';
import { apiError, inputError } from '../errors.js';
import { pluginApi } from '../paths.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Call the API a plugin serves (its routes are its own: no catalog). */
async function toolPluginCall(args) {
    if (!args.plugin) throw inputError('plugin is required');
    const method = (args.method || 'get').toLowerCase();
    if (!METHODS.includes(method)) throw inputError(`method must be one of ${METHODS.join(', ')}`);
    const path = args.path ? `/${String(args.path).replace(/^\/+/, '')}` : '';
    if (path.split('/').includes('..')) throw inputError('path must not contain ".."');
    try {
        const res = await api.request({
            method,
            url: `${pluginApi(args.user, args.plugin)}${path}`,
            data: method === 'get' || method === 'delete' ? undefined : (args.body ?? {}),
            params: args.query,
            paramsSerializer: { indexes: null },
            transformResponse: [(x) => x],
            responseType: 'text',
        });
        const raw = String(res.data ?? '');
        let text = raw;
        try {
            text = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {}
        return {
            content: [{ type: 'text', text: text || `${res.status} (no content)` }],
            isError: false,
        };
    } catch (e) {
        throw apiError(e, { notFound: `Not found: plugin ${args.plugin}${path}` });
    }
}

export const tools = [
    {
        name: 'plugin_call',
        description:
            'Call the API an installed plugin serves, at its own `path` (what it offers depends on the plugin; see its documentation or try GET on its root). Find plugins with {tool:resource_list} type "plugin".',
        inputSchema: {
            type: 'object',
            properties: {
                plugin: { type: 'string', description: 'Plugin id.' },
                path: {
                    type: 'string',
                    description: 'Path inside the plugin, e.g. "/api/status".',
                },
                method: { type: 'string', enum: METHODS, description: 'Default get.' },
                body: { description: 'JSON body for post / put / patch.' },
                query: { type: 'object', description: 'Query parameters.' },
                user: { type: 'string', description: 'Account to act on (admin only).' },
            },
            required: ['plugin'],
        },
        handler: toolPluginCall,
    },
];
