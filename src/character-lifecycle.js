import fs from 'node:fs/promises';
import path from 'node:path';
import { withPathLocks, chatLockPaths, assertChatWritable, ChatLifecycleError } from './chat-io.js';

/** Hold the same locks as rename/delete from the first read through publication. */
export function withCharacterEdit(directory, avatar, edit) {
    if (typeof avatar !== 'string' || !avatar.endsWith('.png') || path.basename(avatar) !== avatar) return Promise.reject(new ChatLifecycleError('invalid_avatar'));
    const target = path.join(directory, avatar);
    return withPathLocks(chatLockPaths([target]), async () => {
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
