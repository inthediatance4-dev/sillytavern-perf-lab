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
    const owner = { pid: 424242, bootId: 'win-boot:1000', processStartMs: 50_000 };
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
        { pid: 424242, bootId: 'win-boot:1000' },
        { signaled: 'alive', identity: { bootId: `win-boot:${1000 + WIN_BOOT_MATCH_TOLERANCE_SEC}` } },
    ), 'live');
    assert.equal(classifyPidLiveness(
        { pid: 424242, bootId: 'win-boot:1000' },
        { signaled: 'alive', identity: { bootId: `win-boot:${1000 + WIN_BOOT_MATCH_TOLERANCE_SEC + 1}` } },
    ), 'reused');
    assert.equal(classifyPidLiveness(owner, {
        signaled: 'alive',
        identity: { bootId: 'win-boot:9000' },
    }), 'live');
    assert.equal(classifyPidLiveness(
        { pid: 424242, bootId: 'win-boot:1000' },
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
