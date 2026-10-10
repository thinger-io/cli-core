# Changelog

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
