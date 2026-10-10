// @ts-check
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { classifyError } from '../output.js';
import { identity } from '../identity.js';
import { buildTools, listResources, readResource } from './registry.js';
import { withProfile } from './helpers.js';

/**
 * Start the MCP server over stdio. Serves the generic tools plus the ones
 * the CLI adds; every tool takes an optional `profile` (and `user`, for
 * admin impersonation, where it applies).
 *
 * stdout is the protocol channel from here on: diagnostics go to stderr.
 *
 * @param {{
 *   version?: string,
 *   tools?: Array<object>,
 *   instructions?: string,
 *   admin?: boolean,
 *   resourceHooks?: Record<string, import('./resource-hooks.js').ResourceHooks>,
 * }} [opts]
 *   `version` is echoed in the `initialize` response's `serverInfo.version`;
 *   callers pass their `package.json#version` so the two never drift.
 *   `tools` are CLI-specific tools added to the generic set.
 *   `instructions` is the server-level guidance sent to the client.
 *   `admin` also serves the administration types of the catalog.
 *   `resourceHooks` are the CLI's hooks on catalog types.
 */
export async function startMCPServer({
    version = 'unknown',
    tools: extra = [],
    instructions,
    admin = false,
    resourceHooks,
} = {}) {
    const { mcp } = identity();
    const tools = buildTools(extra, { admin, hooks: resourceHooks });

    const server = new Server(
        {
            name: mcp.serverName,
            version,
        },
        {
            capabilities: { tools: {}, resources: {} },
            ...(instructions ? { instructions } : {}),
        },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.map(({ handler: _handler, ...t }) => t),
    }));

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: await listResources(),
    }));

    // Resources are read with the default profile: the protocol gives them
    // no arguments to pick another.
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const { uri } = request.params;
        const { mimeType, text } = await readResource(uri);
        return { contents: [{ uri, mimeType, text }] };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const name = request.params.name;
        const args = request.params.arguments || {};
        const tool = tools.find((t) => t.name === name);
        if (!tool) {
            return {
                content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                isError: true,
            };
        }
        try {
            return await withProfile(args.profile, () => tool.handler(args));
        } catch (error) {
            // Surface the same {message, code} pair the CLI emits in JSON
            // mode so MCP clients can pattern-match on `[code]` instead of
            // doing fuzzy matches on the human message.
            const { message, code } = classifyError(error);
            return {
                content: [{ type: 'text', text: `Error [${code}]: ${message}` }],
                isError: true,
                _meta: { code, message },
            };
        }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[${mcp.serverName}-mcp] Server started`);
}
