# Thinger server administration

For agents acting as a server **admin**: host settings, domains and brands, user accounts,
OAuth clients, identity providers and proxies. Every route here needs an admin session or
token. Read the OpenAPI document for each body; this guide covers what the schemas cannot say:
order of steps, side effects and risks. It describes Thinger 7.5; what needs a later version says
"since Thinger X" (a server's version: `GET /v1/server/version`).

Before changing anything, read the current value and tell the user what will change. Several
actions here can take the server or a domain offline.

## Hosts and server settings

A host is one server process; its id is the machine's hostname (`GET /v1/hosts`).

- `GET /v1/hosts/{host}/settings` returns the editable settings (database, plugins and similar
  internals are hidden).
- `PUT /v1/hosts/{host}/settings` is a **merge patch** (RFC 7386) over the host's custom
  settings: send only the sections you change; `null` removes a custom value, so the provider
  default applies again. Values are validated against the schema.
- **Settings apply only after a restart**: `POST /v1/hosts/{host}/restart`. The process exits
  and the container restarts it: every connection drops (devices, consoles, websockets) for a
  few seconds or more. Ask the user before restarting, and prefer a quiet moment.
- Ports are **strings** (`"1883"`), as the server reads them.
- Logs: `GET /v1/hosts/{host}/logs?lines=200` returns the last lines as text; the same route
  over a websocket streams them live.

Main sections: `http_server`, `thing_server` (IOTMP), `mqtt_server`, `proxies` (dynamic port
range), `email` (server mail: `smtp` or `ses`), `buckets.storage` / `buckets.export`, `ssl`,
`accounts` (sign-up, login methods, password rules, `limits.<collection>.max_count` with -1 =
unlimited and 0 = disabled), `deployment` (`contact_email`: whoever registers with it becomes
admin), `scripting_engine`.

Some features are off by default (`max_count` 0): projects, project members, domains, brands and
identity providers. On Thinger cloud instances the subscription plan sets these limits; on a
self-hosted server raise `accounts.limits.<collection>.max_count` (`projects`,
`projects_members`, `domains`, `brands`, `identity_providers`) and restart. The domains and
brands limits are not shown by `GET settings`.

On cloud instances the plan owns `accounts.limits.{accounts,brands,domains,members}`, `database`,
`plugins`, `rate_limiter` and `http_server.hosts`: since Thinger 7.5, writing them returns 403.
To raise them, the customer changes the plan.

## Custom domain with its own brand

A **brand** is the look and login behaviour of the console for one hostname. Its id **is** the
hostname (`console.example.com`); there is no other link between a domain and a brand. The
**domain** resource only manages the TLS certificate of that hostname.

1. **DNS (done by the user).** Make the hostname resolve to this server: an `A` / `AAAA` record
   with the server's public IP, or a `CNAME` to the server's existing hostname (the one the user
   already uses to reach the console). There is no special verification value or TXT record.
   Port **80** must be reachable from the internet. Tell the user exactly which record to
   create, then wait until it resolves (it can take minutes; up to the record's TTL).
2. **Create the domain**: `POST /v1/domains` `{ "domain": "console.example.com" }`. No side
   effects yet.
3. **Verify**: `POST /v1/domains/{domain}/verify`. The server asks Let's Encrypt for a
   certificate (HTTP-01: Let's Encrypt fetches `http://<domain>/.well-known/acme-challenge/...`
   from this server). On failure the error carries Let's Encrypt's reason (DNS not found,
   connection refused, rate limit…): report it to the user as is. A certificate with more than
   30 days left counts as verified. Wildcards (`*.example.com`) use DNS-01 and only work on
   instances hosted by Thinger.
4. **Create the brand**: `POST /v1/brands` `{ "brand": "console.example.com", "name": ..., "config": {...} }`.
5. **Configure it**: texts, logos, colors, login page, PWA, account options (`config`), and its
   email (`email`). See below.
6. Open `https://console.example.com` to check.

Certificates renew automatically (daily check, 30 days before expiry). If the DNS record is
later changed or removed, renewal fails silently and HTTPS breaks when the current certificate
expires. Deleting a domain removes its certificate at once.

Local or development builds may use Let's Encrypt **staging**, whose certificates browsers do not
trust: verification "works" but the site shows a warning.

### Brand configuration

- `PUT /v1/brands/{brand}` **replaces** `config` and `email` as a whole, and deletes the logo
  files missing from the new `config`. Use it only with the full object.
- `PATCH /v1/brands/{brand}` **merges** into the stored ones (`null` removes a key). Prefer it:
  `{ "config": { "title": "Acme IoT" } }` changes only the title.
- Logos and icons (`favicon`, `share_image`, `dark_logo` for login and exports, `bright_logo`
  for the menu, `icon` for the folded menu, `pwa.icons[].src`) are sent as **data URLs**
  (`data:image/png;base64,...` or webp). The server stores the file and keeps a
  `/brand/images/...` URL. Sending that URL back keeps the image; `null` or `""` deletes it.
- `config.accounts` overrides the server's account settings for this hostname: public sign-up
  (and its role), password / passkey login, 2FA, `cross_sign_in` (false: only users registered
  on this hostname can log in), reCAPTCHA (`no_robot`), federated login and its identity
  providers.
- The brand is readable without login (login pages need it); secrets in it are only returned to
  admins.

### Brand email

`email.custom: true` with `email.settings` makes this brand send its emails (account
verification, password reset, account creation, device disabled) through its own server:
`type: "smtp"` with `smtp.host`, `smtp.port` (string), `username`, `password`, `secure` (true
for implicit TLS, e.g. 465; otherwise STARTTLS), or `type: "ses"` with AWS keys and region.
`settings.from` / `from_name` are the sender. `email.templates.<name>` can override `subject`
and `body` (HTML). Start from the defaults (`GET /v1/brands/{brand}/email` returns them) and keep
their links:

| Template | Link in the body |
|---|---|
| `email_verification` | `{{host_url}}/verify_email?code={{code}}` |
| `forgot_password` | `{{host_url}}/password?code={{code}}` |
| `create_password` | `{{host_url}}/create_password?code={{code}}` |
| `device_disabled` | (no link; `{{device}}` is the device) |

Placeholders filled when sending: `{{code}}`, `{{user}}`, `{{email}}`, `{{host}}`, `{{admin}}`
(server contact email), `{{host_url}}`. `{{name}}`, `{{url}}`, `{{logo}}` and `{{description}}`
only exist in the built-in defaults: in a custom template write the brand name and the logo URL
(`https://<brand>/brand/images/dark_logo.png`) directly. Email clients do not load `data:` images,
so use that public URL. The `enabled` flag of a template is not enforced yet.

`POST /v1/brands/{brand}/email/test` `{ "template": "email_verification" }` sends that template to
the **calling admin's** email address with the **saved** settings: save first, then test.

## User accounts

`POST /v1/users` creates an account; `role` is `user`, `member` (only inside projects, needs a
default project), `domain_admin` (admin of the hostnames in its `host` list) or `admin`. Only
admins create admins. An empty password sends the "create password" email instead. Per-user
`limits` override the server limits. Deleting a user deletes **all** its resources (devices,
buckets, plugins, files): confirm explicitly.

## OAuth clients

Applications that log users in with this server (authorization code or device flow).
`redirect_uri` is a **newline-separated** list of exact URLs. The `secret` is stored and returned
in plain text to admins: handle it as a credential. `enabled: false` blocks the client.

## Identity providers (log in with Google, Microsoft…)

OIDC providers users can log in with.

1. Allow them: `accounts.limits.identity_providers.max_count` in the host settings (0 by
   default), then restart.
2. Register this server in the provider: callback URL `https://<brand or console host>/oauth/callback`.
3. Create the provider with its `domain` (issuer), `client_id`, `client_secret`, provisioning
   (`auto_provision` creates accounts, `match_only` only links existing ones; `allowed_domains`
   limits email domains) and `email_trust_mode`.
4. Test it: `POST /v1/identity_providers/{id}/test` checks discovery and keys.
5. Turn on `federated_login` (host `accounts` or the brand's `config.accounts`) and optionally
   restrict `identity_providers` to some ids.

Auto-provisioning creates accounts even when public sign-up is off.

## Proxies

Expose a TCP / UDP service, a plugin, or a device service through this server.

- Created and updated proxies start or replace a **live listener** at once; deleting one closes
  the port. A wrong port can collide with other services.
- `source.routing: "subdomain"` serves `https://<proxy id>.<server hostname>` and needs a
  wildcard certificate for that hostname.
- Send the full `config` on update: a partial one works until the next restart and then breaks.

## Safety checklist

- Read before write; describe the change; keep the previous value to undo it.
- Never restart, delete a domain, delete a user or change login settings without the user's
  explicit confirmation.
- Changing `accounts` login options (password, 2FA, cross sign-in, sign-up) can lock users out:
  make sure an admin can still log in.
- Do not echo secrets (SMTP passwords, client secrets, AWS keys) back to the user unless asked.
