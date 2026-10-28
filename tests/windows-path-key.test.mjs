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

// Run the production marker writer and lookup with Windows paths on every platform.
test('short and long lifecycle roots find root-relative markers in both directions (simulation)', async () => {
    const { readFile } = await import('node:fs/promises');
    const fixture = `
        import path from 'node:path';
        export const records = new Map();
        export const realpath = value => value.replace(/RUNNER~1/ig, 'runneradmin');
        const key = value => realpath(path.win32.resolve(value)).toLowerCase();
        export const atomic = async (file, data) => { records.set(key(file), data); };
        export default { promises: {
            realpath: async value => realpath(value),
            mkdir: async () => {},
            lstat: async value => {
                if (value.includes('.chat-lifecycle') && value.endsWith('.json') && !records.has(key(value))) {
                    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
                }
                return { isSymbolicLink: () => false };
            },
        } };
    `;
    const fixtureUrl = `data:text/javascript,${encodeURIComponent(fixture).replaceAll("'", '%27')}`;
    let source = await readFile(new URL('../src/chat-io.js', import.meta.url), 'utf8');
    source = source.replace(/from '([^']+)'/g, (_, specifier) => `from '${import.meta.resolve(specifier.startsWith('./') ? `../src/${specifier.slice(2)}` : specifier)}'`)
        .replace("import fs from 'node:fs';", `import fs, { realpath as simulatedRealpath } from '${fixtureUrl}';`)
        .replace("import path from 'node:path';", "import { win32 as path } from 'node:path';")
        .replace(/import writeFileAtomic from '[^']+';/, `import { atomic as writeFileAtomic } from '${fixtureUrl}';`)
        .replace("process.platform === 'win32'", 'true')
        .replace('windowsPathKey(resolved)', 'windowsPathKey(resolved, simulatedRealpath)');
    const io = await import(`data:text/javascript,${encodeURIComponent(source)}`);
    const { records } = await import(fixtureUrl);
    const { win32 } = await import('node:path');
    const roots = ['C:\\Users\\RUNNER~1\\Temp\\chats', 'C:\\Users\\runneradmin\\Temp\\chats'];
    for (const [index, root] of roots.entries()) {
        for (const relative of ['chat.jsonl', 'card', 'card\\history.jsonl']) {
            records.clear();
            const retirement = await io.retireChatPath(win32.join(root, relative), root, 'test');
            assert.equal(JSON.parse([...records.values()][0]).relative_path, relative);
            assert.equal(win32.dirname(retirement.marker), win32.join(root, '.chat-lifecycle'));
            const other = roots[1 - index];
            await assert.rejects(io.assertChatWritable(win32.join(other, relative), other), { reason: 'retired_path' });
            if (relative === 'card') {
                await assert.rejects(io.assertChatWritable(win32.join(other, relative, 'child.jsonl'), other), { reason: 'retired_path' });
            }
        }
    }
});

test('DOS short-name lifecycle roots preserve retirement in both directions (native Windows)', {
    skip: process.platform !== 'win32' ? 'Requires native Windows DOS 8.3 short-name filesystem aliases' : false,
}, async t => {
    const fs = await import('node:fs/promises');
    const { realpathSync } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { execFileSync } = await import('node:child_process');
    const io = await import('../src/chat-io.js');
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'retired long name '));
    try {
        const longRoot = realpathSync.native(temporary);
        // os.tmpdir() may already contain a short ancestor such as RUNNER~1.
        const shortRoot = temporary.toLowerCase() !== longRoot.toLowerCase()
            ? temporary
            : execFileSync('cmd.exe', ['/d', '/c', `for %I in ("${longRoot}") do @echo %~sI`], { encoding: 'utf8' }).trim();
        if (shortRoot.toLowerCase() === longRoot.toLowerCase()) {
            t.skip('The temporary directory has no distinct DOS 8.3 short name (short-name creation may be disabled)');
            return;
        }
        assert.equal((await fs.realpath(shortRoot)).toLowerCase(), longRoot.toLowerCase());
        for (const [index, root] of [shortRoot, longRoot].entries()) {
            const relative = `retired-${index}.jsonl`;
            const retirement = await io.retireChatPath(path.join(root, relative), root, 'test');
            const record = JSON.parse(await fs.readFile(retirement.marker, 'utf8'));
            assert.equal(record.relative_path, relative);
            const other = index === 0 ? longRoot : shortRoot;
            await assert.rejects(io.assertChatWritable(path.join(other, relative), other), { reason: 'retired_path' });
        }
    } finally {
        await fs.rm(temporary, { recursive: true, force: true });
    }
});
