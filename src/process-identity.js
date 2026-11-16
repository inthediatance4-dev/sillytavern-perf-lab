import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const startupTrace = process.env.ST_STARTUP_TRACE ? await import('./startup-trace.js') : null;

/**
 * Identity used to tell a live owner from a recycled pid.
 *
 * Linux identity uses the boot id and raw start ticks, independent of wall time.
 * processStartMs is diagnostic only on Linux.
 *
 * Windows boot estimates are diagnostic only: clock changes cannot authorize
 * reclaiming an existing PID. Reliable process start identities decide reuse;
 * unavailable identity fails closed. Only this process's start time is cached.
 */

/**
 * `win-boot:` stamps within this many seconds are the same boot.
 * `Date.now() - os.uptime()` is whole seconds and moves when the clock steps.
 */
export const WIN_BOOT_MATCH_TOLERANCE_SEC = 120;

/**
 * A second Windows boot sample is a stability check only after this gap.
 * Samples closer together keep the first stamp. A pair outside
 * {@link WIN_BOOT_MATCH_TOLERANCE_SEC} omits boot id from new payloads.
 */
export const WIN_BOOT_STABILITY_GAP_MS = 2000;

/** Startup-only probe budget, including cold PowerShell startup. */
export const WINDOWS_PROBE_BUDGET_MS = 3000;

/** Windows FILETIME epoch (1601-01-01) to Unix epoch, in milliseconds. */
const FILETIME_UNIX_EPOCH_MS = 11644473600000;

/** @type {string|null|undefined} */
let cachedBootId;
/** @type {{ id: string|undefined, at: number }|null} */
let windowsBootSample = null;
/** @type {boolean} */
let windowsBootUnstable = false;
/** @type {Map<number, number|undefined>} */
const windowsStartCache = new Map();

/**
 * @returns {string|undefined}
 */
function readBootIdUncached() {
    if (process.platform === 'linux') {
        try {
            const text = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
            if (text.length > 0 && text.length <= 256) return text;
        } catch {
            // Omit the field. Callers fail closed when a stored id cannot be checked.
        }
        return undefined;
    }
    if (process.platform === 'win32') {
        try {
            const uptimeMs = os.uptime() * 1000;
            if (!Number.isFinite(uptimeMs) || uptimeMs < 0) return undefined;
            const bootSec = Math.round((Date.now() - uptimeMs) / 1000);
            if (!Number.isSafeInteger(bootSec) || bootSec <= 0) return undefined;
            return `win-boot:${bootSec}`;
        } catch {
            return undefined;
        }
    }
    // Other platforms have no cheap boot identity. Omit it.
    return undefined;
}

/**
 * Decide whether a Windows boot stamp is stable enough to store.
 * The first sample is kept. A later sample at most {@link WIN_BOOT_STABILITY_GAP_MS}
 * later does not count. A later sample outside {@link WIN_BOOT_MATCH_TOLERANCE_SEC}
 * marks the source unstable so callers omit `bootId`.
 * @param {{ id: string|undefined, at: number }|null} previous
 * @param {{ id: string|undefined, at: number }} next
 * @returns {{ bootId: string|undefined, unstable: boolean, sample: { id: string|undefined, at: number } }}
 */
export function settleWindowsBootSample(previous, next) {
    if (!previous) {
        return { bootId: next.id, unstable: false, sample: { id: next.id, at: next.at } };
    }
    if (next.at - previous.at <= WIN_BOOT_STABILITY_GAP_MS) {
        return { bootId: previous.id, unstable: false, sample: previous };
    }
    if (!previous.id || !next.id || !bootIdsMatch(previous.id, next.id)) {
        return { bootId: undefined, unstable: true, sample: { id: undefined, at: next.at } };
    }
    return { bootId: next.id, unstable: false, sample: { id: next.id, at: next.at } };
}

/**
 * @returns {string|undefined}
 */
function readWindowsBootId() {
    if (windowsBootUnstable) return undefined;
    const next = { id: readBootIdUncached(), at: Date.now() };
    const settled = settleWindowsBootSample(windowsBootSample, next);
    windowsBootSample = settled.sample;
    if (settled.unstable) {
        windowsBootUnstable = true;
        return undefined;
    }
    return settled.bootId;
}

/**
 * @returns {string|undefined}
 */
export function readBootId() {
    if (process.platform === 'win32') return readWindowsBootId();
    if (cachedBootId === undefined) cachedBootId = readBootIdUncached() ?? null;
    return cachedBootId ?? undefined;
}

/** Parse field 22 after the last closing parenthesis of comm.
 * @param {string} text
 * @returns {string|undefined}
 */
export function parseLinuxStartTicks(text) {
    const end = text.lastIndexOf(')');
    if (end < 0) return undefined;
    const ticks = text.slice(end + 1).trim().split(/\s+/)[19];
    return /^(0|[1-9]\d*)$/.test(ticks) ? ticks : undefined;
}

/**
 * @param {string} stdout
 * @returns {number|undefined}
 */
function parseFileTime(stdout) {
    const text = String(stdout).trim();
    if (!/^[1-9]\d{0,18}$/.test(text)) return undefined;
    // Both self and peers use nearest Unix milliseconds, compared exactly.
    // Round in integer arithmetic: FILETIME exceeds Number's exact range.
    const ms = Number((BigInt(text) + 5000n) / 10000n - BigInt(FILETIME_UNIX_EPOCH_MS));
    if (!Number.isSafeInteger(ms) || ms <= 0) return undefined;
    return ms;
}

/**
 * @param {number} pid
 * @returns {number|undefined}
 */
export function probeWindowsProcessStartMs(pid, spawn = execFileSync, timeout = WINDOWS_PROBE_BUDGET_MS) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
    try {
        // One provider for self and peers; no CIM/WMIC fallback with different precision.
        const script = '& { param([long] $ownerPid) if ($ownerPid -le 0) { throw "Invalid pid" }; [System.Diagnostics.Process]::GetProcessById($ownerPid).StartTime.ToFileTimeUtc() }';
        if (startupTrace) { startupTrace.mark('powershell_spawn'); startupTrace.noteChildSpawn('powershell.exe'); }
        const stdout = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script, String(pid)], {
            timeout,
            windowsHide: true,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return parseFileTime(stdout);
    } catch {
        // Fail closed for this call; a later call may retry even after a timeout.
    }
    return undefined;
}

/**
 * @param {number} pid
 * @returns {number|undefined}
 */
function readWindowsProcessStartMs(pid, timeout) {
    if (process.platform !== 'win32') return undefined;
    if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
    if (pid === process.pid && windowsStartCache.has(pid)) return windowsStartCache.get(pid);
    const value = probeWindowsProcessStartMs(pid, execFileSync, timeout);
    // Cache only our own immutable start time; foreign PIDs can be reused.
    if (pid === process.pid && value !== undefined) windowsStartCache.set(pid, value);
    return value;
}

/**
 * @param {number} pid
 * @param {{ fs?: typeof fs, strict?: boolean }} [options]
 * @returns {{ bootId?: string, startTicks?: string, processStartMs?: number }}
 */
export function readProcessIdentity(pid, { fs: procFs = fs, strict = false, timeout = WINDOWS_PROBE_BUDGET_MS } = {}) {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
        if (strict) throw Object.assign(new Error('Invalid process pid'), { code: 'EINVAL' });
        return {};
    }
    if (process.platform === 'linux') {
        const identity = {};
        try {
            identity.bootId = procFs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
            identity.startTicks = parseLinuxStartTicks(procFs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
            if (!identity.bootId || identity.startTicks === undefined) throw Object.assign(new Error('Invalid Linux process identity'), { code: 'EIO', op: 'read' });
        } catch (error) {
            if (strict) throw error;
        }
        return identity;
    }
    const bootId = readBootId();
    const processStartMs = readWindowsProcessStartMs(pid, timeout);
    /** @type {{ bootId?: string, processStartMs?: number }} */
    const identity = {};
    if (bootId) identity.bootId = bootId;
    if (Number.isSafeInteger(processStartMs)) identity.processStartMs = processStartMs;
    return identity;
}

/**
 * Windows boot stamps are approximate. Exact ids still have to match.
 * `win-boot:` values within {@link WIN_BOOT_MATCH_TOLERANCE_SEC} seconds match.
 * @param {string} recorded
 * @param {string} current
 * @returns {boolean}
 */
export function bootIdsMatch(recorded, current) {
    if (recorded === current) return true;
    const recordedBoot = /^win-boot:(\d+)$/.exec(recorded);
    const currentBoot = /^win-boot:(\d+)$/.exec(current);
    if (!recordedBoot || !currentBoot) return false;
    return Math.abs(Number(recordedBoot[1]) - Number(currentBoot[1])) <= WIN_BOOT_MATCH_TOLERANCE_SEC;
}

/**
 * @param {number} pid
 * @returns {'alive'|'dead'|'eperm'|'unknown'}
 */
function signalPid(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return 'unknown';
    try {
        process.kill(pid, 0);
        return 'alive';
    } catch (error) {
        if (error && error.code === 'ESRCH') return 'dead';
        // Windows returns EPERM when the pid exists but cannot be signaled.
        if (error && error.code === 'EPERM') return 'eperm';
        // Any other failure fails closed so a live owner is not reclaimed.
        return 'unknown';
    }
}

/**
 * Whether `owner` still names the process that created it.
 * `dead` and `reused` may be reclaimed. `live` must be kept.
 * A lock with no boot id and no process start is live while the pid is alive.
 * Linux v2 records compare only boot id and raw ticks. Legacy Linux records
 * are kept while the PID exists. Windows uses CreationTime; approximate boot
 * stamps cannot authorize reclaim. Unavailable identity fails closed.
 * `observed` supplies a forged signal and identity for tests. Production
 * callers omit it and the live process table is probed.
 * @param {{ v?: number, pid: number, bootId?: string, startTicks?: string, processStartMs?: number }} owner
 * @param {{ signaled?: 'alive'|'dead'|'eperm'|'unknown', identity?: { bootId?: string, startTicks?: string, processStartMs?: number } }} [observed]
 * @returns {'live'|'dead'|'reused'}
 */
export function classifyPidLiveness(owner, observed) {
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return 'live';
    const signaled = observed && observed.signaled ? observed.signaled : signalPid(owner.pid);
    if (signaled === 'dead') return 'dead';
    if (signaled === 'unknown' || owner.v !== 2) return 'live';
    const recordedBoot = typeof owner.bootId === 'string' && owner.bootId.length > 0 ? owner.bootId : null;
    const recordedStart = Number.isSafeInteger(owner.processStartMs) ? owner.processStartMs : null;
    if (!recordedBoot && recordedStart === null) return 'live';
    /** @type {{ bootId?: string, startTicks?: string, processStartMs?: number }} */
    let current;
    if (observed && Object.prototype.hasOwnProperty.call(observed, 'identity')) {
        current = observed.identity || {};
    } else {
        try {
            current = readProcessIdentity(owner.pid);
        } catch {
            return 'live';
        }
    }
    if ((recordedBoot && !recordedBoot.startsWith('win-boot:')) || current.startTicks !== undefined) {
        if (!recordedBoot || !current.bootId) return 'live';
        if (recordedBoot !== current.bootId) return 'reused';
        if (typeof owner.startTicks !== 'string' || typeof current.startTicks !== 'string') return 'live';
        return owner.startTicks === current.startTicks ? 'live' : 'reused';
    }
    const currentBoot = typeof current.bootId === 'string' && current.bootId.length > 0 ? current.bootId : null;
    const currentStart = Number.isSafeInteger(current.processStartMs) ? current.processStartMs : null;
    // Process start is the stronger identity. A Windows boot stamp can move
    // while this pid is still the process that started at recordedStart.
    if (recordedStart !== null && currentStart !== null) {
        return recordedStart === currentStart ? 'live' : 'reused';
    }
    if (recordedStart !== null || currentStart !== null) return 'live';
    if (recordedBoot && currentBoot
        && !recordedBoot.startsWith('win-boot:') && !currentBoot.startsWith('win-boot:')
        && !bootIdsMatch(recordedBoot, currentBoot)) return 'reused';
    return 'live';
}
