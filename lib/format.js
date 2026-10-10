// @ts-check
import chalk from 'chalk';

// ─────────────────────────────────────────────────────────────────────
// Theme — semantic wrappers over chalk so every CLI surface speaks
// the same visual language. New colours / a `--no-color` switch / a
// dark-on-light adjustment only have to be touched here.
// ─────────────────────────────────────────────────────────────────────

/** Title / header text. */
export const label = (s) => chalk.bold(s);
/** Secondary / disabled / "—" text. */
export const muted = (s) => chalk.dim(s);
/** Hints, trailing metadata, footers, timestamps. */
export const hint = (s) => chalk.gray(s);
/** Positive states (online, ok, success). */
export const success = (s) => chalk.green(s);
/** Negative states (offline, failed, errored). */
export const error = (s) => chalk.red(s);
/** Caution states (timeout, at-risk thresholds). */
export const warning = (s) => chalk.yellow(s);
/** Decorative accents (separators, prompts). */
export const accent = (s) => chalk.cyan(s);
/** Neutral-but-noteworthy identifiers (device ids, resource names). */
export const info = (s) => chalk.blue(s);

/**
 * Format a duration in seconds as a human-readable string: `309d16h`,
 * `42d15h`, `17m`, `42s`, etc. Returns `—` for invalid/missing values.
 *
 * @param {number | null | undefined} seconds
 * @returns {string}
 */
export function formatUptime(seconds) {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d${h}h`;
    if (h > 0) return `${h}h${m}m`;
    if (m > 0) return `${m}m`;
    return `${Math.floor(seconds)}s`;
}

/**
 * Format seconds elapsed as a "time ago" label: `5s ago`, `3m ago`,
 * `2h ago`, `4d ago`. Returns `—` for invalid/missing values.
 *
 * @param {number | null | undefined} seconds
 * @returns {string}
 */
export function formatAgo(seconds) {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 60) return `${Math.floor(seconds)}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Render a percentage value coloured by threshold: green below 70 %,
 * yellow below 90 %, red at or above 90 %. Returns a dim `—` when the
 * value is missing. Formatted with no decimal places so columns in
 * cli-table3 stay aligned.
 *
 * @param {number | null | undefined} v
 * @returns {string}
 */
export function colorPct(v) {
    if (v == null || !Number.isFinite(v)) return muted('—');
    const s = `${v.toFixed(0)}%`;
    if (v >= 90) return error(s);
    if (v >= 70) return warning(s);
    return success(s);
}

/**
 * Format a duration in seconds as a short ETA label: `12s`, `3m15s`,
 * `2h30m`. Returns `—` for non-finite / missing values.
 *
 * @param {number | null | undefined} seconds
 * @returns {string}
 */
export function formatETA(seconds) {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}s`;
    if (seconds < 3600) {
        const m = Math.floor(seconds / 60);
        const s = Math.ceil(seconds % 60);
        return s > 0 ? `${m}m${s}s` : `${m}m`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.ceil((seconds % 3600) / 60);
    return m > 0 ? `${h}h${m}m` : `${h}h`;
}

/**
 * Format a byte count as a human-readable string picking the largest
 * unit where the value is ≥ 1. `2 bytes`, `12.3 KB`, `145 MB`,
 * `2.4 GB`. Returns `—` for invalid/missing values.
 *
 * @param {number | null | undefined} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(gb >= 100 ? 0 : 2)} GB`;
}
