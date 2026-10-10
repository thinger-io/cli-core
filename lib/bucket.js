import api from './api.js';
import { apiError } from './errors.js';
import { v1, v2, v3 } from './paths.js';

/**
 * Query a time-series bucket: an account bucket, or one declared in a
 * product profile.
 * When `device` is provided, scopes to that device's bucket; otherwise
 * queries the user-level bucket across every device of the account.
 *
 * Buckets persist structured samples over time: users create them on the
 * account, or declare them in a product profile so every device of the
 * product records its own series.
 *
 * Time range:
 *   - `minutes`: shortcut for "last N minutes" (sets min_ts to
 *     `Date.now() - minutes * 60_000`, max_ts to 0).
 *   - `min_ts` / `max_ts`: explicit unix-millis range when `minutes`
 *     is not supplied; either may be omitted for an open bound.
 *
 * Aggregation: `agg` is the time-window size (e.g. "5m"), `agg_type`
 * the reducer (e.g. "mean"), and `fields` a comma-separated allowlist
 * to trim the response down.
 *
 * `group_by` is passed through verbatim — no default. Custom buckets
 * may not even expose a `device` tag, so the caller decides whether
 * to group (e.g. `group_by=device` for a fleet view) or read raw
 * interleaved samples.
 *
 * @param {{
 *   bucket: string,
 *   device?: string | null,
 *   user?: string | null,
 *   items?: number,
 *   sort?: string,
 *   minutes?: number,
 *   min_ts?: number,
 *   max_ts?: number,
 *   agg?: string,
 *   agg_type?: string,
 *   fields?: string,
 *   group_by?: string | null,
 * }} opts
 */
export async function getBucketData({
    bucket,
    device = null,
    user = null,
    items = 10,
    sort = 'desc',
    minutes,
    min_ts,
    max_ts,
    agg,
    agg_type,
    fields,
    group_by,
} = {}) {
    if (!bucket) throw new Error('bucket is required');
    const params = { items, sort };
    if (minutes) {
        params.min_ts = Date.now() - minutes * 60 * 1000;
        params.max_ts = 0;
    } else {
        if (min_ts) params.min_ts = min_ts;
        if (max_ts !== undefined) params.max_ts = max_ts;
    }
    if (agg) params.agg = agg;
    if (agg_type) params.agg_type = agg_type;
    if (group_by) params.group_by = group_by;
    if (fields) params.fields = fields;

    const url = device
        ? `${v3(user)}/devices/${device}/buckets/${bucket}/data`
        : `${v2(user)}/buckets/${bucket}/data`;

    try {
        const res = await api.get(url, { params });
        return res.data;
    } catch (e) {
        throw apiError(e);
    }
}

/**
 * List the data buckets of the account: id, name, description, enabled
 * flag, `config` (data source) and, for buckets declared in a product
 * profile, the owning `product`.
 */
export async function getBuckets(user = null) {
    try {
        const res = await api.get(`${v1(user)}/buckets`);
        return res.data || [];
    } catch (e) {
        throw apiError(e);
    }
}
