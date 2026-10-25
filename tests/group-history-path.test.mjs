import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isValidGroupChatId, resolveGroupChatPath } from '../src/chat-io.js';

test('group IDs cannot traverse to another user or silently alias sanitized names', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'group-history-path-'));
    const directory = path.join(root, 'alice', 'group-chats');
    const other = path.join(root, 'bob', 'group-chats');
    await fs.mkdir(directory, { recursive: true });
    await fs.mkdir(other, { recursive: true });
    await fs.writeFile(path.join(other, 'private.jsonl'), 'private');
    for (const id of ['../../bob/group-chats/private', '..\\private', '/private', '', '.', '..', null, {}, 42, 'bad:name']) {
        assert.equal(isValidGroupChatId(id), false);
        await assert.rejects(resolveGroupChatPath(directory, id), { reason: 'invalid_chat_id' });
    }
    await fs.symlink(path.join(other, 'private.jsonl'), path.join(directory, 'alias.jsonl'));
    await assert.rejects(resolveGroupChatPath(directory, 'alias'), { reason: 'path_alias' });
    await fs.writeFile(path.join(directory, '安全 history.jsonl'), 'allowed');
    assert.equal(await resolveGroupChatPath(directory, '安全 history'), path.join(directory, '安全 history.jsonl'));
});
