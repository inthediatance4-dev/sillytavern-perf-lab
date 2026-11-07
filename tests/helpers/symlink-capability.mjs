import fs from 'node:fs/promises';

/** Skip only known capability failures; unexpected filesystem errors still fail. */
export async function symlinkOrSkip(t, target, link, type) {
    try {
        await fs.symlink(target, link, type);
        return true;
    } catch (error) {
        if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) throw error;
        t.skip(`Symlink creation unavailable on ${process.platform}: ${error.code} (${error.message})`);
        return false;
    }
}
