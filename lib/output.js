import { apiError } from './errors.js';
import ora from 'ora';

let jsonMode = false;

export function setJsonMode(on) {
    jsonMode = !!on;
}

export function isJsonMode() {
    return jsonMode;
}

/**
 * Detect --json / -j in process.argv as early as possible so every
 * subcommand can rely on the mode being set before it runs its own
 * parser. Mirrors the early --profile scan in the entry point.
 */
export function detectJsonModeFromArgv(argv = process.argv) {
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--json' || a === '-j') return setJsonMode(true);
        if (a === '--') return;
    }
}

/**
 * Print a successful result. In JSON mode, writes a single line with the
 * canonical envelope to stdout. Otherwise the caller is expected to have
 * already printed a human-readable rendering.
 */
export function printOk(data) {
    if (!jsonMode) return;
    process.stdout.write(JSON.stringify({ ok: true, data: data ?? null }, null, 2) + '\n');
}

/**
 * Print an error envelope and exit. In JSON mode writes the envelope to
 * stdout so scripts can pipe it to jq; in human mode writes a red error
 * line to stderr. Always exits with the given code (default 1).
 */
export function printErr(message, { code = 'error', exitCode = 1 } = {}) {
    if (jsonMode) {
        process.stdout.write(
            JSON.stringify({ ok: false, error: { message: String(message), code } }, null, 2) +
                '\n',
        );
    } else {
        process.stderr.write(`Error [${code}]: ${message}\n`);
    }
    process.exit(exitCode);
}

/**
 * Create a spinner that becomes a no-op when JSON mode is active. Keeps
 * call-sites symmetrical: spinner.start(), spinner.succeed(), spinner.fail()
 * all work whether JSON mode is on or off.
 */
export function createSpinner(text) {
    if (jsonMode) {
        return {
            start() {
                return this;
            },
            stop() {
                return this;
            },
            succeed() {
                return this;
            },
            fail() {
                return this;
            },
            warn() {
                return this;
            },
            set text(_) {},
            get text() {
                return '';
            },
        };
    }
    return ora(text);
}

/**
 * Map an error from api.js / axios into a stable { message, code } pair.
 * Centralized here so every command reports the same codes in JSON mode.
 */
export function classifyError(error) {
    // Preferred path: library functions use apiError() in lib/errors.js to
    // attach a .code before throwing. Fall back to the raw-axios mapping
    // only when something throws without going through that helper.
    if (error && typeof error.code === 'string' && error.message) {
        return { code: error.code, message: error.message };
    }
    if (error && error.response) {
        const status = error.response.status;
        if (status === 401 || status === 403)
            return {
                code: 'unauthorized',
                message: 'Unauthorized. Your token may have expired. Please reconfigure.',
            };
        if (status === 404)
            return { code: 'not_found', message: error.message || 'Resource not found' };
        return { code: 'server_error', message: apiError(error).message };
    }
    if (error && error.request) {
        return {
            code: 'network_error',
            message: 'No response from server. Please check your connection.',
        };
    }
    return { code: 'error', message: error?.message || String(error) };
}
