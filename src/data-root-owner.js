import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Name of the exclusive data-root owner file inside the data root. */
export const DATA_ROOT_OWNER_LOCK = '.st-lab-owner.lock';

/**
 * Opt-in ownership of one data root directory.
 * This is not per-file cross-process locking. A stale file is reclaimed only
 * when the recorded pid is dead on this hostname. Another host's file is left
 * in place. PID reuse can make a dead owner's file look alive. On exit the
 * file is removed only when its bytes still match the payload written here.
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
/** @type {(() => void)|null} */
let releaseHook = null;

/**
 * @param {string} lockPath
 * @returns {{ owner: { pid: number, hostname: string, startedAt: string }, text: string }|null}
 */
function readOwner(lockPath) {
    let text;
    try {
        text = fs.readFileSync(lockPath, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new DataRootOwnershipError(`Cannot read data-root owner lock at ${lockPath}: ${error.message}`, 'EREAD');
    }
    try {
        const owner = JSON.parse(text);
        if (!owner || typeof owner !== 'object') throw new Error('invalid');
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('invalid');
        if (typeof owner.hostname !== 'string' || owner.hostname.length === 0) throw new Error('invalid');
        if (typeof owner.startedAt !== 'string' || owner.startedAt.length === 0) throw new Error('invalid');
        return { owner, text };
    } catch (error) {
        if (error instanceof DataRootOwnershipError) throw error;
        throw new DataRootOwnershipError(`Data-root owner lock at ${lockPath} is unreadable and was left in place.`, 'ECORRUPT');
    }
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
 * @param {string} lockPath
 * @param {string} payload
 */
function writeExclusive(lockPath, payload) {
    const fd = fs.openSync(lockPath, 'wx');
    try {
        fs.writeFileSync(fd, payload);
        fs.fsyncSync(fd);
    } catch (error) {
        try { fs.closeSync(fd); } catch { /* close the failed create before unlinking */ }
        try { fs.unlinkSync(lockPath); } catch { /* the exclusive create may already be gone */ }
        throw error;
    }
    fs.closeSync(fd);
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
 * @param {boolean} swallow
 */
function releaseOwnedLock(swallow) {
    if (!ownedPath) return;
    const lockPath = ownedPath;
    const payload = ownedPayload;
    ownedPath = null;
    ownedPayload = null;
    if (releaseHook) {
        process.removeListener('exit', releaseHook);
        releaseHook = null;
    }
    try {
        const current = fs.readFileSync(lockPath, 'utf8');
        if (current === payload) fs.unlinkSync(lockPath);
    } catch (error) {
        if (error.code === 'ENOENT' || swallow) return;
        throw error;
    }
}

/** Remove this process's owner file when its contents are still the payload it wrote. */
export function releaseDataRootOwnership() {
    releaseOwnedLock(false);
}

/**
 * Create `<dataRoot>/.st-lab-owner.lock` with O_EXCL.
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
    const resolved = path.resolve(dataRoot);
    fs.mkdirSync(resolved, { recursive: true });
    const lockPath = path.join(fs.realpathSync(resolved), DATA_ROOT_OWNER_LOCK);
    const startedAt = new Date().toISOString();
    const hostname = os.hostname();
    const pid = process.pid;
    const payload = `${JSON.stringify({ pid, hostname, startedAt })}\n`;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            writeExclusive(lockPath, payload);
            installRelease(lockPath, payload);
            return { lockPath, pid, hostname, startedAt };
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const current = readOwner(lockPath);
            if (!current) continue;
            const sameHost = current.owner.hostname === hostname;
            if (sameHost && !pidAlive(current.owner.pid)) {
                let again;
                try {
                    again = fs.readFileSync(lockPath, 'utf8');
                } catch (readError) {
                    if (readError.code === 'ENOENT') continue;
                    throw readError;
                }
                if (again !== current.text) continue;
                try {
                    fs.unlinkSync(lockPath);
                } catch (unlinkError) {
                    if (unlinkError.code === 'ENOENT') continue;
                    throw unlinkError;
                }
                continue;
            }
            const owner = current.owner;
            throw new DataRootOwnershipError(
                `Data root ${resolved} is owned by pid ${owner.pid} on ${owner.hostname} since ${owner.startedAt}. Another process must not share this data root.`,
                'ELOCKED',
            );
        }
    }
    throw new DataRootOwnershipError(`Could not acquire data-root owner lock at ${lockPath}.`, 'ELOCKED');
}
