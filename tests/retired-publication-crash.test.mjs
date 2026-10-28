import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import * as io from '../src/chat-io.js';

const moduleUrl = new URL('../src/chat-io.js', import.meta.url).href;
function child(root, stage, retry = false) {
    return spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import fs from 'node:fs/promises';
        import path from 'node:path';
        import * as io from ${JSON.stringify(moduleUrl)};
        const root = ${JSON.stringify(root)};
        const target = path.join(root, 'deleted.jsonl');
        const stage = ${JSON.stringify(stage)};
        const retry = ${retry};
        await assert.rejects(io.assertChatWritable(target, root), { reason: 'retired_path' });
        if (stage === 'before-recycle') {
            const rename = fs.rename;
            fs.rename = async (from, to) => {
                if (from.endsWith('.json') && from.includes('.chat-lifecycle')) process.exit(73);
                return rename(from, to);
            };
        }
        await io.withPathLocks(io.chatLockPaths([target]), () => io.usingRetiredPathReuses([
            { filePath: target, lifecycleRoot: root, allowVisible: retry },
        ], async () => {
            await io.assertChatWritable(target, root);
            if (stage === 'authorized') process.exit(73);
            const temporary = path.join(root, 'publication.tmp');
            const file = await fs.open(temporary, 'w');
            await file.writeFile('explicit-create');
            await file.sync();
            await file.close();
            if (stage === 'temporary') process.exit(73);
            await fs.rename(temporary, target);
            if (stage === 'published') process.exit(73);
        }));
        await io.assertChatWritable(target, root);
        assert.equal(await fs.readFile(target, 'utf8'), 'explicit-create');
    `], { encoding: 'utf8', timeout: 10000 });
}

for (const stage of ['authorized', 'temporary', 'published', 'before-recycle']) {
    test(`publication crash at ${stage} keeps retirement across restart and allows explicit retry`, async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-crash-'));
        const target = path.join(root, 'deleted.jsonl');
        await fs.writeFile(target, 'original');
        await io.recycleRetiredChat(target, root);
        const crashed = child(root, stage);
        assert.equal(crashed.status, 73, crashed.stderr);
        const restarted = child(root, 'retry', true);
        assert.equal(restarted.status, 0, restarted.stderr);
    });
}

test('legacy holds restore absent retirements and preserve visible-path evidence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-holds-'));
    const directory = path.join(root, '.chat-lifecycle');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'hold-absent.json'), JSON.stringify({ relative_path: 'absent.jsonl' }));
    await fs.writeFile(path.join(directory, 'hold-visible.json'), JSON.stringify({ relative_path: 'visible.jsonl' }));
    await fs.writeFile(path.join(root, 'visible.jsonl'), 'keep');
    await io.restoreLegacyRetiredHolds(root);
    await assert.rejects(io.assertChatWritable(path.join(root, 'absent.jsonl'), root), { reason: 'retired_path' });
    assert.equal(await fs.readFile(path.join(root, 'visible.jsonl'), 'utf8'), 'keep');
    assert.ok((await fs.readdir(directory)).includes('hold-visible.json'));
});

test('a marker cannot be cleared before publication or authorized without a lock', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-admission-'));
    const target = path.join(root, 'deleted.jsonl');
    await fs.writeFile(target, 'old');
    await io.recycleRetiredChat(target, root);
    await assert.rejects(io.clearRetiredPathIfAbsent(target, root), { reason: 'publication_required' });
    await assert.rejects(io.usingRetiredPathReuse(target, root, async () => {}), { reason: 'publication_lock_required' });
    await assert.rejects(io.assertChatWritable(target, root), { reason: 'retired_path' });
});
