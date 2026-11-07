import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { review, source } from './review-context.mjs';
import './preserve-deletions.mjs';
const io = await import(pathToFileURL(path.join(source, 'src/chat-io.js')));
if (process.argv[2]) {
    const root = process.argv[2];
    const target = path.join(root, 'deleted.jsonl');
    await io.withPathLocks(io.chatLockPaths([target]), () => io.usingRetiredPathReuse(target, root, async () => {
        process.exit(73); // Crash before the deliberate create publishes anything.
    }));
} else {
    const root = fs.mkdtempSync(path.join(review, 'temp', 'retired-reuse-crash-'));
    const target = path.join(root, 'deleted.jsonl');
    fs.writeFileSync(target, 'original synthetic chat');
    await io.recycleRetiredChat(target, root);
    await assert.rejects(io.assertChatWritable(target, root), error => error.reason === 'retired_path');
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), root], { cwd: source, env: process.env, encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 73);
    const holds = fs.readdirSync(path.join(root, '.chat-lifecycle')).filter(name => name.startsWith('hold-'));
    let writable = true;
    try { await io.assertChatWritable(target, root); } catch { writable = false; }
    if (writable) await io.writeChatFile(target, 'stale synthetic autosave after restart');
    const report = { scenario: 'retired-name-reuse-crash-before-publication', reproduced: writable && holds.length === 1, childStatus: child.status, deliberateCreatePublished: false, ordinaryStaleSaveAdmitted: writable, orphanedHeldMarkers: holds.length, originalBytesRemainRecycled: true };
    fs.writeFileSync(path.join(review, 'retired-reuse-crash.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log('Evidence directory: ' + review);
}
