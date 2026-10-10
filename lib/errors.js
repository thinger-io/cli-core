/**
 * Normalize an axios / fetch-style error into a single Error with a stable
 * `.code` and `.status`. Replaces the repeated if-response/if-request
 * blocks in status.js / property.js / resource.js / device.js.
 *
 * Pass `messages.notFound` to override the 404 message with something
 * that names the missing entity (e.g. "Device not found: abc").
 */
export function apiError(error, messages = {}) {
    // Errors normalized upstream (the tagged 'unauthorized' from a failed
    // token refresh, inputError, ...) carry a stable string code and no
    // axios envelope: pass them through so the code survives.
    if (
        error &&
        typeof error.code === 'string' &&
        !error.isAxiosError &&
        !error.response &&
        !error.request
    ) {
        return error;
    }
    if (error && error.response) {
        const status = error.response.status;
        if (status === 404) {
            const err = new Error(messages.notFound || 'Not found');
            err.code = 'not_found';
            err.status = 404;
            return err;
        }
        if (status === 401 || status === 403) {
            const err = new Error(
                messages.unauthorized ||
                    'Unauthorized. Your token may have expired. Please reconfigure.',
            );
            err.code = 'unauthorized';
            err.status = status;
            return err;
        }
        // Thinger answers errors as { error: { message } }: keep the reason,
        // it is often the only clue ("bucket backend not available").
        const detail = serverMessage(error.response.data);
        const err = new Error(
            `Server error: ${status} ${error.response.statusText || ''}`.trim() +
                (detail ? ` — ${detail}` : ''),
        );
        err.code = 'server_error';
        err.status = status;
        return err;
    }
    if (error && error.request) {
        const err = new Error('No response from server. Please check your connection.');
        err.code = 'network_error';
        return err;
    }
    const err = new Error(error?.message || String(error));
    err.code = 'error';
    return err;
}

/** The message a server error body carries, if any: `{ error: { message } }`,
 *  `{ message }`, or a short plain-text body ("cannot create more products"). */
function serverMessage(data) {
    if (typeof data === 'string') {
        const text = data.trim().replace(/^"|"$/g, '');
        return text && text.length <= 300 && !text.startsWith('<') ? text : null;
    }
    if (!data || typeof data !== 'object') return null;
    const message = data.error?.message ?? data.message;
    return typeof message === 'string' && message ? message : null;
}

/**
 * Pre-tagged error for invalid / missing user input (CLI option,
 * MCP tool argument, …). Picked up by `classifyError` so it surfaces
 * as `code: 'input_error'` in both the CLI JSON envelope and the
 * MCP error metadata, matching the same code the CLI's `printErr`
 * uses for argument validation failures.
 */
export function inputError(message) {
    const err = new Error(message);
    err.code = 'input_error';
    return err;
}

/**
 * Error for a resource that already exists, tagged `already_exists` for
 * `classifyError` (create operations refuse to overwrite).
 */
export function alreadyExistsError(message) {
    const err = new Error(message);
    err.code = 'already_exists';
    return err;
}
