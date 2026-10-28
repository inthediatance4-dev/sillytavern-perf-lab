import assert from 'node:assert/strict';
import test from 'node:test';
import {
    WINDOWS_PROBE_BUDGET_MS,
    readProcessIdentity,
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
    source = source.replace("import { execFileSync } from 'node:child_process';", `export const probes = []; export const calls = []; const probe = ${probe}; const execFileSync = (...args) => { probes.push(args[0]); calls.push(args); return probe(...args); };`)
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

test('Windows retries after timeout, using the same probe and rounding for self and peers', async () => {
    assert.ok(WINDOWS_PROBE_BUDGET_MS >= 2000 && WINDOWS_PROBE_BUDGET_MS <= 3000);
    const identity = await windowsIdentityFixture(`(() => {
        let calls = 0;
        return () => {
            if (++calls === 1) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
            return '133000000000005000';
        };
    })()`);
    assert.equal(identity.readProcessIdentity(process.pid).processStartMs, undefined);
    const own = identity.readProcessIdentity(process.pid);
    const peer = identity.readProcessIdentity(424242);
    assert.equal(own.processStartMs, 1655526400001);
    assert.equal(peer.processStartMs, own.processStartMs);
    assert.equal(identity.classifyPidLiveness({ v: 2, pid: 424242, processStartMs: own.processStartMs + 1 }, {
        signaled: 'alive', identity: peer,
    }), 'reused', 'same-source millisecond identities compare exactly');
    assert.equal(identity.readProcessIdentity(process.pid).processStartMs, own.processStartMs);
    assert.equal(identity.calls.length, 3, 'only successful self identity is cached');
    for (const [index, pid] of [process.pid, process.pid, 424242].entries()) {
        const [command, args, options] = identity.calls[index];
        assert.equal(command, 'powershell.exe');
        assert.deepEqual(args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
            `[System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToFileTimeUtc()`]);
        assert.equal(options.timeout, WINDOWS_PROBE_BUDGET_MS);
        assert.equal(options.windowsHide, true);
    }
});

test('Windows probe failures and malformed output refuse reclaim and remain retryable', async () => {
    for (const output of ["throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });",
        "throw Object.assign(new Error('denied'), { code: 'EACCES' });",
        "return 'garbage';", "return '1e17';", "return '0';"]) {
        const identity = await windowsIdentityFixture(`(() => { ${output} })`);
        for (const signaled of ['alive', 'eperm']) {
            assert.equal(identity.classifyPidLiveness({ v: 2, pid: 424242, processStartMs: 50000 }, {
                signaled, identity: identity.readProcessIdentity(424242),
            }), 'live');
        }
        assert.equal(identity.calls.length, 2);
    }
});

test('real Windows cold probe is bounded and self identity matches a peer observation', async t => {
    if (process.platform !== 'win32') return t.skip('requires real Windows PowerShell and process table');
    const started = performance.now();
    const own = readProcessIdentity(process.pid);
    const elapsed = performance.now() - started;
    t.diagnostic(`Windows cold process identity probe: ${elapsed.toFixed(1)} ms; budget ${WINDOWS_PROBE_BUDGET_MS} ms`);
    assert.ok(elapsed < WINDOWS_PROBE_BUDGET_MS + 1500, 'probe exceeded budget plus process teardown allowance');
    if (!Number.isSafeInteger(own.processStartMs)) {
        assert.ok(!process.env.CI, 'Windows CI must provide process start identity');
        return t.skip('local Windows PowerShell process identity unavailable');
    }
    const { spawnSync } = await import('node:child_process');
    const moduleUrl = new URL('../src/process-identity.js', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { readProcessIdentity } from ${JSON.stringify(moduleUrl)};
        console.log(JSON.stringify(readProcessIdentity(${process.pid})));
    `], { encoding: 'utf8', timeout: WINDOWS_PROBE_BUDGET_MS + 5000 });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.equal(JSON.parse(child.stdout).processStartMs, own.processStartMs);
});
