// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Extract an npm package tarball (.tgz) into a folder, without a `tar`
 * binary: only regular files and folders, every path kept inside `dest`.
 * npm packs ustar archives, with pax headers for long paths.
 *
 * @param {Buffer} tgz
 * @param {string} dest  Folder to extract into (created).
 * @param {{ strip?: number }} [opts]  Leading path segments to drop (1 for npm's `package/`).
 */
export function extractTgz(tgz, dest, { strip = 0 } = {}) {
    let tar;
    try {
        tar = zlib.gunzipSync(tgz);
    } catch {
        throw new Error('not a .tgz archive');
    }
    const root = path.resolve(dest);
    fs.mkdirSync(root, { recursive: true });
    const field = (buf, start, length) =>
        buf.toString('utf8', start, start + length).replace(/\0.*$/s, '');
    let offset = 0;
    /** @type {string | null} */
    let longName = null;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((b) => b === 0)) break;
        const size = parseInt(field(header, 124, 12).trim() || '0', 8);
        if (!Number.isFinite(size) || size < 0) throw new Error('corrupt tar header');
        const type = String.fromCharCode(header[156] || 48);
        const prefix = field(header, 345, 155);
        const name =
            longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
        longName = null;
        const body = tar.subarray(offset + 512, offset + 512 + size);
        offset += 512 + Math.ceil(size / 512) * 512;

        if (type === 'x') {
            // pax extended header: "<len> path=<value>\n" records for the next entry
            const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
            if (match) longName = match[1];
            continue;
        }
        if (type === 'L') {
            longName = body.toString('utf8').replace(/\0.*$/s, '');
            continue;
        }
        if (type !== '0' && type !== '5') continue; // links, devices… are skipped
        const parts = name.split('/').filter(Boolean).slice(strip);
        if (!parts.length) continue;
        if (parts.some((p) => p === '..' || p.includes('\\') || p.includes(':'))) {
            throw new Error(`unsafe path in archive: ${name}`);
        }
        const target = path.join(root, ...parts);
        if (!target.startsWith(root + path.sep)) throw new Error(`unsafe path in archive: ${name}`);
        if (type === '5') fs.mkdirSync(target, { recursive: true });
        else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, body);
        }
    }
}
