import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { review, source } from './review-context.mjs';
import './preserve-deletions.mjs';
if (process.platform !== 'linux') throw new Error('This reproduction requires actual Linux /proc');
const childRoot = process.argv[2];
if (childRoot) {
    const original = fs.readFileSync;
    fs.readFileSync = function(target, ...args) {
        const result = original(target, ...args);
        // Simulate a clock correction's /proc/stat btime change only.
        // Real boot_id, real live PID and /proc/<pid>/stat ticks remain untouched.
        if (String(target) === '/proc/stat' && typeof result === 'string') {
            return result.replace(/^btime (\d+)$/m, (_, seconds) => `btime ${Number(seconds) + 60}`);
        }
        return result;
    };
    const { acquireDataRootOwnership } = await import(pathToFileURL(path.join(source, 'src/data-root-owner.js')));
    const result = acquireDataRootOwnership(childRoot);
    console.log(JSON.stringify({ acquired: !!result.lockPath, unverified: !!result.unverified, token: result.token }));
} else {
    const { acquireDataRootOwnership, releaseDataRootOwnership } = await import(pathToFileURL(path.join(source, 'src/data-root-owner.js')));
    const root = fs.mkdtempSync(path.join(review, 'temp', 'linux-clock-owner-'));
    const owner = acquireDataRootOwnership(root);
    assert.ok(owner.lockPath);
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), root], { env: process.env, encoding: 'utf8', timeout: 5000 });
    let contender;
    try { contender = JSON.parse(child.stdout.trim().split('\n').at(-1)); } catch { contender = null; }
    process.kill(process.pid, 0);
    releaseDataRootOwnership();
    const report = { scenario: 'linux-btime-clock-correction', reproduced: child.status === 0 && contender?.acquired === true && contender.token !== owner.token, originalOwnerStillAlive: true, originalPid: process.pid, sameBootId: owner.bootId, btimeInjectedDeltaSeconds: 60, actualClockChanged: false, childStatus: child.status, contender, stderr: child.stderr.slice(-1200) };
    fs.writeFileSync(path.join(review, 'linux-clock-owner.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log('Evidence directory: ' + review);
}
