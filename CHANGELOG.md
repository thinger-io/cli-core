# Changelog

## [0.2.0] - 2026-10-10

Incompatible change of the MCP tools: from 48 tools, one per type and
operation, to 23, about a third of the size in `tools/list` (19,500
characters instead of 51,400, roughly 5,400 tokens instead of 14,300).

### Added

- Seven generic tools over a catalog of the server's resource types:
  `resource_describe`, `resource_list`, `resource_get`, `resource_create`,
  `resource_update` (`merge: true` patches property values; `projects` in
  the body sets the resource's projects), `resource_delete`,
  `resource_clone`. The catalog (`mcp/catalog.js`) covers devices,
  products, buckets, dashboards, endpoints, storages, asset types and
  groups, projects, tokens, alarm rules and instances, claims, account
  properties and their children (device properties, tokens, buckets, bucket
  tags, services and HTTP callback; product properties, profile entries,
  code and services; bucket tags and exports; asset type, asset group and
  project properties). Each tool offers only the types that support its
  verb.
- `resource_describe` reads the request schemas and examples from the
  server's own OpenAPI document (`/v1/server/swagger.json`), cached per
  server and version in `~/.config/<cli>/cache`; servers that do not publish
  it fall back to the bundled copy (`openapi/swagger.json`, server
  7.2.4-beta).
- Admin mode (`mcp --admin`, `<PREFIX>_MCP_ADMIN=1`): roles, syncs, project
  members and project roles.
- Resource hooks: generated device credentials, the identity's product
  template, token expiries as durations ("30d") and permission tree checks.
  CLIs add theirs with `runCli({ resourceHooks })`.
- Tools that are not CRUD: `bucket_data_read`, `bucket_data_write`,
  `device_resource_list`, `device_resource_call`, `device_data_send`,
  `device_stats`, `device_overview`, `product_resource_call`,
  `product_export`, `endpoint_call`, `alarm_rule_test`,
  `storage_file_list` / `_read` / `_write` / `_delete`.
- `scripts/catalog-draft.js`: drafts catalog entries from an OpenAPI
  document.

### Changed

- `profiles` is now `profile_list`; `bucket_read` is `bucket_data_read`;
  `resource_list` / `resource_call` (device resources) are
  `device_resource_list` / `device_resource_call`.
- `buildTools(extraTools, { admin, hooks })`; `genericTools` is now a
  function of the same options.

### Removed

- The per-type tools, replaced by `resource_*` on the matching type:
  `devices`, `device_info`, `device_create`, `device_set_product`,
  `device_delete`, `products`, `product_create`, `product_update`,
  `product_delete`, `product_property_*`, `product_profile_*`,
  `property_get`, `property_set`, `token_*`, `device_token_*`,
  `alarm_rules`, `alarm_rule_*`, `alarm_instances`, `alarm_instance_*`,
  `buckets`.

## [0.1.1] - 2026-10-10

### Fixed

- `repository.url` in the canonical `git+https` form npm expects; first release
  published from GitHub Actions through Trusted Publishing.

## [0.1.0] - 2026-10-10

First version, extracted from the core of `thinr` 1.3.5 and made
independent of the product.

### Added

- CLI identity (`defineIdentity`): name, config folder, environment prefix,
  login token, OAuth client, MCP server name and tool prefix, product
  template.
- `runCli` with the generic commands (login, logout, profile, device, product,
  bucket, mcp) and extension points: `register` with the command groups,
  `onNoCommand`, `mcpTools`, `mcpInstructions`.
- MCP tools declared with bare names and `{tool:x}` / `{family:x}`
  references, expanded and validated when the server starts; CLI tools can
  replace generic ones explicitly (`replaces: true`).
- `device create` / `device_create`, `bucket list` / `buckets`.

### Changed (compared with thinr 1.3.5)

- The API base URL and token come from the profile active for each request,
  and the MCP `profile` argument is scoped per call (AsyncLocalStorage).
- Servers may carry a scheme (`http://localhost:8080`); profiles are named
  after the host.
- `logout` forgets the current profile (or `--all`) and revokes the API token
  the CLI minted, instead of deleting every profile.
- Login works without prompts (`--server --username --token`) and fails with
  a clear message when a prompt has no terminal.
- The config file is written with mode 600.
- Server error messages are kept in the errors shown to the user.
