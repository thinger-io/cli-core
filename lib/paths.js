// @ts-check
import { resolveUser } from './config.js';

/**
 * Account-scoped base paths, one per API version.
 *
 * Every endpoint the CLI talks to hangs off `/v{N}/users/{account}`, and
 * the account is the part that is easy to get wrong: leaving it out still
 * produces a valid URL, one that works against your own account and fails
 * only when acting on behalf of another — with a "not found" that points
 * nowhere near the real problem. Building the prefix in one place keeps
 * the account in the signature, where it is visible, and `tests/paths.test.js`
 * fails the build if a module starts hand-rolling these again.
 *
 * Pass `user` to address another account; omit it for the active profile.
 */
export function v1(user) {
    return `/v1/users/${resolveUser(user)}`;
}

export function v2(user) {
    return `/v2/users/${resolveUser(user)}`;
}

export function v3(user) {
    return `/v3/users/${resolveUser(user)}`;
}

/** `/v3/users/{account}/devices/{deviceId}` — the most common prefix. */
export function device(user, deviceId) {
    return `${v3(user)}/devices/${deviceId}`;
}
