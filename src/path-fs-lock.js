import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyPidLiveness, readProcessIdentity } from './process-identity.js';

/**
 * Cross-process lock files for exclusive path reservations.
 * Shared holders do not create these files. Readers of a finished file are
 * already protected by atomic replacement. Directory retirement and other
 * exclusive directory operations pass the directory key itself, so they take
 * a file here too.
 *
 * The lock name is a sha256 of the normalized path under `<root>/.st-path-locks/`,
 * which stays inside the data root and avoids putting the target path into
 * the filesystem name (Windows MAX_PATH). The holder creates it with O_EXCL,
 * keeps it for the critical section, then renames it aside and unlinks it
 * only when the bytes still match. A dead pid, or a live pid whose boot id
 * or process start no longer matches, is reclaimed by renaming that file
 * aside and deleting it only when the bytes are still the stale payload.
 * Another host's file is left in place. No compiler is required.
 *
 * A live holder is polled with capped backoff until {@link timeoutMs}. The
 * in-process queue has already chosen which reservation is waiting, so the
 * poll does not reorder local waiters. When the wait expires the caller gets
 * `path_lock_busy` instead of hanging.
 */

export const PATH_LOCK_DIRECTORY = '.st-path-locks';

/** Live cross-process holders are not waited on forever. */
export const DEFAULT_PATH_LOCK_TIMEOUT_MS = 15000;

const MAX_LOCK_BYTES = 4096;
const MAX_POLL_MS = 25;

export class PathLockError extends Error {
    /**
     * @param {'path_lock_busy'|'path_lock_unavailable'} reason
     */
    constructor(reason) {
        super(reason);
        this.name = 'PathLockError';
        this.reason = reason;
    }
}

/** @type {boolean} */
let enabled = false;
/** @type {string|null} */
let lockRoot = null;
/** @type {number} */
let timeoutMs = DEFAULT_PATH_LOCK_TIMEOUT_MS;
/** @type {boolean} */
let warned = false;

/**
 * Opt in, or pass `{ enabled: false }` to return to in-process locks only.
 * `root` is the directory that will contain `.st-path-locks`. It is not
 * created until an exclusive lock is taken.
 * @param {{ enabled?: boolean, root?: string, timeoutMs?: number }} [options]
 */
export function configureCrossProcessPathLocks(options = {}) {
    warned = false;
    if (!options || options.enabled !== true) {
        enabled = false;
        lockRoot = null;
        timeoutMs = DEFAULT_PATH_LOCK_TIMEOUT_MS;
        return;
    }
    if (typeof options.root !== 'string' || options.root.length === 0) {
        throw new TypeError('Cross-process path locks need a directory');
    }
    if (options.timeoutMs !== undefined) {
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
            throw new RangeError('Cross-process path lock timeout must be a non-negative number');
        }
        timeoutMs = options.timeoutMs;
    } else {
        timeoutMs = DEFAULT_PATH_LOCK_TIMEOUT_MS;
    }
    let root = path.resolve(options.root);
    try {
        root = fs.realpathSync(root);
    } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
    }
    lockRoot = root;
    enabled = true;
}

/** @returns {boolean} */
export function crossProcessPathLocksEnabled() {
    return enabled;
}

/**
 * Hashed lock path for an already normalized key. Null when the feature is off.
 * @param {string} key
 * @returns {string|null}
 */
export function exclusiveLockPathFor(key) {
    if (!lockRoot) return null;
    const digest = createHash('sha256').update(key).digest('hex');
    return path.join(lockRoot, PATH_LOCK_DIRECTORY, `${digest}.lock`);
}

/**
 * @param {Error|NodeJS.ErrnoException|undefined} error
 */
function warnOnce(error) {
    if (warned) return;
    warned = true;
    const detail = error && error.message ? error.message : String(error);
    console.warn(`Cross-process path lock could not be taken: ${detail}`);
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function readFlags() {
    let flags = fs.constants.O_RDONLY;
    if (process.platform !== 'win32' && fs.constants.O_NOFOLLOW) flags |= fs.constants.O_NOFOLLOW;
    return flags;
}

function exclusiveCreateFlags() {
    let flags = fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL;
    if (process.platform !== 'win32' && fs.constants.O_NOFOLLOW) flags |= fs.constants.O_NOFOLLOW;
    return flags;
}

/**
 * @param {number} fd
 * @returns {string}
 */
function readFd(fd) {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return '';
    if (size > MAX_LOCK_BYTES) {
        const error = new Error('path lock file is too large');
        error.code = 'EFBIG';
        throw error;
    }
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
        const read = fs.readSync(fd, buffer, offset, size - offset, offset);
        if (read === 0) break;
        offset += read;
    }
    return buffer.subarray(0, offset).toString('utf8');
}

/**
 * @param {string} filePath
 * @returns {{ status: 'ok', text: string }|{ status: 'missing' }|{ status: 'busy' }|{ status: 'symlink' }|{ status: 'not-file' }|{ status: 'environment', error: NodeJS.ErrnoException }}
 */
function readRegular(filePath) {
    /** @type {import('node:fs').Stats} */
    let listed;
    try {
        listed = fs.lstatSync(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') return { status: 'missing' };
        // Windows can return EPERM for a name another process is replacing.
        if (error.code === 'EPERM') return { status: 'busy' };
        return { status: 'environment', error };
    }
    if (listed.isSymbolicLink()) return { status: 'symlink' };
    if (!listed.isFile()) return { status: 'not-file' };
    if (listed.size > MAX_LOCK_BYTES) return { status: 'not-file' };
    let fd;
    try {
        fd = fs.openSync(filePath, readFlags());
    } catch (error) {
        if (error.code === 'ENOENT') return { status: 'missing' };
        if (error.code === 'EPERM') return { status: 'busy' };
        if (error.code === 'ELOOP') return { status: 'symlink' };
        if (error.code === 'EISDIR') return { status: 'not-file' };
        return { status: 'environment', error };
    }
    try {
        const opened = fs.fstatSync(fd);
        if (opened.ino && listed.ino && (opened.dev !== listed.dev || opened.ino !== listed.ino)) {
            return { status: 'symlink' };
        }
        return { status: 'ok', text: readFd(fd) };
    } catch (error) {
        return { status: 'environment', error };
    } finally {
        try { fs.closeSync(fd); } catch { /* bytes were already copied */ }
    }
}

/**
 * @param {string} filePath
 * @param {number} fd
 */
function unlinkIfSameFile(filePath, fd) {
    try {
        const opened = fs.fstatSync(fd);
        const listed = fs.lstatSync(filePath);
        if (listed.isSymbolicLink() || !listed.isFile()) return;
        if (!opened.ino || !listed.ino) return;
        if (opened.dev !== listed.dev || opened.ino !== listed.ino) return;
        fs.unlinkSync(filePath);
    } catch {
        // Leave the path. A later acquire can reclaim an empty file.
    }
}

/**
 * @param {string} uniquePath
 * @param {string} originalPath
 */
function restoreOrLeave(uniquePath, originalPath) {
    try {
        fs.linkSync(uniquePath, originalPath);
    } catch {
        return;
    }
    try { fs.unlinkSync(uniquePath); } catch { /* both names still hold the bytes */ }
}

/**
 * @param {string} key
 * @returns {string}
 */
function lockPayload(key) {
    const identity = readProcessIdentity(process.pid);
    /** @type {{ pid: number, hostname: string, startedAt: string, token: string, key: string, bootId?: string, processStartMs?: number }} */
    const record = {
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: new Date().toISOString(),
        token: randomUUID(),
        key,
    };
    if (identity.bootId) record.bootId = identity.bootId;
    if (Number.isSafeInteger(identity.processStartMs)) record.processStartMs = identity.processStartMs;
    return `${JSON.stringify(record)}\n`;
}

/**
 * @param {string} filePath
 * @param {string} payload
 * @returns {{ status: 'created' }|{ status: 'busy' }|{ status: 'refuse' }|{ status: 'environment', error: NodeJS.ErrnoException }}
 */
function createExclusive(filePath, payload) {
    let fd;
    try {
        fd = fs.openSync(filePath, exclusiveCreateFlags(), 0o644);
    } catch (error) {
        // Windows reports EPERM when the name exists and cannot be replaced.
        if (error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EAGAIN') {
            return { status: 'busy' };
        }
        if (error.code === 'ELOOP' || error.code === 'EISDIR') return { status: 'refuse' };
        return { status: 'environment', error };
    }
    try {
        const buffer = Buffer.from(payload, 'utf8');
        let offset = 0;
        while (offset < buffer.length) {
            const wrote = fs.writeSync(fd, buffer, offset, buffer.length - offset, offset);
            if (wrote <= 0) {
                const error = new Error(`Could not write ${filePath}`);
                error.code = 'EIO';
                unlinkIfSameFile(filePath, fd);
                return { status: 'environment', error };
            }
            offset += wrote;
        }
        fs.ftruncateSync(fd, buffer.length);
        fs.fsyncSync(fd);
    } catch (error) {
        unlinkIfSameFile(filePath, fd);
        return { status: 'environment', error };
    } finally {
        try { fs.closeSync(fd); } catch { /* the directory entry already has the bytes */ }
    }
    const seen = readRegular(filePath);
    if (seen.status === 'ok' && seen.text === payload) return { status: 'created' };
    if (seen.status === 'environment') return seen;
    if (seen.status === 'symlink' || seen.status === 'not-file') return { status: 'refuse' };
    if (seen.status === 'missing') return { status: 'busy' };
    // The new file could not be re-read (Windows EPERM). Remove it when the
    // moved bytes are still ours so a later acquire does not treat this process as the holder.
    const unique = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.unread`;
    try {
        fs.renameSync(filePath, unique);
    } catch {
        return { status: 'busy' };
    }
    const moved = readRegular(unique);
    if (moved.status === 'ok' && moved.text === payload) {
        try { fs.unlinkSync(unique); } catch { /* the canonical name is already clear */ }
        return { status: 'busy' };
    }
    restoreOrLeave(unique, filePath);
    return { status: 'busy' };
}

/**
 * @param {string} text
 * @param {string} key
 * @returns {'live'|'stale'}
 */
function classifyPayload(text, key) {
    if (text.length === 0) return 'stale';
    let owner;
    try {
        owner = JSON.parse(text);
    } catch {
        return 'stale';
    }
    if (!owner || typeof owner !== 'object' || Array.isArray(owner)) return 'stale';
    if (owner.key !== key) return 'stale';
    if (typeof owner.hostname !== 'string' || owner.hostname.length === 0) return 'stale';
    // Another host may still be the owner. Do not delete that file.
    if (owner.hostname !== os.hostname()) return 'live';
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) return 'stale';
    const liveness = classifyPidLiveness(owner);
    return liveness === 'live' ? 'live' : 'stale';
}

/**
 * @param {string} lockPath
 * @param {string} key
 * @returns {{ state: 'missing' }|{ state: 'live', text: string }|{ state: 'stale', text: string }|{ state: 'refuse' }|{ state: 'environment', error: NodeJS.ErrnoException }}
 */
function inspectLockFile(lockPath, key) {
    const seen = readRegular(lockPath);
    if (seen.status === 'missing') return { state: 'missing' };
    if (seen.status === 'busy') return { state: 'live', text: '' };
    if (seen.status === 'symlink' || seen.status === 'not-file') return { state: 'refuse' };
    if (seen.status !== 'ok') return { state: 'environment', error: seen.error };
    if (classifyPayload(seen.text, key) === 'stale') return { state: 'stale', text: seen.text };
    return { state: 'live', text: seen.text };
}

/**
 * @param {string} lockPath
 * @param {string} expectedText
 * @param {string} key
 * @returns {'removed'|'missing'|'changed'|'refuse'|'environment'}
 */
function takeStaleLock(lockPath, expectedText, key) {
    const unique = `${lockPath}.${process.pid}.${randomBytes(6).toString('hex')}.stale`;
    try {
        fs.renameSync(lockPath, unique);
    } catch (error) {
        if (error.code === 'ENOENT') return 'missing';
        return 'environment';
    }
    const seen = readRegular(unique);
    if (seen.status !== 'ok' || seen.text !== expectedText || classifyPayload(seen.text, key) !== 'stale') {
        restoreOrLeave(unique, lockPath);
        if (seen.status === 'symlink' || seen.status === 'not-file') return 'refuse';
        return seen.status === 'ok' ? 'changed' : 'environment';
    }
    try {
        fs.unlinkSync(unique);
    } catch {
        return 'environment';
    }
    return 'removed';
}

/**
 * @param {string} key
 * @returns {Promise<{ lockPath: string, payload: string }>}
 */
async function acquireOne(key) {
    const lockPath = exclusiveLockPathFor(key);
    if (!lockPath) throw new PathLockError('path_lock_unavailable');
    const payload = lockPayload(key);
    const deadline = Date.now() + timeoutMs;
    let waitMs = 5;
    for (;;) {
        const created = createExclusive(lockPath, payload);
        if (created.status === 'created') return { lockPath, payload };
        if (created.status === 'environment' && created.error && created.error.code === 'ENOENT') {
            try {
                fs.mkdirSync(path.dirname(lockPath), { recursive: true });
            } catch (error) {
                warnOnce(error);
                throw new PathLockError('path_lock_unavailable');
            }
            continue;
        }
        if (created.status === 'environment') {
            warnOnce(created.error);
            throw new PathLockError('path_lock_unavailable');
        }
        if (created.status === 'refuse') throw new PathLockError('path_lock_unavailable');
        const inspection = inspectLockFile(lockPath, key);
        if (inspection.state === 'missing') continue;
        if (inspection.state === 'refuse') throw new PathLockError('path_lock_unavailable');
        if (inspection.state === 'environment') {
            warnOnce(inspection.error);
            throw new PathLockError('path_lock_unavailable');
        }
        if (inspection.state === 'stale') {
            const taken = takeStaleLock(lockPath, inspection.text, key);
            if (taken === 'removed' || taken === 'missing') continue;
            if (taken === 'refuse') throw new PathLockError('path_lock_unavailable');
        }
        if (Date.now() >= deadline) throw new PathLockError('path_lock_busy');
        await delay(waitMs);
        waitMs = Math.min(waitMs * 2, MAX_POLL_MS);
    }
}

/**
 * Take exclusive filesystem locks in the already sorted key order.
 * The set is chosen by the caller before it waits, and this function does
 * not start a later key until the earlier one is held.
 * @param {string[]} keys
 * @returns {Promise<Array<{ lockPath: string, payload: string }>>}
 */
export async function acquireExclusivePathLocks(keys) {
    if (!enabled || keys.length === 0) return [];
    /** @type {Array<{ lockPath: string, payload: string }>} */
    const held = [];
    try {
        for (const key of keys) held.push(await acquireOne(key));
        return held;
    } catch (error) {
        releaseExclusivePathLocks(held);
        throw error;
    }
}

/**
 * @param {{ lockPath: string, payload: string }} held
 */
function releaseOne(held) {
    const unique = `${held.lockPath}.${process.pid}.${randomBytes(6).toString('hex')}.release`;
    try {
        fs.renameSync(held.lockPath, unique);
    } catch {
        return;
    }
    const seen = readRegular(unique);
    if (seen.status === 'ok' && seen.text === held.payload) {
        try { fs.unlinkSync(unique); } catch { /* the canonical name is already clear */ }
        return;
    }
    restoreOrLeave(unique, held.lockPath);
}

/**
 * Release in reverse acquisition order. A payload that is no longer ours is put back.
 * @param {Array<{ lockPath: string, payload: string }>|undefined} held
 */
export function releaseExclusivePathLocks(held) {
    if (!held || held.length === 0) return;
    for (let index = held.length - 1; index >= 0; index--) releaseOne(held[index]);
}
