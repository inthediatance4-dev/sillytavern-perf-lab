import { symlinkOrSkip } from './helpers/symlink-capability.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isValidGroupChatId, resolveGroupChatPath } from '../src/chat-io.js';

test('group IDs cannot traverse to another user or silently alias sanitized names', async t => {
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
    if (!await symlinkOrSkip(t, path.join(other, 'private.jsonl'), path.join(directory, 'alias.jsonl'))) return;
    await assert.rejects(resolveGroupChatPath(directory, 'alias'), { reason: 'path_alias' });
    await fs.writeFile(path.join(directory, '安全 history.jsonl'), 'allowed');
    assert.equal(await resolveGroupChatPath(directory, '安全 history'), path.join(directory, '安全 history.jsonl'));
});

test('direct group endpoints reject malformed IDs and info refuses aliases and retirement', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'group-reader-routes-'));
    globalThis.DATA_ROOT = root;
    const config = path.join(root, 'config.yaml');
    await fs.writeFile(config, 'backups:\n  chat:\n    enabled: false\n');
    const util = await import('../src/util.js');
    util.setConfigFilePath(config);
    const { router } = await import('../src/endpoints/chats.js');
    const { retireChatPath } = await import('../src/chat-io.js');
    const directory = path.join(root, 'group-chats');
    await fs.mkdir(directory);
    const outside = path.join(root, 'secret.jsonl');
    await fs.writeFile(outside, '{"mes":"private"}');
    if (!await symlinkOrSkip(t, outside, path.join(directory, 'alias.jsonl'))) return;
    await fs.writeFile(path.join(directory, 'retired.jsonl'), '{"mes":"retired"}');
    await retireChatPath(path.join(directory, 'retired.jsonl'), directory, 'test');
    function invoke(route, id) {
        const handler = router.stack.find(layer => layer.route?.path === route).route.stack.at(-1).handle;
        return new Promise((resolve, reject) => {
            const response = { code: 200, status(code) { this.code = code; return this; }, send() { resolve(this.code); return this; }, sendStatus(code) { this.code = code; return this.send(); } };
            handler({ body: { id }, user: { directories: { groupChats: directory }, profile: { handle: 'test' } } }, response, reject);
        });
    }
    for (const route of ['/group/get', '/group/info', '/group/save', '/group/delete']) {
        for (const id of ['../secret', 'bad:name', 42]) assert.equal(await invoke(route, id), 400);
    }
    assert.equal(await invoke('/group/info', 'alias'), 409);
    assert.equal(await invoke('/group/info', 'retired'), 409);
});
