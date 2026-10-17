# Thinger concepts

How a Thinger.io account is organized, for agents that create resources, dashboards or
alarms. It describes Thinger 7.4: what needs a later version says "since Thinger X", and what
older servers lack says "since Thinger 7.4" (a server's version: `GET /v1/server/version`).
`GET /v1/server/events` lists the live events; the OpenAPI document lists every route. Related
guides: product code (document `product-code`) and server administration (document
`server-admin`). The dashboard SDK is the npm package `@thinger-io/dashboard-sdk`, documented in
its README (document `dashboard-sdk`).

## The account and its projects

Everything (devices, buckets, products, dashboards…) belongs to a **user account** and lives
under `/v{1,2,3}/users/<user>/…`.

A **project** groups resources of the account so they can be shared and browsed together:

- A resource belongs to projects through its `project` field, an array of `"<owner>@<project>"`.
  One resource can be in several projects. Devices, products, buckets, dashboards, endpoints,
  storages, access tokens, asset types and groups, alarm rules and instances, plugins, claims
  and syncs can be in projects; properties follow their resource.
- `?project=<id>` on an API call scopes it: creates add the resource to the project, lists only
  return its resources. `PUT <resource path>/projects` with `["<owner>@<project>", …]` sets the
  list, **replacing** the previous one: read it first to add or remove one project.
- **Members** are other users invited to a project, with permissions from their own allow/deny
  plus project and global roles. They call `/v1/users/<owner>/…?project=<id>`; the server
  checks that the target resource is in the project and runs the call as the owner. A member
  can also be limited to some asset groups.
- A project has its own properties. Its `dashboard` property
  (`/v1/users/<owner>/projects/<project>/properties/dashboard`) is the project's home page:
  members land on it when they log in, and the console menu shows it under the project name.
  A member sees only the resources in the project, and only those its permissions allow.
- **Bucket data inside a project** (`config.limit_bucket_access`): a bucket in a project may also
  hold records of devices outside it, typically a product bucket shared by several projects.
  With this option on, every bucket read and tag listing made over the project
  (`?project=`, members, project-scoped tokens and the dashboard SDK) only returns the records
  of the project's devices, and asking for another device is refused. It needs the bucket to
  carry a `device` tag (product buckets do); a bucket without it is not filtered. A project with
  no devices reads such a bucket as empty. It is **on by default for new projects** since Thinger
  7.4 (send
  `config: {limit_bucket_access: false}` to opt out); for older projects, turn it on with
  `PUT /v1/users/<u>/projects/<p>` and `{config: {limit_bucket_access: true}}`, especially before
  sharing a project with members or public tokens.

## Devices

A device is one connected thing. `type` decides how it talks to the platform:

| type | connection | notes |
|---|---|---|
| `Generic` | IOTMP (Thinger client libraries) | has credentials; exposes its own resources |
| `MQTT` | MQTT broker | has credentials; publishes topics |
| `HTTP` | posts JSON to its callback URL | no persistent connection |
| `Virtual` | server-side, connected while enabled | no hardware; every resource comes from its product |
| `Subdevice` | through a parent device (`parent`) | e.g. sensors behind a gateway |

Other fields: `name`, `description`, `product`, `asset_type`, `asset_group`, `labels`
(free key → string map), `enabled`, and `connection` (`active`, `ts`, `location`…).

A device has three kinds of data. Do not mix them up:

- **Resources**: the device's live API (`/v3/…/devices/<d>/resources/<r>`). Reading one asks
  the device right now; calling one runs an action on it. They can be streamed every N
  seconds or on change. They only work while the device is connected. When it is offline,
  `?shadow` returns the last value saved at disconnection. For HTTP, MQTT and Virtual devices,
  resources only exist through their product's API.
- **Properties**: stored JSON values about the device (configuration, state, metadata, a
  `location`). They persist while the device is offline and can be changed from the cloud.
  The `location` property (`{ "lat": 40.41, "lon": -3.70 }`, numbers; `lng`, `latitude` /
  `longitude` and an optional `radius` are also accepted) fixes the device on maps
  (`devices.locations`, `GET /v1/users/<u>/assets/locations`). Devices without it are placed by
  their IP when they connect, which is meaningless for Virtual devices: set `location` on
them to place them on a map.
- **Buckets**: time series. A device does not own buckets; its data is written into buckets.

## Products

A product is a template for a family of devices. A device joins it through its `product`
field, set directly or by **autoprovision**: a device id pattern that creates the device the
first time it connects. The product profile defines for all of its devices:

- `properties`: device properties with defaults, forms and permissions; can also be filled
  from MQTT topics, resource streams or events. An entry with `default.value` (any value but
  `null`: `{}`, `[]`, `""`, `0` and `false` count), `form` or `perm` becomes a property of the
  product, which every device of the product inherits (`source: "product"`) until it sets its own.
- `buckets`: where each device's data is stored. A bucket id containing `{{device}}` gives one
  bucket per device. Otherwise one shared bucket is used, tagged with `device` (and `group`).
  These buckets are created on the first write, have `product=<p>` and are not in any project:
  projects get resources only by explicit assignment. Pick the access by use case:
  - one device (device and product dashboards): read through the device
    (`GET /v2/users/<u>/devices/<d>/buckets/<b>/data`, permission `Device:ReadDeviceBucket`; the
    SDK's `device` option). Access to the device is enough; the bucket stays out of the project.
    Prefer this whenever it covers the need.
  - the whole fleet (project dashboards, aggregates across devices): add the bucket to the project.
- `api`: resources added to every device of the product. They map to topics, device resources,
  properties, functions or endpoint calls, so HTTP and MQTT devices get an API too.
- `flows`: move data from a source (topic, resource, event…) to a sink.
- `code`: JavaScript functions used by the profile: values computed by code, payload
  transforms, `device_id_resolver`… See the document `product-code`.
- `autoprovisions`, and `services` (web / VNC proxies to the device).

`POST /v1/…/products/<p>/resources/<r>` calls a product API resource without naming a device.
It only reaches a device when that resource defines a `device_id_resolver` function.

**API resources** (`profile.api.<resource>`) are what a device of the product can be asked to do.
`request.data.target` says where the call goes:

| target | does | typical use |
|---|---|---|
| `topic` | publishes the payload on an MQTT `topic` (templated, e.g. `shellies/{{device}}/relay/0/command`) | commanding MQTT devices |
| `resource` | calls a resource of the device (firmware) or another API resource | wrapping or renaming device resources |
| `resource_stream` | emits the payload as data of this resource, without a device behind it | data pushed by a plugin or an HTTP callback (e.g. a LoRaWAN `uplink`), consumed by profile buckets / properties with `source: "resource"` |
| `property` | stores the payload in the device property `property` | settings sent from a dashboard; state |
| `function` | runs a function of the product code | values computed by code, simulated devices |
| `endpoint_call` | calls an endpoint (email, webhook…) | notifications, external services |
| `plugin_endpoint` | calls an HTTP path of a plugin (`plugin`, `path`) | network servers, e.g. a LoRaWAN `downlink` |
| `product_stream` | emits a product-level stream | fan-out to the whole product |

`response.data.source` says what the caller gets back: `request_response` (the target's
result), `property`, `resource`, `topic` (waits for a message on a topic), `function` or nothing.
Payloads are templates: `{{payload.port=85}}` reads input with a default, `{{property.x}}`
reads device state, `{{payload:fn}}` converts with a product code function. A product-level call
(`POST /v1/…/products/<p>/resources/<r>`) needs `device_id_resolver` to know the device.

The plugin catalog (`GET /v1/users/<u>/plugins?filter=available`) ships complete products for
real hardware (Shelly, Milesight, Siemens LOGO, LoRaWAN templates…): each manifest has
`resources.products[].profile` with working API resources, buckets and properties to learn from
or reuse.

**Devices without hardware.** A `Virtual` device of a product gets each of its resources from
the product API, and an API resource can be computed by a function of the product code. A
profile bucket (or property) with `source: "resource"`, `update: "interval"` calls that resource
on every connected device of the product, Virtual ones included, so data flows with nothing
outside the server. Combined with a history import (Buckets), this gives realistic fleets for
demos and tests.

## Buckets

A bucket stores timestamped records. Where its data comes from (`config.source`):

- `device`: the server reads a device resource every `interval` seconds, or on its events.
- `mqtt`: messages published on a topic.
- `write` / `api`: anyone with permission writes it (API, device firmware, HTTP callbacks,
  product handlers).

`config.tags` (up to 5) are fields indexed for filtering, e.g. `device` or `site`. They are
read with `tag_<name>=<value>`, and their values can be listed. A **device bucket**
(`/v3/…/devices/<d>/buckets/<b>`) is not separate storage: it is the bucket filtered by
`device=<d>`, and it is read-only. That filter needs a `device` tag: product buckets have it
automatically; a bucket you create yourself needs `config.tags: ["device"]`, or per-device reads
come back empty. Backends: MongoDB, InfluxDB, DynamoDB; `retention` sets how long data is kept.

**Product profile buckets** (`profile.buckets.<id>`): with `data.source: "resource"`,
`data.resource`, `update: "interval"`, `interval` + `magnitude` (`second`, `minute`, `hour`…) and
either `payload_type: "source_payload"` or `payload: "{{payload}}"` (the two are equivalent), the
server samples that resource on each device of the product and writes the result. With neither,
the payload is the default `template_payload` with an empty template, and nothing is written.
Records get a `device` field; the bucket is created on the first write.

**Field names**: `ts` is the record time. In MongoDB buckets `tags` and `_id` are reserved (they
hold the record's tags and id): a record with a field of that name is refused, so rename it
(`tag_count`, …). Since Thinger 7.4 the refusal names the field.

**Reading** (`GET /v2/users/<u>/buckets/<b>/data`, or the SDK's `buckets.read`): records come as
`{ ts, ...fields }`, newest first. Query: `min_ts` / `max_ts` (ms), `items` (default 50, **at most
1000** per call), `sort` (`desc` / `asc`), `agg` (`5m`, `1h`, `1d`…) with `agg_type` (`mean`,
`min`, `max`, `sum`, `count`…), `group_by` (e.g. `device`), `fields`, `tag_<name>=<value>`
(repeat for several values), `tz`. For long ranges, aggregate; to read everything, page backwards with
`max_ts` = oldest `ts` received − 1. With `agg` or `group_by`, each of the `fields` is reduced on
its own (`group_by` without `agg_type` gives each field's latest value): a record or group that
lacks one field still counts for the others, and a field without values is left out of the row.
Without `fields`, an aggregation covers the **numeric** fields of the latest record in the range
(nested ones too, up to 64): name string fields explicitly in `fields` to get them with `last`,
`first`, `mode` or `count`.

Aggregation windows (`1h`, `1d`, `1w`…) start at midnight, hour boundaries, etc. of the time zone
in `tz` (IANA name, e.g. `Europe/Madrid`); without it, **UTC**. So daily totals for a site need
`tz` set to the site's zone, or the days split at UTC midnight. The dashboard SDK sends the
viewer's browser zone unless told otherwise (`timeZone` option). A record falls in the window that contains its
`ts`, so a window covers [start, start + period): when importing pre-aggregated history (e.g. one
record per 5 minutes), stamp each record with the START of the period it summarizes.

**Writing history**:

- `POST /v1/users/<u>/buckets/<b>/data` with an object or an array of objects; a numeric `ts`
  (ms) in each object sets its time (MongoDB and InfluxDB).
- `POST /v1/users/<u>/buckets/<b>/imports` with
  `{ "source": "storage", "storage": "<id>", "file": "<path>.csv" }` loads a CSV from a file
  storage into an existing bucket. First row is the header; separator `,` or `;`. A `ts` (or
  `date` / `timestamp`) column holds the time in **milliseconds** or ISO 8601 (UTC); seconds are
  misread as milliseconds. Other columns become fields (numbers when they parse), and a column
  named like a bucket tag (e.g. `device`) becomes that tag. The response streams
  `{"progress": N}` lines. Not for DynamoDB buckets.

## Asset types and asset groups

Classification shared by devices (and buckets):

- **Asset type** (`asset_type`): what a device is (boiler, meter…).
- **Asset group** (`asset_group`): where or whose it is. Groups nest (`parent`), and project
  members can be limited to some groups.

Both are created on the fly when a device references them. Both have properties that their
devices inherit, and both have location endpoints for maps.

## Properties and inheritance

Devices, products, projects, asset types and asset groups all have properties. When reading
a device property, the first level that defines it wins: **device → asset type → asset group →
product** (the device's own group, not its parent groups). The whole value is taken from that
level: values are not merged, so a property set on the device hides the one of its group or
product. The same lookup applies to `{{property.<id>}}` in product templates, so a setting shared
by many devices (a schedule, a threshold) can live on their group or product and be overridden on
one device. The product can force permissions (`perm`: hidden, read-only for members). The property
`dashboard` on any of them is the dashboard the console shows for that resource. A `null` inside a
stored value currently reads back as `""` (empty string): use another marker, or leave the key out,
when null matters.

## Geofences

Since Thinger 7.4. The server checks geofences natively: do not compute zone entries and exits in your own code. A
property `geofences` on the device, or inherited from its type, group or product, holds a GeoJSON
`FeatureCollection`. Each `Feature` is a `Polygon`, or a `Point` with `properties.radius` in
meters. **Coordinates are `[lon, lat]`**, as in GeoJSON (the `location` property is `{lat, lon}`).
The whole collection comes from the first level that defines it: a device's own `geofences` replaces
its product's, they are not merged. Give each feature a stable GeoJSON `id` (or `properties.id`), so
renaming a zone does not break its history. Its `properties`:

- `name`: the display name, and the key of the zone in events (`geofence`);
- any other field of your own (customer, kind, schedule…): events carry them;
- `enabled` (default true);
- `onEnter`, `onExit`, `whileInside`, `whileOutside`: one entry per event to emit. The value is an
  endpoint to call with the event, or `""` to emit the event only. Zones without them are
  silent. The `while*` events fire on every location update: avoid them on buckets and endpoints
  unless updates are rare.

Every change of the device's `location` (its property, also when a product property or a flow
writes it, or the location an HTTP device or subdevice sends) is checked against the previous one,
which is stored, so a server restart does not repeat events. Each transition emits
`device_geofence_event`, with `device`, `product`, `asset_type`, `asset_group`, `geofence` (name),
`geofence_id`, `geofence_properties` (the feature's own properties), `geofence_event` (onEnter…),
`latitude` and `longitude`. When one update leaves a zone and enters another, the exits are
emitted first. Changing or removing zones emits nothing: a device inside a zone that is removed gets
no `onExit`.

To keep a history, add a product bucket fed by that event:
`"data": {"source": "event", "event": "device_geofence_event", "payload_type": "source_event"}`.
To react to it, add a product flow with the same source and, for example, an `endpoint_call` sink, or
a `property` sink that keeps the last transition on the device. Event sources need
`"payload_type": "source_event"` in flows too, or nothing reaches the sink:

```json
{
  "name": "Last geofence transition",
  "enabled": true,
  "data": { "source": "event", "event": "device_geofence_event", "payload_type": "source_event" },
  "sink": {
    "target": "property",
    "property": "last_zone",
    "payload_type": "template_payload",
    "payload": "{\"zone\": \"{{payload.geofence_id}}\", \"event\": \"{{payload.geofence_event}}\"}"
  }
}
```

In a sink template, `{{payload.<field>}}` reads the event and `{{property.<id>.<field>}}` a property
of the device.

## Alarms

- An **alarm rule** checks sources every `check_interval` (must be > 0). Each source has a
  `name` and is one of:
  - `bucket`: `{ id, mapping: [fields], group_by: ["device"], aggregation: { period, type } }`.
    `group_by: ["device"]` gives one value per device (needed to raise per-device alarms). The
    period is `<n>m`, `h`, `d`, `w`, `mo` or `y` (defaults to the check interval); types `mean`,
    `min`, `max`, `sum`, `count`, `median`, `spread` (max − min, a simple rate of change)…
    Each field of `mapping` is reduced on its own: a device whose records lack one of them still
    gets the others, and the missing one is absent.
  - `device_property`: `{ property, fields: [...] }`, resolved with inheritance (device → asset
    type → asset group → product). The value must be an object, and **fields are paths in the
    property document**, so a value field is `value.<field>`: `fields: ["value.level"]` is read as
    `battery.value.level`.
  - `device_status`: the device's `enabled`, `connection.active`, `connection.ts` (time of the
    last connect / disconnect, not of the last data).
  - Every source can be filtered by `device`, `product`, `asset_type`, `asset_group`, `project`.
    Only **enabled** devices are evaluated: disabling a device takes it out of its alarms.
  - Sources are **joined per device**: each one yields values per device id, and a device's
    conditions see its own values from every source. A bucket source does so with
    `group_by: ["device"]` over the bucket's `device` **tag**, whose value is the device id.
    Product buckets have it by default; give your own buckets `config.tags: ["device"]` too. It is
    what makes per-device reads and filters efficient, and InfluxDB buckets can only group by tags.
    Without it there is no per-device value to join with property or status sources.
    `test-rule` lists, per device, the values it got and why a device was skipped.
- Conditions: `{ "field": "<source name>.<field>", "comparison": "above" | "below" | "equal" |
  "not_equal" | "inside" | "outside" | "present" | "absent", "value": "<string>" }` (`min` /
  `max` for inside / outside), joined with `"operator": "and" | "or"`. **Values are strings**
  (`"30"`, not `30`). A field can be an expression: `ts() - status.connection.ts` is the time
  since the last connect / disconnect. A value (or `min` / `max`) can be an expression too, over
  any source of the same device: `"limits.value.max_depth_m"`, `"limits.value.max_depth_m * 0.9"`.
  Booleans compare as 1 / 0. A comparison on a field the device does not have is false
  (`not_equal` included), so `zone1 above 5` or `zone2 above 5` works on devices that only have
  `zone1`; test a field with `present` / `absent`. A device is skipped when it has none of the
  fields the conditions read, or misses a whole source, unless `present` / `absent` are used.
  Examples:
  - threshold: `{ "field": "climate.temperature", "comparison": "above", "value": "30" }`;
  - per-device threshold: a bucket source `well` (`group_by: ["device"]`) plus a
    `device_property` source `limits` (`property: "limits"`, `fields: ["value.max_depth_m"]`),
    condition `well.depth_m` `above` `"limits.value.max_depth_m"`. Put the default limit on the
    product or asset group and override it on the devices that need another: one rule for all;
  - offline for 10 min: `status.connection.active` `equal` `"0"` and
    `ts() - status.connection.ts` `above` `"600000"` (a device that never connected has
    `connection.ts` 0, so it counts as offline from the start); the same with a `timespan`
    confirmation of 10 minutes on `connection.active` `equal` `"0"` alone also works;
  - no data for 10 min: a `device_status` source plus a bucket source with
    `aggregation: { period: "10m", type: "count" }`, condition `<bucket source>.<field>`
    `absent` (a device whose source returns nothing is otherwise skipped).
- `activation` and `normalization` each have `conditions` and a `confirmation`: `immediate`,
  `sequence` (N checks in a row) or `timespan` (true for a duration). Without normalization
  conditions, the alarm clears when activation is false.
- It creates one **alarm instance** per device that triggers. List them with
  `GET …/alarms/instances?alarm.rule=<rule>&origin.id=<device>&state=1`: like in any resource
  list, a field of the listed documents (nested ones with dots) filters by exact value (numbers
  as numbers, `true` / `false` also as booleans: `?connection.active=true` for connected devices),
  and a repeated parameter matches any of its values (nested fields and booleans since Thinger
  7.4). Instance `state` values:
  0 none, 1 activated, 2 acknowledged, 3 latched, 4 shelved, 5 cleared. `severity` values:
  0 none, 1 low, 2 medium, 3 high, 4 critical.
- Notifications on activation, normalization and reminders call **endpoints**:
  `[{ "type": "endpoint", "id": "<endpoint>" }]`. The endpoint receives the alarm instance
  (`name`, `severity`, `state`, `origin.id` = device, `evaluation.last_values`, `notification.type`…).
- Test a rule, a single source or a notification before saving with
  `POST …/alarms/rules/<r>/test-rule`, `/test-source` and `/test-notification`. `test-rule` and
  `test-source` work before the rule exists (any new id; since Thinger 7.4); `test-source` takes a `check_interval`
  for bucket sources without aggregation (default: the rule's, or 1 minute).

## Endpoints, storages, tokens

- **Endpoint**: an outgoing action (`email`, `http_request`, templates for third-party
  services). Called from the API, devices, products and alarms.
- **File storage**: files (product code, firmware, web apps). A `public` storage serves its
  files without authentication: that is how url dashboards are hosted.
- **Access token**: a long-lived credential with allow/deny permissions per resource type, id
  and action. It can be limited to projects, in which case it must be used with `?project=`.

## Dashboards

- **Build dashboards as SDK apps**: url dashboards (`source: "url"`) are web apps (Angular,
  React, Vue…) built with the dashboard SDK, the npm package `@thinger-io/dashboard-sdk`
  (reference in its README), uploaded to a file storage and rendered in an iframe. They read
  devices, buckets, properties, alarms and live events, and can act on devices.
- **Widget dashboards** (made in the console editor) are legacy: do not create new ones.
- A dashboard lives either in the dashboards collection (standalone, no context) or as the
  `dashboard` property of a device, product, asset type, asset group or project. In the
  second case it opens from that resource's page, and the SDK gets its id in `context`. A
  product dashboard shows up on each of its devices, so one page serves the whole fleet.

## Events

Real-time notifications over `/v2/users/<u>/events` (the SDK's `events.subscribe`). Examples:
`device_state_change` (connected, disconnected…), `device_property_update`, `bucket_write`,
`device_resource_stream`, `device_location_update`, `device_geofence_event` (see Geofences),
`alarm_instance_activate` / `normalize`, `endpoint_call`, and
`<type>_create|update|delete` for any resource. Access tokens and project members can only
subscribe to `device_property_update`, `bucket_write` and `alarm_instance_*`.

## Choosing where data comes from

| Need | Use |
|---|---|
| Current value of a sensor, live | device resource stream (`devices.streamResource`) |
| Read the device on demand | device resource (`devices.getResource`) |
| Act on a device | device resource call, or product API (`devices.callResource`, `products.call`) |
| History, charts, aggregates | bucket (`buckets.read` / `subscribe`; `device: true` for product buckets) |
| Configuration or state that survives offline | property (`devices.getProperty`, `properties.*`) |
| Is it online, and since when | `devices.get` → `connection`; `devices.subscribeState` |
| Where it is | `devices.locations` (maps), the `location` property |
| Entries into and exits from zones | the `geofences` property and `device_geofence_event` (see Geofences) |
| Notify someone | endpoint (`endpoints.call`), or an alarm rule with notifications |

## Recipes

- **Same dashboard for every device of a product**: set it as the product's `dashboard`
  property. Read `Thinger.context.device`, and use product buckets with `device: true`.
- **Fleet overview with drill-down**: a project or standalone dashboard that lists devices
  (`devices.list({ product })`) and routes to a detail view. One app, several entry points.
- **Per-site view**: put devices in an asset group per site, and filter with
  `asset_group` / `devices.locations({ group })`.
- **Data from many devices in one chart**: one product bucket shared by all devices (tagged
  with `device` automatically); read it once and split the records by their `device` field.
