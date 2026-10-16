# Product code

JavaScript that a product's profile calls to compute, transform or route data for its devices:
resource values (including simulated devices), payload transforms, the device a product call is
for. Platform concepts: the document `concepts`. It describes Thinger 7.5; what needs a later
version says "since Thinger X" (a server's version: `GET /v1/server/version`).

## Where it lives

`PUT /v1/users/{user}/products/{product}/profile/code` with
`{ "code": "<JavaScript>", "storage": "" }`, or `{ "storage": "<storage id>" }` to load
`<storage>/index.js` from a file storage (with its `node_modules`). Since Thinger 7.5, add
`"path": "<folder>"` to
load `<storage>/<folder>/index.js` (and that folder's `node_modules`) instead: one storage can then
hold a whole application, e.g. the dashboard in `app/` and each product's code in
`code/<product>/`. Read it back with `GET` on the same path.

The code takes effect at once: every change to the profile (code, any category or entry, or
enabling the product) reloads it. Editing `index.js` in the storage does **not**: `PUT
profile/code` again afterwards.

## Runtime

- Node.js embedded in the server, one instance per product.
- Functions are found by name as globals: declare them with `function name(…) {}` (or
  `var name = …`, `globalThis.name = …`). Top-level `const` / `let` / `class` names and
  `module.exports` are not visible to the profile.
- **Synchronous only.** There is no event loop: promises, `async` functions, timers, `fetch` and
  network modules never complete (an `async` function returns `{}`). Synchronous built-ins
  (`Math`, `Date`, `JSON`, `require('crypto')`…) work.
- `Date` runs in **UTC** (`getHours()` is the UTC hour). For local time use `Intl`, which knows
  time zones and daylight saving:
  `new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date())`
  gives the hour in Madrid.
- Return JSON values: objects, arrays, numbers, strings, booleans. A `Date` or other class
  instance becomes `{}`: return `Date.now()` (milliseconds) instead.
- A function that throws returns `null`. There is no time limit: keep functions short.
- No access to the filesystem except reading user storages, no processes, no environment.
- The code cannot call Thinger directly (no API object). It talks to the platform only through
  the profile: placeholders bring data in, targets send results out (below).

`console.log` / `info` / `warn` / `error` are sent as `product_script_log` events while someone
listens: the product's console in the web console, or the websocket
`/v1/users/{user}/products/{product}/profile/console`.

## Where functions are called

A function receives one argument (two for `device_id_resolver`) and returns the new value.

| Hook | Config | Receives | Returns |
|---|---|---|---|
| API resource, request target `function` | `api.<r>.request.data` `{ "target": "function", "function": "<name>" }` | the request payload, shaped by `payload_type` (below) | the resource result (with response `source: "request_response"`) |
| API resource, response source `function` | `api.<r>.response.data` `{ "source": "function", "function": "<name>" }` | `{ user, device, resource, product }` | the resource result |
| Payload transform | `payload_function: "<name>"` in a request, response, bucket, property or flow `data` | the payload after `payload_type` | the new payload (an empty result skips a bucket / property write or a flow) |
| Device of a product call | `device_id_resolver: "<name>"` at the root of an API resource or flow | `(payload, placeholders)` | a device id (string) |
| Placeholder converter | `{{<placeholder>:<name>}}` inside any template | the placeholder value | the replacement |

`payload_type` decides what a function or target gets:

- `template_payload` (default): the `payload` template with placeholders filled, parsed as JSON.
  Without a `payload` it is empty, so a bucket or property entry writes nothing.
- `source_payload`: the incoming value as is (in a response, the target's result); the same as
  `"payload": "{{payload}}"`.
- `source_event`: everything: `{ user, device, resource, product, payload }`.
- `none`: nothing.

Placeholders available in templates: `{{device}}`, `{{user}}`, `{{product}}`, `{{resource}}`,
`{{payload}}` / `{{payload.<field>}}`, `{{property.<id>}}` (a device property's value, inherited
like any device property: device → asset type → asset group → product, the first that defines it,
whole value),
`{{meta.<field>}}` (a field of the device document), `{{api.<resource>}}` (another API resource),
and `{{x=default}}` for defaults.

## Resources computed by code

An API resource whose request target is a function makes a value out of nothing: the basis of
simulated devices.

```json
"api": {
  "climate": {
    "enabled": true,
    "request":  { "data": { "target": "function", "function": "simulateClimate", "payload_type": "source_event" } },
    "response": { "data": { "source": "request_response", "payload_type": "source_payload" } }
  }
}
```

```js
// ctx = { user, device, resource, product, payload }
function simulateClimate(ctx) {
  var day = Math.sin(((Date.now() / 3600000) % 24 - 6) / 24 * 2 * Math.PI);  // day/night cycle
  return {
    temperature: Math.round((22 + 6 * day + (Math.random() - 0.5)) * 10) / 10,
    humidity: Math.round((60 - 15 * day + (Math.random() - 0.5) * 4) * 10) / 10
  };
}
```

`GET /v3/users/{user}/devices/{device}/resources/climate` then returns the object for any device
of the product, including `Virtual` devices, which have no hardware and get every resource from
their product. A profile bucket or property with `source: "resource"` and an interval calls the
resource for every connected device of the product on that schedule (see
the document `concepts`, Buckets).

Without `"response": { "source": "request_response" }` the function runs but the resource
returns nothing; without `payload_type: "source_payload"` (or `"payload": "{{payload}}"`) in the
response, it returns `null`.

## State between calls

- **In memory**: globals survive between calls of the same product, so
  `globalThis.state = globalThis.state || {}; state[ctx.device] = …` keeps per-device state.
  It is lost when the profile reloads (any profile change) and when the server restarts. Code
  that keeps "what happened since the last call" in memory starts over after each reload: it can
  repeat or skip one step (e.g. emit an event twice). Keep that cursor in a property if it matters.
- **Persistent**: keep the state in a device property. Read it with `{{property.<id>}}` in the
  request payload template and write the function's result back with request target
  `property`:

```json
"api": {
  "tank": {
    "enabled": true,
    "request": { "data": {
      "target": "property", "property": "tank",
      "payload": "{\"prev\": {{property.tank}}, \"in\": {{payload}} }",
      "payload_function": "stepTank" } },
    "response": { "data": { "source": "request_response", "payload_type": "source_payload" } }
  }
}
```

```js
// p = { prev: <last tank property or {}>, in: <input sent to the resource or null> }
function stepTank(p) {
  var s = typeof p.prev.level === 'number' ? p.prev : { level: 50, inflow: 1, outflow: 0.8, ts: Date.now() };
  var now = Date.now(), minutes = (now - s.ts) / 60000;
  var inflow = p.in && p.in.inflow !== undefined ? p.in.inflow : s.inflow;
  var outflow = p.in && p.in.outflow !== undefined ? p.in.outflow : s.outflow;
  var level = Math.min(100, Math.max(0, s.level + (inflow - outflow) * minutes));
  return { level: level, inflow: inflow, outflow: outflow, ts: now };   // saved as property "tank"
}
```

Each call advances the level from the stored state; calling the resource with
`{ "inflow": 3 }` changes the flow. Do not combine it with a `{{payload=property.tank}}`
default: defaults that read a property re-run the resource when that property changes, and this
resource writes it.

## Limits and pitfalls

- No asynchronous work and no outgoing requests from code: to call an external service use an
  endpoint (request target `endpoint_call`).
- One argument per function (two for `device_id_resolver`); use `payload_type: "source_event"`
  to get the device id and the rest of the context.
- Keep per-call work small: functions run synchronously in the server, without a timeout.
- A product must be `enabled`, and every API / bucket / property / flow entry needs
  `"enabled": true`, or it is skipped.
