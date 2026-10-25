import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Name of the exclusive data-root owner file inside the data root. */
export const DATA_ROOT_OWNER_LOCK = '.st-lab-owner.lock';

/**
 * Opt-in ownership of one data root directory.
 * This is not per-file cross-process locking. The owner file records pid,
 * host, and start time. This process holds a non-blocking exclusive flock on
 * that file until exit, and only the flock holder may replace a same-host
 * record, so two processes cannot reclaim one dead owner. A file recorded on
 * another host, a symlink, or an unreadable payload is left in place. The
 * flock is released by the kernel on any process death, including SIGKILL;
 * a signal that skips the exit hook can leave the file for the next acquire
 * on this host. On a normal exit, process.exit, or an uncaught exception,
 * the file is removed only when its bytes still match the payload written here.
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

/** @type {string|null} */
let ownedPath = null;
/** @type {string|null} */
let ownedPayload = null;
/** @type {number|null} */
let ownedFd = null;
/** @type {(() => void)|null} */
let releaseHook = null;
/** @type {((fd: number) => void)|null} */
let flockExclusiveNb = null;
const pauseBuffer = new Int32Array(new SharedArrayBuffer(4));

const require = createRequire(import.meta.url);

/**
 * @param {string} text
 * @returns {{ kind: 'empty' }|{ kind: 'corrupt' }|{ kind: 'owner', owner: { pid: number, hostname: string, startedAt: string }, text: string }}
 */
function classifyOwner(text) {
    if (text.length === 0) return { kind: 'empty' };
    try {
        const owner = JSON.parse(text);
        if (!owner || typeof owner !== 'object' || Array.isArray(owner)) return { kind: 'corrupt' };
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) return { kind: 'corrupt' };
        if (typeof owner.hostname !== 'string' || owner.hostname.length === 0) return { kind: 'corrupt' };
        if (typeof owner.startedAt !== 'string' || owner.startedAt.length === 0) return { kind: 'corrupt' };
        return { owner, text, kind: 'owner' };
    } catch {
        return { kind: 'corrupt' };
    }
}

/**
 * @param {string} lockPath
 * @returns {{ kind: 'missing' }|{ kind: 'empty' }|{ kind: 'corrupt' }|{ kind: 'owner', owner: { pid: number, hostname: string, startedAt: string }, text: string }}
 */
function readOwnerFile(lockPath) {
    let text;
    try {
        text = fs.readFileSync(lockPath, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return { kind: 'missing' };
        throw new DataRootOwnershipError(`Cannot read data-root owner lock at ${lockPath}: ${error.message}`, 'EREAD');
    }
    return classifyOwner(text);
}

/**
 * @param {number} fd
 * @returns {string}
 */
function readFd(fd) {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return '';
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
 * @param {number} pid
 * @returns {boolean}
 */
function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error.code === 'ESRCH') return false;
        // EPERM means the process exists. Anything else fails closed.
        return true;
    }
}

/**
 * @param {number} ms
 */
function pause(ms) {
    Atomics.wait(pauseBuffer, 0, 0, ms);
}

function nodeIncludeDir() {
    const candidates = [
        '/usr/include/node',
        '/usr/local/include/node',
        path.resolve(path.dirname(process.execPath), '../include/node'),
    ];
    for (const directory of candidates) {
        if (fs.existsSync(path.join(directory, 'node_api.h'))) return directory;
    }
    throw new DataRootOwnershipError('Cannot build the data-root flock helper: node_api.h was not found.', 'EREAD');
}

/** Load the non-blocking flock helper, compiling it once per Node ABI. */
function loadFlock() {
    if (flockExclusiveNb) return flockExclusiveNb;
    const sourcePath = fileURLToPath(new URL('./data-root-flock.c', import.meta.url));
    const source = fs.readFileSync(sourcePath);
    const hash = createHash('sha256').update(source).update(process.versions.modules).digest('hex').slice(0, 16);
    const output = path.join(os.tmpdir(), `st-lab-flock-${hash}.node`);
    if (!fs.existsSync(output)) {
        const temporary = `${output}.${process.pid}.tmp`;
        try {
            execFileSync('gcc', [
                '-shared', '-fPIC', `-I${nodeIncludeDir()}`, '-o', temporary, sourcePath,
            ], { stdio: ['ignore', 'ignore', 'pipe'] });
            fs.renameSync(temporary, output);
        } catch (error) {
            try { fs.unlinkSync(temporary); } catch { /* the compiler may not have created it */ }
            const detail = error.stderr ? error.stderr.toString().trim() : error.message;
            throw new DataRootOwnershipError(`Cannot build the data-root flock helper: ${detail}`, 'EREAD');
        }
    }
    flockExclusiveNb = require(output).flockExclusiveNb;
    return flockExclusiveNb;
}

/**
 * @param {string} lockPath
 * @returns {number}
 */
function openLock(lockPath, depth = 0) {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const readWrite = fs.constants.O_RDWR | noFollow;
    try {
        return fs.openSync(lockPath, readWrite);
    } catch (error) {
        if (error.code === 'ELOOP') {
            throw new DataRootOwnershipError(`Data-root owner lock at ${lockPath} is a link and was left in place.`, 'ECORRUPT');
        }
        if (error.code !== 'ENOENT') {
            throw new DataRootOwnershipError(`Cannot open data-root owner lock at ${lockPath}: ${error.message}`, 'EREAD');
        }
    }
    try {
        return fs.openSync(lockPath, readWrite | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
    } catch (error) {
        if (error.code === 'ELOOP') {
            throw new DataRootOwnershipError(`Data-root owner lock at ${lockPath} is a link and was left in place.`, 'ECORRUPT');
        }
        if (error.code !== 'EEXIST') {
            throw new DataRootOwnershipError(`Cannot create data-root owner lock at ${lockPath}: ${error.message}`, 'EREAD');
        }
    }
    try {
        return fs.openSync(lockPath, readWrite);
    } catch (error) {
        if (error.code === 'ELOOP' || error.code === 'EEXIST') {
            throw new DataRootOwnershipError(`Data-root owner lock at ${lockPath} is a link and was left in place.`, 'ECORRUPT');
        }
        if (error.code === 'ENOENT' && depth < 5) return openLock(lockPath, depth + 1);
        throw new DataRootOwnershipError(`Cannot open data-root owner lock at ${lockPath}: ${error.message}`, 'EREAD');
    }
}

/**
 * @param {number} fd
 * @returns {boolean} false when another process already holds the flock
 */
function tryFlock(fd) {
    try {
        loadFlock()(fd);
        return true;
    } catch (error) {
        if (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK') return false;
        throw error;
    }
}

/**
 * @param {number} fd
 * @param {string} payload
 */
function writePayload(fd, payload) {
    const buffer = Buffer.from(payload, 'utf8');
    fs.ftruncateSync(fd, 0);
    let offset = 0;
    while (offset < buffer.length) {
        offset += fs.writeSync(fd, buffer, offset, buffer.length - offset, offset);
    }
    fs.fsyncSync(fd);
}

/**
 * @param {string} lockPath
 * @param {string} payload
 * @param {number} fd
 */
function installRelease(lockPath, payload, fd) {
    ownedPath = lockPath;
    ownedPayload = payload;
    ownedFd = fd;
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
 * @param {boolean} swallow
 */
function releaseOwnedLock(swallow) {
    if (!ownedPath && ownedFd === null) return;
    const lockPath = ownedPath;
    const payload = ownedPayload;
    const fd = ownedFd;
    ownedPath = null;
    ownedPayload = null;
    ownedFd = null;
    if (releaseHook) {
        process.removeListener('exit', releaseHook);
        releaseHook = null;
    }
    /** @type {Error|null} */
    let failure = null;
    try {
        if (lockPath) {
            const current = fs.readFileSync(lockPath, 'utf8');
            if (current === payload) fs.unlinkSync(lockPath);
        }
    } catch (error) {
        if (error.code !== 'ENOENT' && !swallow) failure = error;
    }
    if (fd !== null) {
        try { fs.closeSync(fd); } catch { /* closing releases the flock */ }
    }
    if (failure) throw failure;
}

/** Remove this process's owner file when its contents are still the payload it wrote. */
export function releaseDataRootOwnership() {
    releaseOwnedLock(false);
}

/**
 * @param {string} resolved
 * @param {{ pid: number, hostname: string, startedAt: string }} owner
 * @returns {DataRootOwnershipError}
 */
function lockedError(resolved, owner) {
    return new DataRootOwnershipError(
        `Data root ${resolved} is owned by pid ${owner.pid} on ${owner.hostname} since ${owner.startedAt}. Another process must not share this data root.`,
        'ELOCKED',
    );
}

/**
 * Create `<dataRoot>/.st-lab-owner.lock` and hold it with an exclusive flock.
 * @param {string} dataRoot
 * @returns {{ lockPath: string, pid: number, hostname: string, startedAt: string }}
 */
export function acquireDataRootOwnership(dataRoot) {
    if (typeof dataRoot !== 'string' || dataRoot.length === 0) {
        throw new TypeError('Data root must be a non-empty string');
    }
    if (ownedPath) {
        throw new DataRootOwnershipError(`This process already owns ${ownedPath}.`, 'ELOCKED');
    }
    loadFlock();
    const resolved = path.resolve(dataRoot);
    fs.mkdirSync(resolved, { recursive: true });
    const lockPath = path.join(fs.realpathSync(resolved), DATA_ROOT_OWNER_LOCK);
    const startedAt = new Date().toISOString();
    const hostname = os.hostname();
    const pid = process.pid;
    const payload = `${JSON.stringify({ pid, hostname, startedAt })}\n`;
    for (let attempt = 0; attempt < 50; attempt++) {
        const fd = openLock(lockPath);
        if (!tryFlock(fd)) {
            fs.closeSync(fd);
            const current = readOwnerFile(lockPath);
            if (current.kind === 'corrupt') {
                if (attempt >= 5) {
                    throw new DataRootOwnershipError(`Data-root owner lock at ${lockPath} is unreadable and was left in place.`, 'ECORRUPT');
                }
                pause(10);
                continue;
            }
            if (current.kind === 'owner' && current.owner.hostname !== hostname) {
                throw lockedError(resolved, current.owner);
            }
            if (current.kind === 'owner' && pidAlive(current.owner.pid)) {
                throw lockedError(resolved, current.owner);
            }
            // The flock holder is still publishing a same-host claim. Retry.
            pause(10);
            continue;
        }
        const held = classifyOwner(readFd(fd));
        if (held.kind === 'corrupt') {
            fs.closeSync(fd);
            throw new DataRootOwnershipError(`Data-root owner lock at ${lockPath} is unreadable and was left in place.`, 'ECORRUPT');
        }
        if (held.kind === 'owner' && held.owner.hostname !== hostname) {
            fs.closeSync(fd);
            throw lockedError(resolved, held.owner);
        }
        try {
            writePayload(fd, payload);
        } catch (error) {
            fs.closeSync(fd);
            throw error;
        }
        installRelease(lockPath, payload, fd);
        return { lockPath, pid, hostname, startedAt };
    }
    throw new DataRootOwnershipError(`Could not acquire data-root owner lock at ${lockPath}.`, 'ELOCKED');
}
