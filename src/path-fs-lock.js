import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyPidLiveness, readProcessIdentity } from './process-identity.js';

/**
 * Cross-process locks for path reservations.
 *
 * Exclusive keys use one O_EXCL file, `<sha256>.exclusive`. Shared keys, including
 * the parent directory of an exclusive file, use one O_EXCL file per holder,
 * `<sha256>.shared.<token>`. Holders of the same shared key coexist. An exclusive
 * acquire waits until that hash has no live `.shared.*` file, and a shared acquire
 * waits until `<sha256>.exclusive` is gone. After either create, the caller checks
 * the other side again and drops its file if the other side won the race.
 *
 * Storage is selected once as the host-local temporary directory
 * `os.tmpdir()/st-lab-path-locks/<sha256(dataRoot)>/` (mode 0o700).
 * Acquisitions serialize inspection and publication with per-key directory
 * gates. Abandoned gates fail closed and require offline operator cleanup.
 *
 * A symlink, a non-regular file, or a file larger than {@link MAX_LOCK_BYTES} that
 * is older than {@link LOCK_QUARANTINE_MIN_AGE_MS} is renamed into `.quarantine`
 * and the create is retried once. A regular file with a live JSON identity is not
 * removed. Dead and reused holders are reclaimed by the same identity rules as
 * before. Another host's file is left in place. No compiler is required.
 *
 * Keys are taken in sorted order after the in-process grants. A live holder is
 * polled with capped backoff until {@link timeoutMs}, then the caller gets
 * `path_lock_busy`.
 */

export const PATH_LOCK_DIRECTORY = '.st-path-locks';

export const PATH_LOCK_QUARANTINE_DIRECTORY = '.quarantine';

/** Live cross-process holders are not waited on forever. */
export const DEFAULT_PATH_LOCK_TIMEOUT_MS = 15000;

/**
 * Unusable lock entries younger than this stay in place and fail the acquire.
 * Old ones are renamed aside so a wedged key can be taken again.
 */
export const LOCK_QUARANTINE_MIN_AGE_MS = 60 * 1000;

/** @type {number} */
export const MAX_LOCK_BYTES = 4096;

const MAX_POLL_MS = 25;
const SHARED_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
let storageDir = null;
/** @type {'fallback'|null} */
let storageKind = null;
/** @type {number} */
let timeoutMs = DEFAULT_PATH_LOCK_TIMEOUT_MS;
/** @type {boolean} */
let warned = false;
/** @type {boolean} */
let quarantineLogged = false;
/**
 * Opt in, or pass `{ enabled: false }` to return to in-process locks only.
 * `root` identifies the data root hashed into the host temporary namespace.
 * Storage is not created until a cross-process lock is taken.
 * @param {{ enabled?: boolean, root?: string, timeoutMs?: number }} [options]
 */
export function configureCrossProcessPathLocks(options = {}) {
    warned = false;
    quarantineLogged = false;
    if (!options || options.enabled !== true) {
        enabled = false;
        storageDir = null;
        storageKind = null;
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
    storageDir = fallbackPathLockDirectory(root);
    storageKind = 'fallback';
    enabled = true;
}

/** @returns {boolean} */
export function crossProcessPathLocksEnabled() {
    return enabled;
}

/**
 * Stable host-local namespace selected for every reservation.
 * The hash is the normalized data root, so every process on this host picks
 * the same directory.
 * @param {string} root
 * @returns {string}
 */
export function fallbackPathLockDirectory(root) {
    let resolved = path.resolve(root);
    try {
        resolved = fs.realpathSync(resolved);
    } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
    }
    const hash = createHash('sha256').update(resolved).digest('hex');
    return path.join(os.tmpdir(), 'st-lab-path-locks', hash);
}

/**
 * Which directory currently receives lock files.
 * @returns {{ kind: 'fallback', directory: string }|null}
 */
export function activePathLockLocation() {
    if (!enabled || !storageDir || !storageKind) return null;
    return { kind: storageKind, directory: storageDir };
}

/**
 * @param {string} key
 * @returns {string}
 */
function digestKey(key) {
    return createHash('sha256').update(key).digest('hex');
}

/**
 * Hashed exclusive path for an already normalized key. Null when the feature is off.
 * @param {string} key
 * @returns {string|null}
 */
export function exclusiveLockPathFor(key) {
    if (!storageDir) return null;
    return path.join(storageDir, `${digestKey(key)}.exclusive`);
}

/**
 * Hashed shared path for one holder. Null when the feature is off.
 * @param {string} key
 * @param {string} token
 * @returns {string|null}
 */
export function sharedLockPathFor(key, token) {
    if (!storageDir) return null;
    return path.join(storageDir, `${digestKey(key)}.shared.${token}`);
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
 * @param {string} reason
 */
function logQuarantine(reason) {
    if (quarantineLogged) return;
    quarantineLogged = true;
    console.warn(`Cross-process path lock quarantined an unusable ${reason} entry`);
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

/**
 * @param {Error|NodeJS.ErrnoException|undefined} error
 * @returns {boolean}
 */
function isPathTooLong(error) {
    if (!error) return false;
    if (error.code === 'ENAMETOOLONG') return true;
    // Node reports Windows ERROR_FILENAME_EXCED_RANGE as ENAMETOOLONG. Some
    // hosts only leave the text. Do not treat a generic EINVAL as this case.
    const message = String(error.message || '');
    return /ENAMETOOLONG|filename or extension is too long|path too long/i.test(message);
}

/** @returns {'ok'|'unavailable'} */
function ensureLockDirectory() {
    if (!storageDir) return 'unavailable';
    try {
        fs.mkdirSync(storageDir, { recursive: true, mode: 0o700 });
        return 'ok';
    } catch (error) {
        warnOnce(error);
        return 'unavailable';
    }
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
    /**
     * `key` is kept when it fits. A long path is replaced with `keyHash` so the
     * file stays under the read cap. An oversized file is treated as not a lock
     * and would otherwise be left in place forever.
     * @type {{ pid: number, hostname: string, startedAt: string, token: string, key?: string, keyHash?: string, bootId?: string, processStartMs?: number }}
     */
    const record = {
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: new Date().toISOString(),
        token: randomUUID(),
        key,
    };
    if (identity.bootId) record.bootId = identity.bootId;
    if (Number.isSafeInteger(identity.processStartMs)) record.processStartMs = identity.processStartMs;
    let text = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(text) <= MAX_LOCK_BYTES) return text;
    delete record.key;
    record.keyHash = digestKey(key);
    text = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(text) > MAX_LOCK_BYTES) throw new PathLockError('path_lock_unavailable');
    return text;
}

/**
 * @param {string} text
 * @returns {string|null}
 */
function payloadToken(text) {
    try {
        const owner = JSON.parse(text);
        if (owner && typeof owner.token === 'string' && SHARED_TOKEN.test(owner.token)) return owner.token;
    } catch {
        return null;
    }
    return null;
}

/**
 * @param {string} filePath
 * @param {string} payload
 * @returns {{ status: 'created' }|{ status: 'busy' }|{ status: 'refuse' }|{ status: 'too-long' }|{ status: 'retry' }|{ status: 'unavailable' }}
 */
function createLockFile(filePath, payload) {
    let fd;
    try {
        fd = fs.openSync(filePath, exclusiveCreateFlags(), 0o644);
    } catch (error) {
        if (isPathTooLong(error)) {
            return { status: 'too-long' };
        }
        if (error.code === 'ENOENT') {
            const ensured = ensureLockDirectory();
            if (ensured === 'unavailable') return { status: 'unavailable' };
            return { status: 'retry' };
        }
        // Windows reports EPERM when the name exists and cannot be replaced.
        if (error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EAGAIN') {
            return { status: 'busy' };
        }
        if (error.code === 'ELOOP' || error.code === 'EISDIR') return { status: 'refuse' };
        warnOnce(error);
        return { status: 'unavailable' };
    }
    try {
        const buffer = Buffer.from(payload, 'utf8');
        let offset = 0;
        while (offset < buffer.length) {
            const wrote = fs.writeSync(fd, buffer, offset, buffer.length - offset, offset);
            if (wrote <= 0) {
                unlinkIfSameFile(filePath, fd);
                warnOnce(new Error(`Could not write ${path.basename(filePath)}`));
                return { status: 'unavailable' };
            }
            offset += wrote;
        }
        fs.ftruncateSync(fd, buffer.length);
        fs.fsyncSync(fd);
    } catch (error) {
        unlinkIfSameFile(filePath, fd);
        if (isPathTooLong(error)) return { status: 'too-long' };
        warnOnce(error);
        return { status: 'unavailable' };
    } finally {
        try { fs.closeSync(fd); } catch { /* the directory entry already has the bytes */ }
    }
    const seen = readRegular(filePath);
    if (seen.status === 'ok' && seen.text === payload) return { status: 'created' };
    if (seen.status === 'environment') {
        if (isPathTooLong(seen.error)) return { status: 'too-long' };
        warnOnce(seen.error);
        return { status: 'unavailable' };
    }
    if (seen.status === 'symlink' || seen.status === 'not-file') return { status: 'refuse' };
    if (seen.status === 'missing') return { status: 'busy' };
    // The new file could not be re-read (Windows EPERM). Remove it when the
    // moved bytes are still ours so a later acquire does not treat this process as the holder.
    const unique = path.join(path.dirname(filePath), `.c${randomBytes(12).toString('hex')}`);
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
 * A payload names this key either by the path itself or by its sha256.
 * Missing both, or a mismatch, is stale. A live owner file from this process
 * always has one of the two.
 * @param {Record<string, unknown>} owner
 * @param {string} key
 * @returns {boolean}
 */
function payloadNamesKey(owner, key) {
    const named = Object.prototype.hasOwnProperty.call(owner, 'key');
    const hashed = Object.prototype.hasOwnProperty.call(owner, 'keyHash');
    if (!named && !hashed) return false;
    if (named && owner.key !== key) return false;
    if (hashed && owner.keyHash !== digestKey(key)) return false;
    return true;
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
    if (!payloadNamesKey(owner, key)) return 'stale';
    if (typeof owner.hostname !== 'string' || owner.hostname.length === 0) return 'stale';
    // Another host may still be the owner. Do not delete that file.
    if (owner.hostname !== os.hostname()) return 'live';
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) return 'stale';
    const liveness = classifyPidLiveness(owner);
    return liveness === 'live' ? 'live' : 'stale';
}

/**
 * A regular file that still looks like a live holder. Used when a quarantine
 * rename races with a real lock landing on the same name.
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeLiveHolder(text) {
    let owner;
    try {
        owner = JSON.parse(text);
    } catch {
        return false;
    }
    if (!owner || typeof owner !== 'object' || Array.isArray(owner)) return false;
    if (typeof owner.hostname !== 'string' || owner.hostname.length === 0) return false;
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) return false;
    const named = Object.prototype.hasOwnProperty.call(owner, 'key') || Object.prototype.hasOwnProperty.call(owner, 'keyHash');
    if (!named || typeof owner.token !== 'string' || owner.token.length === 0) return false;
    if (owner.hostname !== os.hostname()) return true;
    return classifyPidLiveness(owner) === 'live';
}

/**
 * @param {string} filePath
 * @param {string} key
 * @returns {{ state: 'missing' }|{ state: 'live', text: string }|{ state: 'stale', text: string }|{ state: 'refuse' }|{ state: 'environment', error: NodeJS.ErrnoException }}
 */
function inspectLockFile(filePath, key) {
    const seen = readRegular(filePath);
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
    const unique = path.join(path.dirname(lockPath), `.c${randomBytes(12).toString('hex')}`);
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
 * @param {import('node:fs').Stats} listed
 * @returns {'symlink'|'not-file'|'oversize'|null}
 */
function quarantineReason(listed) {
    if (listed.isSymbolicLink()) return 'symlink';
    if (!listed.isFile()) return 'not-file';
    if (listed.size > MAX_LOCK_BYTES) return 'oversize';
    return null;
}

/**
 * Rename an old unusable entry aside. A regular file that looks like a live
 * holder is put back. Path-length failures fail closed.
 * @param {string} filePath
 * @returns {'quarantined'|'missing'|'young'|'not-candidate'|'restored'|'error'|'too-long'}
 */
function quarantineIfStale(filePath) {
    /** @type {import('node:fs').Stats} */
    let listed;
    try {
        listed = fs.lstatSync(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') return 'missing';
        if (isPathTooLong(error)) return 'too-long';
        return 'error';
    }
    const reason = quarantineReason(listed);
    if (!reason) return 'not-candidate';
    const age = Number.isFinite(listed.mtimeMs) ? Date.now() - listed.mtimeMs : 0;
    if (age < LOCK_QUARANTINE_MIN_AGE_MS) return 'young';
    if (!storageDir) return 'error';
    const destDir = path.join(storageDir, PATH_LOCK_QUARANTINE_DIRECTORY);
    try {
        fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
    } catch (error) {
        if (isPathTooLong(error)) return 'too-long';
        return 'error';
    }
    const dest = path.join(destDir, `.c${randomBytes(12).toString('hex')}`);
    try {
        fs.renameSync(filePath, dest);
    } catch (error) {
        if (error.code === 'ENOENT') return 'missing';
        if (isPathTooLong(error)) return 'too-long';
        return 'error';
    }
    const moved = readRegular(dest);
    if (moved.status === 'ok' && looksLikeLiveHolder(moved.text)) {
        restoreOrLeave(dest, filePath);
        return 'restored';
    }
    logQuarantine(reason);
    return 'quarantined';
}

/**
 * @param {string} hash
 * @returns {{ exclusive: string|null, shared: string[], missingDir: boolean, error: NodeJS.ErrnoException|null }}
 */
function listHashEntries(hash) {
    if (!storageDir) return { exclusive: null, shared: [], missingDir: true, error: null };
    /** @type {string[]} */
    let names;
    try {
        names = fs.readdirSync(storageDir);
    } catch (error) {
        if (error.code === 'ENOENT') return { exclusive: null, shared: [], missingDir: true, error: null };
        return { exclusive: null, shared: [], missingDir: false, error };
    }
    const prefix = `${hash}.shared.`;
    /** @type {string[]} */
    const shared = [];
    let exclusive = null;
    for (const name of names) {
        if (name === `${hash}.exclusive`) {
            exclusive = path.join(storageDir, name);
            continue;
        }
        if (!name.startsWith(prefix)) continue;
        const token = name.slice(prefix.length);
        if (!SHARED_TOKEN.test(token)) continue;
        shared.push(path.join(storageDir, name));
    }
    return { exclusive, shared, missingDir: false, error: null };
}

/**
 * Drop dead shared holders. Live ones stay. Old symlinks and oversized blobs
 * are quarantined. A young unusable entry blocks the key.
 * @param {string} key
 * @returns {{ live: number, blocked: boolean }}
 */
function assessShared(key) {
    const listed = listHashEntries(digestKey(key));
    if (listed.error) {
        warnOnce(listed.error);
        return { live: 0, blocked: true };
    }
    let live = 0;
    let blocked = false;
    for (const sharedPath of listed.shared) {
        const inspection = inspectLockFile(sharedPath, key);
        if (inspection.state === 'missing') continue;
        if (inspection.state === 'live') {
            live += 1;
            continue;
        }
        if (inspection.state === 'stale') {
            const taken = takeStaleLock(sharedPath, inspection.text, key);
            if (taken === 'removed' || taken === 'missing') continue;
            if (taken === 'changed') live += 1;
            else blocked = true;
            continue;
        }
        if (inspection.state === 'refuse') {
            const result = quarantineIfStale(sharedPath);
            if (result === 'quarantined' || result === 'missing') continue;
            if (result === 'restored') live += 1;
            else blocked = true;
            continue;
        }
        blocked = true;
    }
    return { live, blocked };
}

/**
 * @param {string} key
 * @returns {string|null}
 */
function parentLockKey(key) {
    const parent = path.dirname(key);
    if (!parent || parent === key) return null;
    return process.platform === 'win32' ? parent.toLowerCase() : parent;
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isExistingDirectory(key) {
    try {
        return fs.lstatSync(key).isDirectory();
    } catch {
        return false;
    }
}

/**
 * Shared parents of exclusive files join the sorted set. An exclusive directory
 * already conflicts with shared holders of that same key, so it does not also
 * take its own parent. Callers that already requested the parent keep that mode.
 * @param {Array<{ key: string, mode: 'shared'|'exclusive' }>} requests
 * @returns {Array<{ key: string, mode: 'shared'|'exclusive' }>}
 */
function expandParentFences(requests) {
    /** @type {Map<string, 'shared'|'exclusive'>} */
    const modes = new Map();
    for (const request of requests) {
        if (!request || (request.mode !== 'shared' && request.mode !== 'exclusive')) {
            throw new TypeError('Invalid lock mode');
        }
        if (typeof request.key !== 'string' || request.key.length === 0) throw new TypeError('Lock path must be a non-empty string');
        if (modes.get(request.key) !== 'exclusive') modes.set(request.key, request.mode);
    }
    for (const [key, mode] of modes) {
        if (mode !== 'exclusive' || isExistingDirectory(key)) continue;
        const parent = parentLockKey(key);
        if (!parent) continue;
        if (modes.get(parent) !== 'exclusive') modes.set(parent, 'shared');
    }
    return [...modes.entries()]
        .map(([key, mode]) => ({ key, mode }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * @param {{ lockPath: string, payload: string }|null} held
 */
function releaseHeld(held) {
    if (held) releaseOne(held);
}

/**
 * @param {string} key
 * @returns {Promise<{ lockPath: string, payload: string }>}
 */
async function acquireShared(key) {
    const deadline = Date.now() + timeoutMs;
    let waitMs = 5;
    let quarantines = 0;
    for (;;) {
        const payload = lockPayload(key);
        const token = payloadToken(payload);
        if (!token || !storageDir) throw new PathLockError('path_lock_unavailable');
        const lockPath = path.join(storageDir, `${digestKey(key)}.shared.${token}`);
        const exclusivePath = exclusiveLockPathFor(key);
        if (!exclusivePath) {
            throw new PathLockError('path_lock_unavailable');
        }
        const sharedState = assessShared(key);
        const exclusiveState = inspectLockFile(exclusivePath, key);
        if (exclusiveState.state === 'environment') {
            warnOnce(exclusiveState.error);
            throw new PathLockError('path_lock_unavailable');
        }
        if (exclusiveState.state === 'refuse') {
            if (quarantines < 1) {
                const result = quarantineIfStale(exclusivePath);
                if (result === 'quarantined' || result === 'missing' || result === 'restored') {
                    quarantines += 1;
                    continue;
                }
            }
            throw new PathLockError('path_lock_unavailable');
        }
        if (exclusiveState.state === 'stale') {
            const taken = takeStaleLock(exclusivePath, exclusiveState.text, key);
            if (taken === 'removed' || taken === 'missing') continue;
            if (taken === 'refuse') throw new PathLockError('path_lock_unavailable');
        }
        if (exclusiveState.state === 'live' || exclusiveState.state === 'stale') {
            if (Date.now() >= deadline) throw new PathLockError('path_lock_busy');
            await delay(waitMs);
            waitMs = Math.min(waitMs * 2, MAX_POLL_MS);
            continue;
        }
        if (sharedState.blocked) throw new PathLockError('path_lock_unavailable');
        const created = createLockFile(lockPath, payload);
        if (created.status === 'too-long') {
            throw new PathLockError('path_lock_unavailable');
        }
        if (created.status === 'retry') {
            if (Date.now() >= deadline) throw new PathLockError('path_lock_busy');
            continue;
        }
        if (created.status === 'unavailable') throw new PathLockError('path_lock_unavailable');
        if (created.status === 'refuse') {
            if (quarantines < 1) {
                const result = quarantineIfStale(lockPath);
                if (result === 'quarantined' || result === 'missing' || result === 'restored') {
                    quarantines += 1;
                    continue;
                }
            }
            throw new PathLockError('path_lock_unavailable');
        }
        if (created.status === 'created') {
            const again = inspectLockFile(exclusivePath, key);
            if (again.state === 'live') {
                releaseHeld({ lockPath, payload });
                if (Date.now() >= deadline) throw new PathLockError('path_lock_busy');
                await delay(waitMs);
                waitMs = Math.min(waitMs * 2, MAX_POLL_MS);
                continue;
            }
            if (again.state === 'stale') {
                const taken = takeStaleLock(exclusivePath, again.text, key);
                if (taken !== 'removed' && taken !== 'missing') {
                    releaseHeld({ lockPath, payload });
                    if (taken === 'refuse') throw new PathLockError('path_lock_unavailable');
                    if (Date.now() >= deadline) throw new PathLockError('path_lock_busy');
                    await delay(waitMs);
                    waitMs = Math.min(waitMs * 2, MAX_POLL_MS);
                    continue;
                }
            }
            if (again.state === 'refuse') {
                releaseHeld({ lockPath, payload });
                if (quarantines < 1) {
                    const result = quarantineIfStale(exclusivePath);
                    quarantines += 1;
                    if (result === 'quarantined' || result === 'missing' || result === 'restored') continue;
                }
                throw new PathLockError('path_lock_unavailable');
            }
            if (again.state === 'environment') {
                releaseHeld({ lockPath, payload });
                warnOnce(again.error);
                throw new PathLockError('path_lock_unavailable');
            }
            return { lockPath, payload };
        }
        if (Date.now() >= deadline) throw new PathLockError('path_lock_busy');
        await delay(waitMs);
        waitMs = Math.min(waitMs * 2, MAX_POLL_MS);
    }
}

/**
 * @param {string} key
 * @returns {Promise<{ lockPath: string, payload: string }>}
 */
async function acquireOne(key) {
    const payload = lockPayload(key);
    const deadline = Date.now() + timeoutMs;
    let waitMs = 5;
    let quarantines = 0;
    for (;;) {
        const lockPath = exclusiveLockPathFor(key);
        if (!lockPath) {
            throw new PathLockError('path_lock_unavailable');
        }
        const sharedState = assessShared(key);
        if (sharedState.blocked) throw new PathLockError('path_lock_unavailable');
        if (sharedState.live > 0) {
            if (Date.now() >= deadline) throw new PathLockError('path_lock_busy');
            await delay(waitMs);
            waitMs = Math.min(waitMs * 2, MAX_POLL_MS);
            continue;
        }
        const created = createLockFile(lockPath, payload);
        if (created.status === 'too-long') {
            throw new PathLockError('path_lock_unavailable');
        }
        if (created.status === 'retry') {
            if (Date.now() >= deadline) throw new PathLockError('path_lock_busy');
            continue;
        }
        if (created.status === 'unavailable') throw new PathLockError('path_lock_unavailable');
        if (created.status === 'created') {
            const after = assessShared(key);
            if (after.live === 0 && !after.blocked) return { lockPath, payload };
            releaseHeld({ lockPath, payload });
            if (after.blocked) throw new PathLockError('path_lock_unavailable');
            if (Date.now() >= deadline) throw new PathLockError('path_lock_busy');
            await delay(waitMs);
            waitMs = Math.min(waitMs * 2, MAX_POLL_MS);
            continue;
        }
        if (created.status === 'refuse') {
            if (quarantines < 1) {
                const result = quarantineIfStale(lockPath);
                if (result === 'quarantined' || result === 'missing' || result === 'restored') {
                    quarantines += 1;
                    continue;
                }
            }
            throw new PathLockError('path_lock_unavailable');
        }
        const inspection = inspectLockFile(lockPath, key);
        if (inspection.state === 'missing') continue;
        if (inspection.state === 'refuse') {
            if (quarantines < 1) {
                const result = quarantineIfStale(lockPath);
                if (result === 'quarantined' || result === 'missing' || result === 'restored') {
                    quarantines += 1;
                    continue;
                }
            }
            throw new PathLockError('path_lock_unavailable');
        }
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
 * Serialize inspection, reclaim, quarantine and publication for one key.
 * Gates are deliberately never reclaimed: an interrupted acquisition fails
 * closed until an operator removes the gate with all contenders stopped.
 * Releases need no gate because their live identity cannot be reclaimed.
 * @param {string} key
 * @param {() => Promise<{ lockPath: string, payload: string }>} acquire
 */
async function serializeAcquisition(key, acquire) {
    if (ensureLockDirectory() === 'unavailable') throw new PathLockError('path_lock_unavailable');
    const gate = path.join(storageDir, `${digestKey(key)}.gate`);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            fs.mkdirSync(gate, { mode: 0o700 });
            break;
        } catch (error) {
            if (error.code !== 'EEXIST') throw new PathLockError('path_lock_unavailable');
            if (Date.now() >= deadline) throw new PathLockError('path_lock_busy');
            await delay(MAX_POLL_MS);
        }
    }
    try {
        return await acquire();
    } finally {
        fs.rmdirSync(gate);
    }
}

/**
 * Take filesystem locks in sorted key order. Shared and exclusive keys of one
 * reservation are one sequence, so a parent fence is held before the child
 * file. A pure shared reservation does not create files.
 * The set is chosen by the caller before it waits, and this function does
 * not start a later key until the earlier one is held. A failed acquisition
 * releases every file already acquired by that reservation.
 * @param {Array<{ key: string, mode: 'shared'|'exclusive' }>} requests
 * @returns {Promise<Array<{ lockPath: string, payload: string }>>}
 */
export async function acquireCrossProcessPathLocks(requests) {
    if (!enabled || !Array.isArray(requests) || requests.length === 0) return [];
    if (!requests.some(request => request && request.mode === 'exclusive')) return [];
    const expanded = expandParentFences(requests);
    const held = [];
    try {
        for (const request of expanded) {
            held.push(await serializeAcquisition(request.key, () => request.mode === 'shared'
                ? acquireShared(request.key) : acquireOne(request.key)));
        }
        return held;
    } catch (error) {
        releaseCrossProcessPathLocks(held);
        throw error;
    }
}

/**
 * @param {{ lockPath: string, payload: string }} held
 */
function releaseOne(held) {
    const unique = path.join(path.dirname(held.lockPath), `.c${randomBytes(12).toString('hex')}`);
    try {
        fs.renameSync(held.lockPath, unique);
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
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
export function releaseCrossProcessPathLocks(held) {
    if (!held || held.length === 0) return;
    for (let index = held.length - 1; index >= 0; index--) releaseOne(held[index]);
}
