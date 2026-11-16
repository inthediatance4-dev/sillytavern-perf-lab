import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withCharacterEdit } from '../src/character-lifecycle.js';
import { withPathLocks, chatLockPaths, assertChatWritable, recycleChatPath } from '../src/chat-io.js';

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

for (const operation of ['delete', 'rename']) {
    test(`character ${operation} waits for deferred edit publication and late edits cannot resurrect it`, async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'character-edit-'));
        const target = path.join(directory, 'card.png');
        await fs.writeFile(target, 'original');
        const entered = deferred();
        const release = deferred();
        const edit = withCharacterEdit(directory, 'card.png', async () => {
            const original = await fs.readFile(target, 'utf8');
            entered.resolve();
            await release.promise;
            await fs.writeFile(target, original + '-edited');
        });
        await entered.promise;
        let moved = false;
        const mutation = withPathLocks(chatLockPaths([target]), async () => {
            await assertChatWritable(target, directory);
            assert.equal(await fs.readFile(target, 'utf8'), 'original-edited');
            if (operation === 'rename') await fs.rename(target, path.join(directory, 'renamed.png'));
            else await recycleChatPath(target, directory);
            moved = true;
        });
        await Promise.resolve();
        assert.equal(moved, false);
        release.resolve();
        await Promise.all([edit, mutation]);
        await assert.rejects(withCharacterEdit(directory, 'card.png', () => fs.writeFile(target, 'resurrected')), { reason: 'character_missing' });
        await assert.rejects(fs.access(target), { code: 'ENOENT' });
    });
}
