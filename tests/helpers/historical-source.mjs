import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Optional independent oracle: archives and shallow clones may lack this blob. */
export async function historicalSource(spec, cwd = new URL('../../', import.meta.url)) {
    try {
        const { stdout } = await run('git', ['show', spec], { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
        return stdout;
    } catch (error) {
        // Git reports absent objects/non-repositories with 128. Do not mask IO,
        // permissions, output overflow or other unexpected execution failures.
        if (error.code === 'ENOENT' || error.code === 128) return null;
        throw error;
    }
}
