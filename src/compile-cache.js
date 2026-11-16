import fs from 'node:fs';
import module from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Enable Node's optional module cache before importing the application.
 * Unsupported runtimes and cache failures must never prevent startup.
 * @param {string} directory Cache directory.
 * @param {object} moduleApi Node module API (replaceable for compatibility tests).
 * @returns {object|null} Node's cache status, or null when unavailable.
 */
export function enableStartupCompileCache(
    directory = fileURLToPath(new URL('../node_modules/.cache/st-compile-cache', import.meta.url)),
    moduleApi = module,
) {
    try {
        if (typeof moduleApi.enableCompileCache !== 'function') return null;
        fs.mkdirSync(directory, { recursive: true });
        return moduleApi.enableCompileCache(directory);
    } catch {
        return null;
    }
}
