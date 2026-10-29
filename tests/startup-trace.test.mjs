import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { describeDataRoot } from '../scripts/describe-data-root.mjs';

const traceModule = pathToFileURL(path.resolve('src/startup-trace.js')).href;
function run(source, trace) {
    const env = { ...process.env };
    delete env.ST_STARTUP_TRACE;
    if (trace) env.ST_STARTUP_TRACE = trace;
    return execFileSync(process.execPath, ['--input-type=module', '-e', source], { env, encoding: 'utf8' });
}
test('disabled trace adds no timers or files and preserves async results/errors', () => {
    run(`import assert from 'node:assert/strict';
        const before = process.getActiveResourcesInfo();
        const t = await import(${JSON.stringify(traceModule)});
        t.mark('unused'); t.noteChildSpawn('unused'); t.noteEventLoopBlock(20); t.finalize({});
        assert.equal(await t.measureAsync('ok', () => 7), 7);
        await assert.rejects(t.measureAsync('bad', () => { throw new Error('preserved'); }), /preserved/);
        assert.deepEqual(process.getActiveResourcesInfo(), before);`);
});
test('enabled trace records ordered high resolution events and one node timing snapshot', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-test-'));
    const file = path.join(dir, 'trace.jsonl');
    run(`const t = await import(${JSON.stringify(traceModule)});
        await t.measureAsync('example', async () => 1);
        t.noteChildSpawn('synthetic'); t.noteEventLoopBlock(5); t.finalize({rss:123});`, file);
    const events = (await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(events.filter(e => e.name === 'node_timing').length, 1);
    assert.ok(events.every((e, i) => Number.isFinite(e.t.epochMs) && (!i || BigInt(e.t.hrtimeNs) >= BigInt(events[i - 1].t.hrtimeNs))));
    assert.equal(events.at(-1).detail.rss, 123);
    assert.ok(events.at(-1).detail.eventLoopBlockTotalMs >= 5);
    assert.ok(events.some(e => e.name === 'example_end'));
});
test('real asynchronous child spawning is observed without affecting its result', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-child-'));
    const file = path.join(dir, 'trace.jsonl');
    run(`import { spawn } from 'node:child_process';
        const t = await import(${JSON.stringify(traceModule)});
        const child = spawn(process.execPath, ['--version'], {stdio:'ignore'});
        await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        t.finalize({});`, file);
    const events = (await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(events.some(e => e.name === 'child_spawn' && e.detail.cmd === process.execPath));
});
test('unwritable trace warns once and disables without throwing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-unwritable-'));
    run(`import assert from 'node:assert/strict'; let warnings = 0; console.warn = () => warnings++;
        const t = await import(${JSON.stringify(traceModule)});
        t.mark('one'); t.mark('two'); t.finalize({}); assert.equal(warnings, 1);`, dir);
});
test('data description uses file metadata and skips recycled files, symlinks and missing directories', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'describe-test-'));
    await fs.mkdir(path.join(dir, 'default-user/chats/Card/.recycle'), { recursive: true });
    await fs.mkdir(path.join(dir, 'default-user/characters'), { recursive: true });
    await fs.mkdir(path.join(dir, 'default-user/extensions/synthetic'), { recursive: true });
    await fs.writeFile(path.join(dir, 'default-user/characters/Card.png'), 'card');
    await fs.writeFile(path.join(dir, 'default-user/chats/Card/chat.jsonl'), 'chat');
    await fs.writeFile(path.join(dir, 'default-user/chats/Card/.recycle/old.jsonl'), 'retained');
    await fs.symlink(path.join(dir, 'default-user/chats/Card/chat.jsonl'), path.join(dir, 'default-user/chats/Card/link.jsonl'));
    const description = await describeDataRoot(dir);
    assert.deepEqual(description.characters, { count: 1, bytes: 4 });
    assert.deepEqual(description.chats, { count: 1, bytes: 4 });
    assert.deepEqual(description.extensions, ['synthetic']);
    assert.deepEqual(await describeDataRoot(path.join(dir, 'missing')), { characters: { count: 0, bytes: 0 }, chats: { count: 0, bytes: 0 }, groups: { count: 0 }, worldinfo: { count: 0 }, extensions: [] });
});
