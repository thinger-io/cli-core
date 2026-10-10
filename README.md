# @thinger-io/cli-core

The shared core of the CLIs built on Thinger.io servers — `thinger`
([@thinger-io/thinger-cli](https://github.com/thinger-io/thinger-cli)) and
ThinRemote's `thinr` — and of the MCP servers they expose.

It holds everything that is not specific to a product:

- **API client** (`api`) — axios with the active profile's server and token on
  every request, refresh on 401, self-signed TLS for localhost.
- **Auth** (`auth`) — username/password (mints a permanent API token),
  pasted token, OAuth device flow; interactive or fully non-interactive.
- **Profiles** (`config`) — several servers per CLI, selected by `--profile`,
  `<PREFIX>_PROFILE` or the saved default, and scoped per call
  (`withActiveProfile`) so concurrent MCP calls don't mix servers.
- **REST helpers** — `devices`, `property`, `resource`, `bucket`, `product`,
  `profile` (product profiles), `tokens`, `alarms`, `storage`, with every
  account path built in `paths`.
- **Generic commands** (`cli`, `commands/*`) — login, logout, profile, device,
  product, bucket, mcp.
- **MCP** (`mcp/*`) — the stdio server and 25 generic tools: seven
  `resource_*` tools over a catalog of the server's resource types, and the
  operations that are not CRUD (bucket data, device resources, storage
  files, dashboard publishing, the server's documentation…), plus that
  documentation as MCP resources.
- **OpenAPI** (`openapi`) — the server's own API description, cached per
  server and version, with a bundled copy as fallback.

## Identity

The core knows nothing about the product it runs for. A CLI defines its
identity once, before anything else, and runs:

```js
import { defineIdentity } from '@thinger-io/cli-core/identity';
import { runCli } from '@thinger-io/cli-core/cli';

defineIdentity({
    name: 'acme', // binary name, used in hints
    displayName: 'Acme IoT',
    description: 'CLI for Acme IoT servers',
    configDir: 'acme-cli', // ~/.config/acme-cli/config.json
    envPrefix: 'ACME', // ACME_PROFILE, ACME_INSECURE
    token: { id: 'acme_cli', name: 'Acme CLI' }, // minted by the password login
    oauth: { clientId: null }, // OAuth device-flow client, if the platform ships one
    defaultServer: null, // suggested by the login prompt
    mcp: { serverName: 'acme', toolPrefix: 'acme' }, // tools become acme_resource_list, …
    productTemplate: {}, // optional defaults for new products
});

await runCli({ version: '1.0.0' });
```

Each CLI keeps its own profiles, environment variables and MCP tool names,
so two of them can run side by side without one operating on the other's
servers.

## Extending

`runCli` takes:

- `register(program, { device, product, bucket })` — add top-level commands,
  or subcommands inside the generic groups.
- `onNoCommand(program)` — what to do when called without arguments
  (default: help).
- `mcpTools` — the CLI's own MCP tools, declared with bare names
  (`name: 'device_exec'`) and referring to others in descriptions as
  `{tool:resource_list}` or `{family:storage_file}`. Unknown references fail
  at startup. A tool flagged `replaces: true` swaps out the generic tool of
  the same name.
- `resourceHooks` — the CLI's hooks on catalog types (`{ product: {
afterDelete } }`), run after the core's: see `mcp/resource-hooks.js`.
- `mcpInstructions` — server-level guidance sent to MCP clients.

`<cli> mcp --admin` (or `<PREFIX>_MCP_ADMIN=1`) also serves the
administration types: roles, syncs, project members and project roles.

## MCP tools

Tool names follow `<object>[_<subobject>]_<verb>`, with the verbs list, get,
describe, create, update, delete, clone, call, read, write, send.

The server's collections are reached through seven generic tools —
`resource_describe`, `resource_list`, `resource_get`, `resource_create`,
`resource_update`, `resource_delete`, `resource_clone` — that take a `type`
from the catalog (`lib/mcp/catalog.js`), a `parent` for child types and an
`id`. The catalog is a reviewed table, never discovered at run time: each
type has its path, API version, parent, id and the verbs it allows, with the
server's operationId for each (the tests check them against the bundled
OpenAPI document). `resource_describe` reads the request schemas and
examples from the OpenAPI document of the server the profile points at.

To draft catalog entries after an API change:

```bash
curl -s https://<server>/v1/server/swagger.json -o openapi/swagger.json
node scripts/catalog-draft.js
```

Modules are imported by path: `@thinger-io/cli-core/api`,
`@thinger-io/cli-core/mcp/registry`, …

## Development

```bash
npm install
npm test           # under a made-up "acme" identity
npm run lint
npm run typecheck
```

## License

MIT
