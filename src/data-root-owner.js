import { randomBytes, randomUUID } from 'node:crypto';
import defaultFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyPidLiveness, readProcessIdentity } from './process-identity.js';

// Acquisition is synchronous; restore the production filesystem before returning.
let fs = defaultFs;

/** Name of the exclusive data-root owner file inside the data root. */
export const DATA_ROOT_OWNER_LOCK = '.st-lab-owner.lock';

/**
 * Sibling created with O_EXCL so only one process may reclaim a stale owner.
 * An expired marker can be reclaimed only after its process is confirmed dead.
 */
export const DATA_ROOT_OWNER_RECLAIM = '.st-lab-owner.lock.reclaim';

/**
 * Minimum age before a dead process's reclaim marker can be taken over.
 * A crashed reclaimer cannot hold the data root shut forever.
 */
export const DATA_ROOT_RECLAIM_TIMEOUT_MS = 10000;

/** Owner and reclaim payloads are small JSON records. Anything larger is corrupt. */
const MAX_LOCK_BYTES = 4096;

const ACQUIRE_ATTEMPTS = 50;
const ACQUIRE_PAUSE_MS = 10;

/**
 * Opt-in ownership of one data root directory.
 * This is not per-file cross-process locking. The owner file records pid,
 * host, start time, a random token, and the boot id and process start time
 * when this host can provide them. The first process creates it with O_EXCL.
 * `process.kill(pid, 0)` is not enough: the kernel may have reused that pid.
 * A same-host owner is reclaimed when the pid is dead (ESRCH) or when the
 * pid still signals alive but the boot id or process start time disagrees.
 * EPERM with a matching identity is a live owner and is refused. A lock that
 * has neither identity field is kept while its pid is alive, so older locks
 * fail closed. Reclaim is single-winner: one process claims
 * `.st-lab-owner.lock.reclaim` with O_EXCL (or takes over an expired marker
 * by renaming that marker aside and checking it), renames the stale owner
 * file to a unique name, and deletes it only when the bytes still match.
 * It then creates the new owner file with O_EXCL. Another host, a symlink,
 * or a corrupt payload is left in place. On a normal exit, process.exit, or
 * an uncaught exception, the owner file is removed only when its bytes still
 * match. A signal that skips the exit hook can leave the file; the next
 * acquire on this host reclaims it. No compiler or native addon is required.
 * If ownership cannot be verified, acquisition throws and startup must stop.
 */
export class DataRootOwnershipError extends Error {
    /**
     * @param {string} message
     * @param {'ELOCKED'|'ECORRUPT'|'EREAD'} code
     */
    constructor(message, code) {
        super(message);
        this.name = 'DataRootOwnershipError';
        this.code = code;
    }
}

export class DataRootOwnershipUnverifiedError extends DataRootOwnershipError {
    /**
     * @param {NodeJS.ErrnoException & { op?: string }} cause
     * @param {string} lockPath
     */
    constructor(cause, lockPath) {
        super(`Data-root ownership could not be determined at ${lockPath}: ${cause.message}. Verify the owner process is really gone, then delete ${lockPath}.`, 'EREAD');
        this.name = 'DataRootOwnershipUnverifiedError';
        this.cause = cause;
        this.op = cause.syscall || cause.op || 'acquire';
        this.lockPath = lockPath;
    }
}

/** @type {string|null} */
let ownedPath = null;
/** @type {string|null} */
let ownedPayload = null;
/** @type {string|null} Pending cleanup retained when restoration fails. */
let ownedReleasePath = null;
/** @type {(() => void)|null} */
let releaseHook = null;
const pauseBuffer = new Int32Array(new SharedArrayBuffer(4));

/**
 * @param {string} text
 * @returns {{ kind: 'empty' }|{ kind: 'corrupt' }|{ kind: 'owner', owner: { pid: number, hostname: string, startedAt: string, v?: number, token?: string, bootId?: string, startTicks?: string, processStartMs?: number }, text: string }}
 */
function classifyOwner(text) {
    if (text.length === 0) return { kind: 'empty' };
    try {
        const owner = JSON.parse(text);
        if (!owner || typeof owner !== 'object' || Array.isArray(owner)) return { kind: 'corrupt' };
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) return { kind: 'corrupt' };
        if (typeof owner.hostname !== 'string' || owner.hostname.length === 0) return { kind: 'corrupt' };
        if (typeof owner.startedAt !== 'string' || owner.startedAt.length === 0) return { kind: 'corrupt' };
        if (Object.prototype.hasOwnProperty.call(owner, 'token')) {
            if (typeof owner.token !== 'string' || owner.token.length === 0 || owner.token.length > 128) return { kind: 'corrupt' };
        }
        if (Object.prototype.hasOwnProperty.call(owner, 'bootId')) {
            if (typeof owner.bootId !== 'string' || owner.bootId.length === 0 || owner.bootId.length > 256) return { kind: 'corrupt' };
        }
        if (owner.startTicks !== undefined && (typeof owner.startTicks !== 'string' || !/^(0|[1-9]\d*)$/.test(owner.startTicks))) return { kind: 'corrupt' };
        if (Object.prototype.hasOwnProperty.call(owner, 'processStartMs')) {
            if (!Number.isSafeInteger(owner.processStartMs) || owner.processStartMs < 0) return { kind: 'corrupt' };
        }
        return { owner, text, kind: 'owner' };
    } catch {
        return { kind: 'corrupt' };
    }
}

/**
 * @param {number} ms
 */
function pause(ms) {
    Atomics.wait(pauseBuffer, 0, 0, ms);
}

/**
 * @param {string} filePath
 * @param {string} label
 * @returns {string}
 */
function uniqueSibling(filePath, _label) {
    return path.join(path.dirname(filePath), `.c${randomBytes(6).toString('hex')}`);
}

function readFlags() {
    let flags = fs.constants.O_RDONLY;
    // Windows open does not implement O_NOFOLLOW. Callers lstat first.
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
        const error = new Error('lock file is too large');
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
 * Read a regular file without following a symlink.
 * @param {string} filePath
 * @returns {{ status: 'ok', text: string }|{ status: 'missing' }|{ status: 'symlink' }|{ status: 'not-file' }|{ status: 'environment', error: NodeJS.ErrnoException }}
 */
function readRegularFile(filePath) {
    /** @type {import('node:fs').Stats} */
    let listed;
    try {
        listed = fs.lstatSync(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') return { status: 'missing' };
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
        try { fs.closeSync(fd); } catch { /* the bytes were already copied */ }
    }
}

/**
 * Delete `filePath` only when it is still the inode `fd` has open.
 * Used after a failed exclusive create so a partial file we just created
 * does not stick. A zero inode (some Windows stats) is not deleted.
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
        // Leave the path. An empty owner file can be reclaimed later.
    }
}

/**
 * Put `uniquePath` back at `originalPath` only when that name is absent.
 * Hard link fails with EEXIST instead of replacing a file someone else created.
 * Never unlinks `uniquePath` when the restore did not happen.
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
 * @param {string} filePath
 * @param {string} payload
 * @returns {{ status: 'created' }|{ status: 'exists' }|{ status: 'lost' }|{ status: 'symlink' }|{ status: 'not-file' }|{ status: 'environment', error: NodeJS.ErrnoException }}
 */
function createExclusiveFile(filePath, payload) {
    let fd;
    try {
        fd = fs.openSync(filePath, exclusiveCreateFlags(), 0o644);
    } catch (error) {
        if (error.code === 'EEXIST') return { status: 'exists' };
        if (error.code === 'ELOOP') return { status: 'symlink' };
        if (error.code === 'EISDIR') return { status: 'not-file' };
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
    const seen = readRegularFile(filePath);
    if (seen.status === 'ok' && seen.text === payload) return { status: 'created' };
    if (seen.status === 'environment') return seen;
    // The new inode was renamed away or replaced before we published it.
    return { status: 'lost' };
}

/**
 * @param {number} mtimeMs
 * @returns {number}
 */
function markerAgeMs(mtimeMs) {
    if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return DATA_ROOT_RECLAIM_TIMEOUT_MS;
    return Date.now() - mtimeMs;
}

/**
 * @param {string} reclaimPath
 * @param {string|null} ourPayload
 * @returns {{ state: 'absent' }|{ state: 'ours' }|{ state: 'foreign' }|{ state: 'stale', text: string }|{ state: 'refuse', error: DataRootOwnershipError }|{ state: 'environment', error: NodeJS.ErrnoException }}
 */
function reclaimMarkerState(reclaimPath, ourPayload) {
    /** @type {import('node:fs').Stats} */
    let listed;
    try {
        listed = fs.lstatSync(reclaimPath);
    } catch (error) {
        if (error.code === 'ENOENT') return { state: 'absent' };
        return { state: 'environment', error };
    }
    if (listed.isSymbolicLink() || !listed.isFile()) {
        return { state: 'refuse', error: reclaimLeftInPlace(reclaimPath) };
    }
    const seen = readRegularFile(reclaimPath);
    if (seen.status === 'missing') return { state: 'absent' };
    if (seen.status === 'symlink' || seen.status === 'not-file') {
        return { state: 'refuse', error: reclaimLeftInPlace(reclaimPath) };
    }
    if (seen.status !== 'ok') return { state: 'environment', error: seen.error };
    if (markerAgeMs(listed.mtimeMs) >= DATA_ROOT_RECLAIM_TIMEOUT_MS && reclaimProcessIsDead(seen.text)) {
        return { state: 'stale', text: seen.text };
    }
    if (ourPayload && seen.text === ourPayload) return { state: 'ours' };
    return { state: 'foreign' };
}

/**
 * A timeout alone cannot revoke a paused process's right to rename the owner.
 * Legacy markers use claimedAt instead of startedAt and lack kernel identity.
 * Unknown or foreign processes fail closed.
 * @param {string} text
 * @returns {boolean}
 */
function reclaimProcessIsDead(text) {
    try {
        const record = JSON.parse(text);
        const marker = classifyOwner(JSON.stringify({ ...record, startedAt: record.startedAt || record.claimedAt }));
        return marker.kind === 'owner' && marker.owner.hostname === os.hostname()
            && classifyPidLiveness(marker.owner, { identity: readProcessIdentity(marker.owner.pid, { fs }) }) !== 'live';
    } catch {
        return false;
    }
}

/**
 * @param {string} reclaimPath
 * @returns {DataRootOwnershipError}
 */
function reclaimLeftInPlace(reclaimPath) {
    return new DataRootOwnershipError(`Data-root reclaim lock at ${reclaimPath} was left in place.`, 'ECORRUPT');
}

/**
 * @param {string} lockPath
 * @returns {DataRootOwnershipError}
 */
function symlinkLeftInPlace(lockPath) {
    return new DataRootOwnershipError(`Data-root owner lock at ${lockPath} is a link and was left in place.`, 'ECORRUPT');
}

/**
 * @param {string} lockPath
 * @returns {DataRootOwnershipError}
 */
function corruptLeftInPlace(lockPath) {
    return new DataRootOwnershipError(`Data-root owner lock at ${lockPath} is unreadable and was left in place.`, 'ECORRUPT');
}

/**
 * @param {string} resolved
 * @param {{ pid: number, hostname: string, startedAt: string, v?: number, token?: string, bootId?: string, startTicks?: string, processStartMs?: number }} owner
 * @returns {DataRootOwnershipError}
 */
function lockedError(resolved, owner) {
    return new DataRootOwnershipError(
        `Data root ${resolved} is owned by pid ${owner.pid} on ${owner.hostname} since ${owner.startedAt}. Another process must not share this data root.${owner.v !== 2 ? ' Legacy owner record: live PID cannot be safely reclaimed.' : ''} Lock file: ${path.join(resolved, DATA_ROOT_OWNER_LOCK)}. Verify the owner process is really gone, then delete ${path.join(resolved, DATA_ROOT_OWNER_LOCK)}.`,
        'ELOCKED',
    );
}

/**
 * @param {string} lockPath
 * @param {string} resolved
 * @returns {{ action: 'missing' }|{ action: 'reclaim', text: string }|{ action: 'refuse', error: DataRootOwnershipError }|{ action: 'environment', error: NodeJS.ErrnoException }}
 */
function inspectLock(lockPath, resolved) {
    const seen = readRegularFile(lockPath);
    if (seen.status === 'missing') return { action: 'missing' };
    if (seen.status === 'symlink') return { action: 'refuse', error: symlinkLeftInPlace(lockPath) };
    if (seen.status === 'not-file') return { action: 'refuse', error: corruptLeftInPlace(lockPath) };
    if (seen.status !== 'ok') return { action: 'environment', error: seen.error };
    const classified = classifyOwner(seen.text);
    if (classified.kind === 'corrupt') return { action: 'refuse', error: corruptLeftInPlace(lockPath) };
    if (classified.kind === 'empty') return { action: 'reclaim', text: seen.text };
    if (classified.owner.hostname !== os.hostname()) {
        return { action: 'refuse', error: lockedError(resolved, classified.owner) };
    }
    const liveness = classifyPidLiveness(classified.owner, { identity: readProcessIdentity(classified.owner.pid, { fs }) });
    if (liveness === 'live') {
        return { action: 'refuse', error: lockedError(resolved, classified.owner) };
    }
    return { action: 'reclaim', text: seen.text };
}

/**
 * Payload for a new owner. Identity fields are omitted when this host cannot
 * read them. Callers that later see a live pid and no identity keep the lock.
 * @param {number} pid
 * @param {string} hostname
 * @param {string} startedAt
 * @returns {string}
 */
function ownerPayload(pid, hostname, startedAt) {
    const identity = readProcessIdentity(pid, { fs, strict: true });
    /** @type {{ pid: number, hostname: string, startedAt: string, v: number, token: string, bootId?: string, startTicks?: string, processStartMs?: number }} */
    const record = { v: 2, pid, hostname, startedAt, token: randomUUID() };
    if (identity.startTicks !== undefined) record.startTicks = identity.startTicks;
    if (identity.bootId) record.bootId = identity.bootId;
    if (Number.isSafeInteger(identity.processStartMs)) record.processStartMs = identity.processStartMs;
    return `${JSON.stringify(record)}\n`;
}

function reclaimPayload() {
    return ownerPayload(process.pid, os.hostname(), new Date().toISOString());
}

/**
 * @param {string} reclaimPath
 * @param {string} observedText
 * @param {string} payload
 * @returns {{ status: 'held', payload: string }|{ status: 'busy' }|{ status: 'refuse', error: DataRootOwnershipError }|{ status: 'environment', error: NodeJS.ErrnoException }}
 */
function takeoverStaleMarker(reclaimPath, observedText, payload) {
    const unique = uniqueSibling(reclaimPath, 'reclaim');
    try {
        fs.renameSync(reclaimPath, unique);
    } catch (error) {
        if (error.code === 'ENOENT') return { status: 'busy' };
        return { status: 'environment', error };
    }
    const seen = readRegularFile(unique);
    if (seen.status !== 'ok') {
        restoreOrLeave(unique, reclaimPath);
        if (seen.status === 'environment') return { status: 'environment', error: seen.error };
        return { status: 'refuse', error: reclaimLeftInPlace(reclaimPath) };
    }
    let ageMs;
    try {
        ageMs = markerAgeMs(fs.lstatSync(unique).mtimeMs);
    } catch (error) {
        restoreOrLeave(unique, reclaimPath);
        if (error.code === 'ENOENT') return { status: 'busy' };
        return { status: 'environment', error };
    }
    if (seen.text !== observedText || ageMs < DATA_ROOT_RECLAIM_TIMEOUT_MS || !reclaimProcessIsDead(seen.text)) {
        restoreOrLeave(unique, reclaimPath);
        return { status: 'busy' };
    }
    try {
        fs.unlinkSync(unique);
    } catch (error) {
        // The canonical name is already gone. Leave the unique file if unlink failed.
        return { status: 'environment', error };
    }
    const created = createExclusiveFile(reclaimPath, payload);
    if (created.status === 'created') return { status: 'held', payload };
    if (created.status === 'exists' || created.status === 'lost') return { status: 'busy' };
    if (created.status === 'symlink' || created.status === 'not-file') {
        return { status: 'refuse', error: reclaimLeftInPlace(reclaimPath) };
    }
    return { status: 'environment', error: created.error };
}

/**
 * @param {string} reclaimPath
 * @returns {{ status: 'held', payload: string }|{ status: 'busy' }|{ status: 'refuse', error: DataRootOwnershipError }|{ status: 'environment', error: NodeJS.ErrnoException }}
 */
function claimReclaimMarker(reclaimPath) {
    const payload = reclaimPayload();
    const created = createExclusiveFile(reclaimPath, payload);
    if (created.status === 'created') return { status: 'held', payload };
    if (created.status === 'environment') return created;
    if (created.status === 'symlink' || created.status === 'not-file') {
        return { status: 'refuse', error: reclaimLeftInPlace(reclaimPath) };
    }
    if (created.status === 'lost') return { status: 'busy' };
    const marker = reclaimMarkerState(reclaimPath, payload);
    if (marker.state === 'absent' || marker.state === 'foreign') return { status: 'busy' };
    if (marker.state === 'ours') return { status: 'held', payload };
    if (marker.state === 'refuse') return { status: 'refuse', error: marker.error };
    if (marker.state === 'environment') return { status: 'environment', error: marker.error };
    return takeoverStaleMarker(reclaimPath, marker.text, payload);
}

/**
 * Rename the owner file aside and delete it only when the bytes are still
 * `expectedText`. The caller must already hold the reclaim marker.
 * @param {string} lockPath
 * @param {string} expectedText
 * @returns {{ status: 'removed' }|{ status: 'missing' }|{ status: 'changed' }|{ status: 'refuse', error: DataRootOwnershipError }|{ status: 'environment', error: NodeJS.ErrnoException }}
 */
function takeVerifiedStaleLock(lockPath, expectedText) {
    const unique = uniqueSibling(lockPath, 'stale');
    try {
        fs.renameSync(lockPath, unique);
    } catch (error) {
        if (error.code === 'ENOENT') return { status: 'missing' };
        return { status: 'environment', error };
    }
    const seen = readRegularFile(unique);
    if (seen.status !== 'ok') {
        restoreOrLeave(unique, lockPath);
        if (seen.status === 'environment') return { status: 'environment', error: seen.error };
        if (seen.status === 'symlink') return { status: 'refuse', error: symlinkLeftInPlace(lockPath) };
        return { status: 'refuse', error: corruptLeftInPlace(lockPath) };
    }
    if (seen.text !== expectedText) {
        restoreOrLeave(unique, lockPath);
        return { status: 'changed' };
    }
    try {
        fs.unlinkSync(unique);
    } catch (error) {
        return { status: 'environment', error };
    }
    return { status: 'removed' };
}

/**
 * @param {string} reclaimPath
 * @param {string|null} payload
 */
function releaseReclaimIfOurs(reclaimPath, payload) {
    if (!payload) return;
    const unique = uniqueSibling(reclaimPath, 'done');
    try {
        fs.renameSync(reclaimPath, unique);
    } catch {
        return;
    }
    const seen = readRegularFile(unique);
    if (seen.status === 'ok' && seen.text === payload) {
        try { fs.unlinkSync(unique); } catch { /* the marker is no longer at the canonical path */ }
        return;
    }
    restoreOrLeave(unique, reclaimPath);
}

/**
 * @param {string} lockPath
 * @param {string} payload
 */
function installRelease(lockPath, payload) {
    ownedPath = lockPath;
    ownedPayload = payload;
    releaseHook = () => {
        try {
            releaseOwnedLock(true);
        } catch {
            // An exit hook must not throw.
        }
    };
    process.on('exit', releaseHook);
}

/**
 * Remove this process's owner file only when the renamed bytes still match.
 * @param {boolean} swallow
 */
function releaseOwnedLock(swallow) {
    if (!ownedPath) return;
    const lockPath = ownedPath;
    const payload = ownedPayload;
    const unique = ownedReleasePath || uniqueSibling(lockPath, 'release');
    try {
        if (!ownedReleasePath) fs.renameSync(lockPath, unique);
        ownedReleasePath = unique;
    } catch (error) {
        if (error.code === 'ENOENT') {
            clearRelease();
            return;
        }
        if (swallow) return;
        throw error;
    }
    const seen = readRegularFile(unique);
    if (seen.status === 'ok' && seen.text === payload) {
        try {
            fs.unlinkSync(unique);
        } catch (error) {
            restoreOrLeave(unique, lockPath);
            if (readRegularFile(unique).status === 'missing') ownedReleasePath = null;
            if (!swallow) throw error;
            return;
        }
        clearRelease();
        return;
    }
    restoreOrLeave(unique, lockPath);
    if (readRegularFile(unique).status === 'missing') ownedReleasePath = null;
    if (seen.status === 'environment') {
        if (!swallow) throw seen.error;
        return;
    }
    clearRelease();
}

function clearRelease() {
    ownedReleasePath = null;
    ownedPath = null;
    ownedPayload = null;
    if (releaseHook) {
        process.removeListener('exit', releaseHook);
        releaseHook = null;
    }
}

/** Remove this process's owner file when its contents are still the payload it wrote. */
export function releaseDataRootOwnership() {
    releaseOwnedLock(false);
}

/**
 * Create `<dataRoot>/.st-lab-owner.lock` and keep this process as its owner.
 * @param {string} dataRoot
 * @param {{ fs?: typeof defaultFs }} [options]
 * @returns {{ lockPath: string, pid: number, hostname: string, startedAt: string, v?: number, token?: string, bootId?: string, startTicks?: string, processStartMs?: number }}
 */
export function acquireDataRootOwnership(dataRoot, { fs: injectedFs = defaultFs } = {}) {
    const previous = fs;
    fs = new Proxy(injectedFs, {
        get(target, key) {
            const value = target[key];
            if (typeof value !== 'function') return value;
            return (...args) => {
                try { return value.apply(target, args); }
                catch (error) {
                    if (!error.op) error.op = String(key).replace(/Sync$/, '');
                    throw error;
                }
            };
        },
    });
    try {
        return acquireOwnership(dataRoot);
    } finally {
        fs = previous;
    }
}

function acquireOwnership(dataRoot) {
    if (typeof dataRoot !== 'string' || dataRoot.length === 0) {
        throw new TypeError('Data root must be a non-empty string');
    }
    if (ownedPath) {
        throw new DataRootOwnershipError(`This process already owns ${ownedPath}.`, 'ELOCKED');
    }
    let subject = dataRoot;
    try {
        const resolved = path.resolve(dataRoot);
        subject = resolved;
        fs.mkdirSync(resolved, { recursive: true });
        const real = fs.realpathSync(resolved);
        subject = real;
        return acquireResolved(real);
    } catch (error) {
        if (error instanceof DataRootOwnershipError || error instanceof TypeError) throw error;
        if (error && typeof error.code === 'string') {
            throw new DataRootOwnershipUnverifiedError(error, path.join(subject, DATA_ROOT_OWNER_LOCK));
        }
        throw error;
    }
}

/**
 * @param {string} resolved
 * @returns {{ lockPath: string, pid: number, hostname: string, startedAt: string, v?: number, token?: string, bootId?: string, startTicks?: string, processStartMs?: number }}
 */
function acquireResolved(resolved) {
    const lockPath = path.join(resolved, DATA_ROOT_OWNER_LOCK);
    const reclaimPath = path.join(resolved, DATA_ROOT_OWNER_RECLAIM);
    const startedAt = new Date().toISOString();
    const hostname = os.hostname();
    const pid = process.pid;
    let payload;
    try { payload = ownerPayload(pid, hostname, startedAt); }
    catch (error) { throw new DataRootOwnershipUnverifiedError(error, lockPath); }
    const record = JSON.parse(payload);
    /** @type {string|null} */
    let heldReclaim = null;
    const finishHeld = () => {
        const mine = heldReclaim;
        heldReclaim = null;
        releaseReclaimIfOurs(reclaimPath, mine);
    };
    const giveUp = (error) => {
        finishHeld();
        throw new DataRootOwnershipUnverifiedError(error, lockPath);
    };
    try {
        for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt++) {
            const marker = reclaimMarkerState(reclaimPath, heldReclaim);
            if (marker.state === 'refuse') {
                finishHeld();
                throw marker.error;
            }
            if (marker.state === 'environment') return giveUp(marker.error);
            if (marker.state === 'foreign') {
                heldReclaim = null;
                pause(ACQUIRE_PAUSE_MS);
                continue;
            }

            const created = createExclusiveFile(lockPath, payload);
            if (created.status === 'created') {
                finishHeld();
                installRelease(lockPath, payload);
                return {
                    lockPath,
                    pid,
                    hostname,
                    startedAt,
                    v: 2,
                    startTicks: record.startTicks,
                    token: record.token,
                    bootId: record.bootId,
                    processStartMs: record.processStartMs,
                };
            }
            if (created.status === 'environment') return giveUp(created.error);
            if (created.status === 'symlink') {
                finishHeld();
                throw symlinkLeftInPlace(lockPath);
            }
            if (created.status === 'not-file') {
                finishHeld();
                throw corruptLeftInPlace(lockPath);
            }
            if (created.status === 'lost') {
                pause(ACQUIRE_PAUSE_MS);
                continue;
            }

            const inspection = inspectLock(lockPath, resolved);
            if (inspection.action === 'missing') {
                pause(ACQUIRE_PAUSE_MS);
                continue;
            }
            if (inspection.action === 'environment') return giveUp(inspection.error);
            if (inspection.action === 'refuse') {
                finishHeld();
                throw inspection.error;
            }

            if (marker.state !== 'ours') {
                const claim = claimReclaimMarker(reclaimPath);
                if (claim.status === 'environment') return giveUp(claim.error);
                if (claim.status === 'refuse') {
                    finishHeld();
                    throw claim.error;
                }
                if (claim.status !== 'held') {
                    pause(ACQUIRE_PAUSE_MS);
                    continue;
                }
                heldReclaim = claim.payload;
            }

            const still = reclaimMarkerState(reclaimPath, heldReclaim);
            if (still.state !== 'ours') {
                heldReclaim = null;
                pause(ACQUIRE_PAUSE_MS);
                continue;
            }
            const again = inspectLock(lockPath, resolved);
            if (again.action === 'reclaim' && again.text === inspection.text) {
                const taken = takeVerifiedStaleLock(lockPath, again.text);
                if (taken.status === 'removed' || taken.status === 'missing') continue;
                if (taken.status === 'environment') return giveUp(taken.error);
                if (taken.status === 'refuse') {
                    finishHeld();
                    throw taken.error;
                }
                finishHeld();
                continue;
            }
            finishHeld();
            if (again.action === 'refuse') throw again.error;
            if (again.action === 'environment') return giveUp(again.error);
            pause(ACQUIRE_PAUSE_MS);
        }
        finishHeld();
        throw new DataRootOwnershipError(`Could not acquire data-root owner lock at ${lockPath}.`, 'ELOCKED');
    } catch (error) {
        finishHeld();
        if (error instanceof DataRootOwnershipError || error instanceof TypeError) throw error;
        if (error && typeof error.code === 'string') return giveUp(error);
        throw error;
    }
}
