import fs from 'node:fs/promises';
import path from 'node:path';
import { withPathLocks, chatLockPaths, assertChatWritable, ChatLifecycleError } from './chat-io.js';

/** Hold the same locks as rename/delete from the first read through publication. */
export function withCharacterEdit(directory, avatar, edit, { create = false, lockPaths = [] } = {}) {
    if (typeof avatar !== 'string' || !avatar.endsWith('.png') || path.basename(avatar) !== avatar) return Promise.reject(new ChatLifecycleError('invalid_avatar'));
    const target = path.join(directory, avatar);
    return withPathLocks([...chatLockPaths([target]), ...lockPaths], async () => {
        if (create) return edit();
        await assertChatWritable(target, directory);
        // Delete may leave no retirement marker for the card itself.
        try { await fs.access(target); }
        catch (error) {
            if (error.code === 'ENOENT') throw new ChatLifecycleError('character_missing');
            throw error;
        }
        return edit();
    });
}

// Deletion intent invalidates only imports; ordinary edits retain their existing queue semantics.
const importEpochs = new Map();
const activeImports = new Map();

export function invalidateCharacterImport(directory, avatar) {
    const key = path.resolve(directory, avatar);
    importEpochs.set(key, (importEpochs.get(key) || 0) + 1);
    activeImports.get(key)?.();
}

export function withCharacterImport(directory, avatar, edit, lockPaths = []) {
    const key = path.resolve(directory, avatar);
    const epoch = importEpochs.get(key) || 0;
    const check = () => {
        if ((importEpochs.get(key) || 0) !== epoch) throw new ChatLifecycleError('character_deleted');
    };
    return withCharacterEdit(directory, avatar, async () => {
        let cancel;
        const cancelled = new Promise((resolve, reject) => { cancel = () => reject(new ChatLifecycleError('character_deleted')); });
        // Cancellation may arrive while publication is still waiting for its chat lock.
        cancelled.catch(() => {});
        activeImports.set(key, cancel);
        const pending = [];
        check.wait = promise => {
            pending.push(promise);
            return Promise.race([promise, cancelled]);
        };
        try { return await edit(check); }
        finally {
            // A race rejection cancels admission, not the underlying publication I/O.
            // Keep the edit locks until every real operation has finished its cleanup.
            let settled = 0;
            while (settled < pending.length) {
                const batch = pending.slice(settled);
                settled = pending.length;
                await Promise.allSettled(batch);
            }
            if (activeImports.get(key) === cancel) activeImports.delete(key);
        }
    }, { create: true, lockPaths });
}
