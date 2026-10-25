import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Identity used to tell a live owner from a recycled pid.
 *
 * Linux records `/proc/sys/kernel/random/boot_id` and the process start time.
 * `starttime` in `/proc/<pid>/stat` is clock ticks since boot (USER_HZ is 100
 * on Linux). It is converted with `btime` from `/proc/stat`. `btime` is whole
 * seconds, so the result is stable for one process but only roughly aligned
 * with `Date.now()`.
 *
 * Windows has no portable boot id. The recorded value is
 * `win-boot:<unix-seconds>` from `Date.now() - os.uptime()`, and two samples
 * within 2 seconds still count as the same boot. That value can move if the
 * clock steps. Process start is a best-effort PowerShell `ToFileTime()` read,
 * or WMIC if PowerShell cannot be started. The probe is skipped unless it
 * stays under {@link WINDOWS_PROBE_BUDGET_MS}. A miss, a timeout, or a slow
 * host omits `processStartMs` and later checks do not retry. Same-boot pid
 * reuse then cannot be distinguished, and a live pid is kept (fail closed).
 * This probe never runs on other platforms and never invokes a compiler.
 */

/** USER_HZ for `/proc/<pid>/stat` starttime. It is the Linux ABI value, not the timer Hz. */
const LINUX_USER_HZ = 100;

/** Cold PowerShell/WMIC must finish inside this or the field is omitted. */
const WINDOWS_PROBE_BUDGET_MS = 200;

/** Windows FILETIME epoch (1601-01-01) to Unix epoch, in milliseconds. */
const FILETIME_UNIX_EPOCH_MS = 11644473600000;

/** @type {string|null|undefined} */
let cachedBootId;
/** @type {number|null|undefined} */
let cachedBtimeSeconds;
/** @type {boolean} */
let windowsProbeDisabled = false;
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
 * @returns {string|undefined}
 */
export function readBootId() {
    if (cachedBootId === undefined) cachedBootId = readBootIdUncached() ?? null;
    return cachedBootId ?? undefined;
}

/**
 * @returns {number|null}
 */
function readBtimeSeconds() {
    if (cachedBtimeSeconds !== undefined) return cachedBtimeSeconds;
    cachedBtimeSeconds = null;
    if (process.platform !== 'linux') return cachedBtimeSeconds;
    try {
        const text = fs.readFileSync('/proc/stat', 'utf8');
        const line = text.split('\n').find(entry => entry.startsWith('btime '));
        const value = line ? Number(line.slice('btime '.length).trim()) : Number.NaN;
        if (Number.isInteger(value) && value > 0) cachedBtimeSeconds = value;
    } catch {
        cachedBtimeSeconds = null;
    }
    return cachedBtimeSeconds;
}

/**
 * @param {number} pid
 * @returns {number|undefined}
 */
function readLinuxProcessStartMs(pid) {
    if (process.platform !== 'linux') return undefined;
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    let text;
    try {
        text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch {
        return undefined;
    }
    const end = text.lastIndexOf(')');
    if (end < 0) return undefined;
    const fields = text.slice(end + 2).trim().split(/\s+/);
    // Field 22 (starttime) is the 20th token after the comm field.
    const ticks = Number(fields[19]);
    if (!Number.isFinite(ticks) || ticks < 0) return undefined;
    const btime = readBtimeSeconds();
    if (btime == null) return undefined;
    return Math.round(btime * 1000 + (ticks * 1000) / LINUX_USER_HZ);
}

/**
 * @param {string} stdout
 * @returns {number|undefined}
 */
function parseFileTime(stdout) {
    const parsed = Number(String(stdout).trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    const ms = Math.round(parsed / 10000 - FILETIME_UNIX_EPOCH_MS);
    if (!Number.isSafeInteger(ms) || ms <= 0) return undefined;
    return ms;
}

/**
 * @param {string} stdout
 * @returns {number|undefined}
 */
function parseWmicCreation(stdout) {
    const match = String(stdout).match(/CreationDate=(\d{14})\.(\d+)/);
    if (!match) return undefined;
    const digits = match[1];
    const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}Z`;
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
}

/**
 * @param {number} pid
 * @returns {number|undefined}
 */
function probeWindowsProcessStartMs(pid) {
    const started = Date.now();
    try {
        const script = `$p = Get-Process -Id ${pid} -ErrorAction Stop; $p.StartTime.ToFileTime()`;
        const stdout = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            timeout: WINDOWS_PROBE_BUDGET_MS,
            windowsHide: true,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const parsed = parseFileTime(stdout);
        if (parsed !== undefined) return parsed;
    } catch (error) {
        if (error && (error.code === 'ETIMEDOUT' || error.code === 'ENOENT')) {
            if (Date.now() - started >= WINDOWS_PROBE_BUDGET_MS || error.code === 'ETIMEDOUT') {
                windowsProbeDisabled = true;
                return undefined;
            }
        }
    }
    if (Date.now() - started >= WINDOWS_PROBE_BUDGET_MS) {
        windowsProbeDisabled = true;
        return undefined;
    }
    try {
        const stdout = execFileSync('wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CreationDate', '/value'], {
            timeout: Math.max(1, WINDOWS_PROBE_BUDGET_MS - (Date.now() - started)),
            windowsHide: true,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return parseWmicCreation(stdout);
    } catch {
        windowsProbeDisabled = true;
        return undefined;
    }
}

/**
 * @param {number} pid
 * @returns {number|undefined}
 */
function readWindowsProcessStartMs(pid) {
    if (process.platform !== 'win32') return undefined;
    if (windowsProbeDisabled) return undefined;
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    if (windowsStartCache.has(pid)) return windowsStartCache.get(pid);
    const value = probeWindowsProcessStartMs(pid);
    // Cache only a hit. A miss disables the probe entirely so startup is not blocked again.
    if (value !== undefined) windowsStartCache.set(pid, value);
    return value;
}

/**
 * @param {number} pid
 * @returns {{ bootId?: string, processStartMs?: number }}
 */
export function readProcessIdentity(pid) {
    const bootId = readBootId();
    const processStartMs = readLinuxProcessStartMs(pid) ?? readWindowsProcessStartMs(pid);
    /** @type {{ bootId?: string, processStartMs?: number }} */
    const identity = {};
    if (bootId) identity.bootId = bootId;
    if (Number.isSafeInteger(processStartMs)) identity.processStartMs = processStartMs;
    return identity;
}

/**
 * Windows boot stamps are approximate. Exact ids still have to match.
 * @param {string} recorded
 * @param {string} current
 * @returns {boolean}
 */
export function bootIdsMatch(recorded, current) {
    if (recorded === current) return true;
    const recordedBoot = /^win-boot:(\d+)$/.exec(recorded);
    const currentBoot = /^win-boot:(\d+)$/.exec(current);
    if (!recordedBoot || !currentBoot) return false;
    return Math.abs(Number(recordedBoot[1]) - Number(currentBoot[1])) <= 2;
}

/**
 * @param {number} pid
 * @returns {'alive'|'dead'|'eperm'|'unknown'}
 */
function signalPid(pid) {
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
 * Identity that cannot be re-read is live as well.
 * @param {{ pid: number, bootId?: string, processStartMs?: number }} owner
 * @returns {'live'|'dead'|'reused'}
 */
export function classifyPidLiveness(owner) {
    const signaled = signalPid(owner.pid);
    if (signaled === 'dead') return 'dead';
    if (signaled === 'unknown') return 'live';
    const recordedBoot = typeof owner.bootId === 'string' && owner.bootId.length > 0 ? owner.bootId : null;
    const recordedStart = Number.isSafeInteger(owner.processStartMs) ? owner.processStartMs : null;
    if (!recordedBoot && recordedStart === null) return 'live';
    let current;
    try {
        current = readProcessIdentity(owner.pid);
    } catch {
        return 'live';
    }
    const currentBoot = typeof current.bootId === 'string' && current.bootId.length > 0 ? current.bootId : null;
    const currentStart = Number.isSafeInteger(current.processStartMs) ? current.processStartMs : null;
    if (recordedBoot && currentBoot && !bootIdsMatch(recordedBoot, currentBoot)) return 'reused';
    if (recordedStart !== null && currentStart !== null && recordedStart !== currentStart) return 'reused';
    if ((recordedBoot && !currentBoot) || (recordedStart !== null && currentStart === null)) return 'live';
    return 'live';
}
