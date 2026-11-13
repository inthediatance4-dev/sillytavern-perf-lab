import path from 'node:path';
import fs from 'node:fs';

/** Expand DOS short names in the existing prefix, including for unpublished files. */
export function windowsPathKey(filePath, realpath = fs.realpathSync.native) {
    let current = path.win32.resolve(filePath);
    const missing = [];
    while (true) {
        try {
            return path.win32.join(realpath(current), ...missing).toLowerCase();
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const parent = path.win32.dirname(current);
            if (parent === current) throw error;
            missing.unshift(path.win32.basename(current));
            current = parent;
        }
    }
}
