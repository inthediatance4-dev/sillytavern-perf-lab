import assert from 'node:assert/strict';
import test from 'node:test';
import {
    WIN_BOOT_MATCH_TOLERANCE_SEC,
    WIN_BOOT_STABILITY_GAP_MS,
    bootIdsMatch,
    classifyPidLiveness,
    settleWindowsBootSample,
} from '../src/process-identity.js';

test('win-boot stamps match inside the documented tolerance and not past it', () => {
    assert.equal(WIN_BOOT_MATCH_TOLERANCE_SEC, 120);
    assert.equal(bootIdsMatch('win-boot:1000', 'win-boot:1000'), true);
    assert.equal(bootIdsMatch('win-boot:1000', `win-boot:${1000 + WIN_BOOT_MATCH_TOLERANCE_SEC}`), true);
    assert.equal(bootIdsMatch('win-boot:1000', `win-boot:${1000 + WIN_BOOT_MATCH_TOLERANCE_SEC + 1}`), false);
    assert.equal(bootIdsMatch('linux-boot', 'win-boot:1000'), false);
    assert.equal(bootIdsMatch('same-id', 'same-id'), true);
});

test('process start wins over a skewed win-boot stamp', () => {
    const owner = { v: 2, pid: 424242, bootId: 'win-boot:1000', processStartMs: 50_000 };
    assert.equal(classifyPidLiveness(owner, {
        signaled: 'alive',
        identity: { bootId: 'win-boot:9000', processStartMs: 50_000 },
    }), 'live');
    assert.equal(classifyPidLiveness(owner, {
        signaled: 'eperm',
        identity: { bootId: 'win-boot:1000', processStartMs: 50_000 },
    }), 'live');
    assert.equal(classifyPidLiveness(owner, {
        signaled: 'alive',
        identity: { bootId: 'win-boot:1000', processStartMs: 51_000 },
    }), 'reused');
    assert.equal(classifyPidLiveness(
        { v: 2, pid: 424242, bootId: 'win-boot:1000' },
        { signaled: 'alive', identity: { bootId: `win-boot:${1000 + WIN_BOOT_MATCH_TOLERANCE_SEC}` } },
    ), 'live');
    assert.equal(classifyPidLiveness(
        { v: 2, pid: 424242, bootId: 'win-boot:1000' },
        { signaled: 'alive', identity: { bootId: `win-boot:${1000 + WIN_BOOT_MATCH_TOLERANCE_SEC + 1}` } },
    ), 'live');
    assert.equal(classifyPidLiveness(owner, {
        signaled: 'alive',
        identity: { bootId: 'win-boot:9000' },
    }), 'live');
    assert.equal(classifyPidLiveness({ ...owner, v: undefined }, {
        signaled: 'alive', identity: { processStartMs: 51_000 },
    }), 'live');
    assert.equal(classifyPidLiveness(
        { v: 2, pid: 424242, bootId: 'win-boot:1000' },
        { signaled: 'dead', identity: { bootId: 'win-boot:1000', processStartMs: 50_000 } },
    ), 'dead');
    assert.equal(classifyPidLiveness(
        { pid: 424242 },
        { signaled: 'unknown', identity: {} },
    ), 'live');
});

test('an unstable Windows boot sample is omitted after two reads more than 2s apart', () => {
    assert.equal(WIN_BOOT_STABILITY_GAP_MS, 2000);
    const first = settleWindowsBootSample(null, { id: 'win-boot:5000', at: 10_000 });
    assert.equal(first.unstable, false);
    assert.equal(first.bootId, 'win-boot:5000');

    const tooSoon = settleWindowsBootSample(first.sample, {
        id: 'win-boot:8000',
        at: 10_000 + WIN_BOOT_STABILITY_GAP_MS,
    });
    assert.equal(tooSoon.unstable, false);
    assert.equal(tooSoon.bootId, 'win-boot:5000');
    assert.equal(tooSoon.sample.at, first.sample.at);

    const stable = settleWindowsBootSample(first.sample, {
        id: `win-boot:${5000 + WIN_BOOT_MATCH_TOLERANCE_SEC}`,
        at: 10_000 + WIN_BOOT_STABILITY_GAP_MS + 1,
    });
    assert.equal(stable.unstable, false);
    assert.equal(stable.bootId, `win-boot:${5000 + WIN_BOOT_MATCH_TOLERANCE_SEC}`);

    const unstable = settleWindowsBootSample(first.sample, {
        id: `win-boot:${5000 + WIN_BOOT_MATCH_TOLERANCE_SEC + 1}`,
        at: 10_000 + WIN_BOOT_STABILITY_GAP_MS + 1,
    });
    assert.equal(unstable.unstable, true);
    assert.equal(unstable.bootId, undefined);
});

async function windowsIdentityFixture(probe) {
    const { readFile } = await import('node:fs/promises');
    let source = await readFile(new URL('../src/process-identity.js', import.meta.url), 'utf8');
    source = source.replace("import { execFileSync } from 'node:child_process';", `export const probes = []; const probe = ${probe}; const execFileSync = (...args) => { probes.push(args[0]); return probe(...args); };`)
        .replaceAll('process.platform', "'win32'");
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
}

test('Windows re-probes foreign PIDs across successive incarnations', async () => {
    const identity = await windowsIdentityFixture('(() => { let start = 133000000000000000; return () => String(start += 10000000); })()');
    const first = identity.readProcessIdentity(424242);
    const second = identity.readProcessIdentity(424242);
    assert.notEqual(first.processStartMs, second.processStartMs);
    assert.equal(identity.classifyPidLiveness({ v: 2, pid: 424242, ...second }, {
        signaled: 'alive', identity: second,
    }), 'live');
    const own = identity.readProcessIdentity(process.pid);
    assert.deepEqual(identity.readProcessIdentity(process.pid), own);
});

test('a fresh observer after a clock step cannot reclaim by Windows boot estimate', () => {
    const fresh = settleWindowsBootSample(null, { id: 'win-boot:1300', at: 9000 });
    assert.equal(classifyPidLiveness({ v: 2, pid: 42, bootId: 'win-boot:1000' }, {
        signaled: 'alive', identity: { bootId: fresh.bootId },
    }), 'live');
});

test('Windows omits identity when PowerShell is unavailable instead of mixing WMIC timestamps', async () => {
    const identity = await windowsIdentityFixture(`(command => {
        if (command !== 'powershell.exe') throw new Error('unexpected provider');
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    })`);
    assert.equal(identity.readProcessIdentity(424242).processStartMs, undefined);
    assert.deepEqual(identity.probes, ['powershell.exe']);
    assert.equal(identity.classifyPidLiveness({ v: 2, pid: 424242, processStartMs: 50000 }, {
        signaled: 'alive', identity: identity.readProcessIdentity(424242),
    }), 'live');
});

test('Linux parses raw ticks after the LAST parenthesis, independent of btime', async t => {
    if (process.platform !== 'linux') return t.skip('requires Linux identity provider');
    const { readProcessIdentity, parseLinuxStartTicks } = await import('../src/process-identity.js');
    const stat = `42 (name)(with spaces)(tail) S ${Array(18).fill('0').join(' ')} 12345678901234567890 0`;
    assert.equal(parseLinuxStartTicks(stat), '12345678901234567890');
    const reads = [];
    const identity = readProcessIdentity(42, { fs: { readFileSync(file) {
        reads.push(file);
        if (file.endsWith('/boot_id')) return 'boot-a\n';
        if (file === '/proc/42/stat') return stat;
        throw new Error('Unexpected read: ' + file);
    } } });
    assert.deepEqual(identity, { bootId: 'boot-a', startTicks: '12345678901234567890' });
    assert.deepEqual(reads, ['/proc/sys/kernel/random/boot_id', '/proc/42/stat']);
});

test('Linux v2 compares boot and ticks; legacy and unreadable identity refuse', () => {
    const owner = { v: 2, pid: 42, bootId: 'boot-a', startTicks: '100', processStartMs: 1000 };
    const observed = identity => ({ signaled: 'alive', identity });
    assert.equal(classifyPidLiveness(owner, observed({ bootId: 'boot-a', startTicks: '100', processStartMs: 61000 })), 'live');
    assert.equal(classifyPidLiveness(owner, observed({ bootId: 'boot-a', startTicks: '101' })), 'reused');
    assert.equal(classifyPidLiveness(owner, observed({ bootId: 'boot-b', startTicks: '100' })), 'reused');
    assert.equal(classifyPidLiveness({ ...owner, v: undefined }, observed({ bootId: 'boot-b', startTicks: '101' })), 'live');
    assert.equal(classifyPidLiveness(owner, observed({})), 'live');
});
