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
- **MCP** (`mcp/*`) — the stdio server and ~50 generic tools.

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
    mcp: { serverName: 'acme', toolPrefix: 'acme' }, // tools become acme_devices, …
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
  (`name: 'exec'`) and referring to others in descriptions as
  `{tool:devices}` or `{family:token}`. Unknown references fail at startup.
  A tool flagged `replaces: true` swaps out the generic tool of the same name.
- `mcpInstructions` — server-level guidance sent to MCP clients.

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
