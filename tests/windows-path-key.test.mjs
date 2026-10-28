import assert from 'node:assert/strict';
import test from 'node:test';
import { windowsPathKey } from '../src/windows-path-key.js';

test('Windows keys expand short ancestors consistently before and after publication', () => {
    let published = false;
    const realpath = value => {
        const canonical = value.replace(/RUNNER~1/i, 'runneradmin');
        if (!published && /\\new(\\|$)/i.test(value)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return canonical;
    };
    const short = 'C:\\Users\\RUNNER~1\\Temp\\new\\chat.jsonl';
    const long = 'c:\\users\\runneradmin\\temp\\new\\CHAT.jsonl';
    const before = windowsPathKey(short, realpath);
    assert.equal(before, windowsPathKey(long, realpath));
    published = true;
    assert.equal(windowsPathKey(short, realpath), before);
    assert.equal(windowsPathKey(long, realpath), before);
});

test('Windows key canonicalization preserves access and I/O failures', () => {
    for (const code of ['EACCES', 'EPERM', 'EIO']) {
        const error = Object.assign(new Error(code), { code });
        assert.throws(() => windowsPathKey('C:\\private\\chat.jsonl', () => { throw error; }), error);
    }
});

test('native temp aliases share locks, retirement markers and publication authorization', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const io = await import('../src/chat-io.js');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-path-key-'));
    try {
        const canonicalRoot = await fs.realpath(root);
        const target = path.join(root, 'chat.jsonl');
        const canonicalTarget = path.join(canonicalRoot, 'chat.jsonl');
        assert.equal(io.pathLockKey(target), io.pathLockKey(canonicalTarget));
        await fs.writeFile(target, 'original');
        await io.recycleRetiredChat(target, root);
        await assert.rejects(io.assertChatWritable(canonicalTarget, canonicalRoot), { reason: 'retired_path' });
        await io.withPathLocks(io.chatLockPaths([target]), () =>
            io.withPathLocks(io.chatLockPaths([canonicalTarget]), () =>
                io.usingRetiredPathReuse(canonicalTarget, canonicalRoot, async () => {
                    await io.assertChatWritable(target, root);
                    await fs.writeFile(target, 'published');
                })));
        await io.assertChatWritable(target, root);
        assert.equal(await fs.readFile(target, 'utf8'), 'published');
        const { withCharacterImport, invalidateCharacterImport } = await import('../src/character-lifecycle.js');
        let entered, release;
        const ready = new Promise(resolve => { entered = resolve; });
        const blocked = new Promise(resolve => { release = resolve; });
        const importing = withCharacterImport(root, 'card.png', async check => {
            entered();
            await check.wait(blocked);
            check();
        });
        const rejected = assert.rejects(importing, { reason: 'character_deleted' });
        await ready;
        invalidateCharacterImport(canonicalRoot, process.platform === 'win32' ? 'CARD.png' : 'card.png');
        release();
        await rejected;
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
