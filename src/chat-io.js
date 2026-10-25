import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import writeFileAtomic from 'write-file-atomic';
import sanitize from 'sanitize-filename';
import { acquireExclusivePathLocks, PathLockError, releaseExclusivePathLocks } from './path-fs-lock.js';

/** @typedef {'shared' | 'exclusive'} LockMode */

/**
 * @typedef {object} LockGate
 * @property {number} activeShared
 * @property {boolean} activeExclusive
 * @property {number} exclusivePending Queued or active exclusive reservations not yet released
 * @property {Array<{ mode: LockMode, resolve: () => void }>} waiters
 */

/** @type {Map<string, LockGate>} */
const gates = new Map();
/** Completion of every reservation already accepted, including ones still waiting. */
const pendingIO = new Set();
/**
 * Keys held by the withPathLocks calls on this async stack.
 * A nested call may take other keys (a save schedules the backup writer this way).
 * It must not wait on a key this stack already holds exclusively, or upgrade a
 * shared key to exclusive: the outer call would be waiting for itself.
 * @type {AsyncLocalStorage<Map<string, LockMode>>}
 */
const heldModes = new AsyncLocalStorage();

/**
 * Serialize work for one path, including validation before the actual write.
 * A string path is an exclusive lock. Rejections do not poison the gate.
 * @template T
 * @param {string} filePath Queue identity
 * @param {() => Promise<T>} task Operation
 * @returns {Promise<T>}
 */
export function withPathLock(filePath, task) {
    return withPathLocks([filePath], task);
}

function pathKey(filePath) {
    const resolved = path.resolve(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * @param {Array<string | { path: string, mode: LockMode }>} entries
 * @returns {Array<{ key: string, mode: LockMode }>}
 */
function normalizeLockRequests(entries) {
    /** @type {Map<string, LockMode>} */
    const modes = new Map();
    for (const entry of entries) {
        const isString = typeof entry === 'string';
        const mode = isString ? 'exclusive' : entry.mode;
        const filePath = isString ? entry : entry.path;
        if (mode !== 'shared' && mode !== 'exclusive') throw new TypeError(`Invalid lock mode: ${mode}`);
        if (typeof filePath !== 'string' || filePath.length === 0) throw new TypeError('Lock path must be a non-empty string');
        const key = pathKey(filePath);
        // One call holds each path once. Exclusive covers a shared request for the same path.
        if (modes.get(key) !== 'exclusive') modes.set(key, mode);
    }
    return [...modes.entries()]
        .map(([key, mode]) => ({ key, mode }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * @param {string} key
 * @returns {LockGate}
 */
function getGate(key) {
    let gate = gates.get(key);
    if (!gate) {
        gate = { activeShared: 0, activeExclusive: false, exclusivePending: 0, waiters: [] };
        gates.set(key, gate);
    }
    return gate;
}

/**
 * Grant the longest prefix that writer preference allows.
 * Shared reservations already queued ahead of an exclusive still run together.
 * A later shared reservation is not granted while an exclusive is waiting.
 * @param {LockGate} gate
 */
function pump(gate) {
    if (gate.activeExclusive) return;
    while (gate.waiters.length > 0) {
        const next = gate.waiters[0];
        if (next.mode === 'exclusive') {
            if (gate.activeShared > 0) return;
            gate.waiters.shift();
            gate.activeExclusive = true;
            next.resolve();
            return;
        }
        gate.waiters.shift();
        gate.activeShared++;
        next.resolve();
    }
}

/**
 * @param {string} key
 * @param {LockMode} mode
 * @returns {Promise<void>}
 */
function reserve(key, mode) {
    const gate = getGate(key);
    if (mode === 'exclusive') gate.exclusivePending++;
    const immediate = mode === 'shared'
        ? !gate.activeExclusive && gate.exclusivePending === 0 && gate.waiters.length === 0
        : !gate.activeExclusive && gate.activeShared === 0 && gate.waiters.length === 0;
    if (immediate) {
        if (mode === 'shared') gate.activeShared++;
        else gate.activeExclusive = true;
        return Promise.resolve();
    }
    return new Promise(resolve => {
        gate.waiters.push({ mode, resolve });
    });
}

/**
 * @param {string} key
 * @param {LockMode} mode
 */
function release(key, mode) {
    const gate = gates.get(key);
    if (!gate) return;
    if (mode === 'shared') {
        if (gate.activeShared > 0) gate.activeShared--;
    } else {
        gate.activeExclusive = false;
        if (gate.exclusivePending > 0) gate.exclusivePending--;
    }
    pump(gate);
    if (gate.activeShared === 0 && !gate.activeExclusive && gate.exclusivePending === 0 && gate.waiters.length === 0 && gates.get(key) === gate) {
        gates.delete(key);
    }
}

/**
 * Reserve every requested path synchronously, then wait until all of them are granted.
 * The task does not start while any requested lock is still queued, and this call
 * never awaits one lock before reserving the others. A nested call may lock other
 * paths, which is how a save schedules the backup writer. It fails with
 * `lock_reentered` if it needs a key this stack already holds exclusively, or if it
 * would upgrade a shared key to exclusive. Release the outer reservation first.
 * A string entry is exclusive. `{ path, mode: 'shared' | 'exclusive' }` selects the mode.
 * Shared holders of one path run together. An exclusive request waits for shared
 * holders already in progress and blocks shared requests that arrive after it.
 * When cross-process locks are enabled, each exclusive key also holds a file under
 * `<root>/.st-path-locks/` for the critical section. Those files are chosen here, in
 * this same sorted order, before any wait, and taken only after the in-process grants
 * so a local queue is not reordered. Shared keys stay in-process: atomic replacement
 * already keeps readers of a finished file off partial bytes. A live lock in another
 * process is polled and then fails with `path_lock_busy` rather than waiting forever.
 * @template T
 * @param {Array<string | { path: string, mode: LockMode }>} entries Lock requests
 * @param {() => Promise<T>} task Operation
 * @returns {Promise<T>}
 */
export function withPathLocks(entries, task) {
    const requests = normalizeLockRequests(entries);
    const outer = heldModes.getStore();
    if (outer) {
        for (const request of requests) {
            const held = outer.get(request.key);
            if (held === 'exclusive' || (held && request.mode === 'exclusive')) {
                return Promise.reject(new ChatLifecycleError('lock_reentered'));
            }
        }
    }
    const grants = requests.map(request => reserve(request.key, request.mode));
    const exclusiveKeys = [];
    const scope = new Map(outer);
    for (const request of requests) {
        if (request.mode === 'exclusive') exclusiveKeys.push(request.key);
        scope.set(request.key, request.mode);
    }
    /** @type {Array<{ lockPath: string, payload: string }>} */
    let fsHeld = [];
    const result = Promise.all(grants).then(async () => {
        try {
            fsHeld = await acquireExclusivePathLocks(exclusiveKeys);
        } catch (error) {
            if (error instanceof PathLockError) throw new ChatLifecycleError(error.reason);
            throw error;
        }
        return heldModes.run(scope, task);
    });
    const settled = result.finally(() => {
        try {
            releaseExclusivePathLocks(fsHeld);
        } finally {
            for (const request of requests) release(request.key, request.mode);
        }
    });
    const done = settled.then(() => undefined, () => undefined);
    pendingIO.add(done);
    done.then(() => {
        pendingIO.delete(done);
    });
    return settled;
}

/**
 * Ordinary file operations: shared lock on the parent directory plus an exclusive
 * lock on the file. Directory retirement, rename, delete, and backup pruning pass
 * the directory itself as an exclusive string to withPathLocks / withPathLock.
 * Only the exclusive keys take a cross-process file when that feature is enabled.
 * @param {string[]} filePaths Files, not the directories being retired
 * @returns {Array<{ path: string, mode: LockMode }>}
 */
export function chatLockPaths(filePaths) {
    return filePaths.flatMap(file => [
        { path: path.dirname(file), mode: 'shared' },
        { path: file, mode: 'exclusive' },
    ]);
}

export class ChatLifecycleError extends Error {
    /**
     * @param {string} reason
     */
    constructor(reason) {
        const detail = reason === 'path_lock_busy'
            ? 'another process holds this path lock'
            : reason === 'path_lock_unavailable'
                ? 'the cross-process path lock could not be taken'
                : reason === 'lock_reentered'
                    ? 'a path lock cannot be taken while one is already held'
                    : reason;
        super(`Chat lifecycle conflict: ${detail}. Reload the chat list or save under a different name.`);
        this.name = 'ChatLifecycleError';
        this.reason = reason;
    }
}

/** Normalized queue key for a path. Cross-process lock files hash this string. */
export function pathLockKey(filePath) {
    return pathKey(filePath);
}

function markerPath(filePath, lifecycleRoot) {
    const relative = path.relative(pathKey(lifecycleRoot), pathKey(filePath));
    const identity = createHash('sha256').update(relative).digest('hex');
    return path.join(lifecycleRoot, '.chat-lifecycle', `${identity}.json`);
}

/** Refuse reparse aliases instead of letting different queue keys address one path. */
async function checkLocalPath(filePath, lifecycleRoot) {
    const relative = path.relative(path.resolve(lifecycleRoot), path.resolve(filePath));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new ChatLifecycleError('outside_chat_root');
    const parts = relative ? relative.split(path.sep) : [];
    let current = path.resolve(lifecycleRoot);
    for (const part of [null, ...parts]) {
        if (part !== null) current = path.join(current, part);
        try {
            const stat = await fs.promises.lstat(current);
            if (stat.isSymbolicLink()) throw new ChatLifecycleError('path_alias');
            if (pathKey(await fs.promises.realpath(current)) !== pathKey(current)) throw new ChatLifecycleError('path_alias');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
}

/** Containment, reserved names, and alias checks. Retirement markers are separate. */
async function assertContainedChatPath(filePath, lifecycleRoot) {
    const parts = path.relative(pathKey(lifecycleRoot), pathKey(filePath)).split(path.sep);
    const reserved = new Set(['.chat-lifecycle', '.chat-staging', '.recycle']);
    if (parts.some(part => reserved.has(process.platform === 'win32' ? part.replace(/[. ]+$/, '') : part))) throw new ChatLifecycleError('reserved_path');
    await checkLocalPath(filePath, lifecycleRoot);
    await checkLocalPath(path.join(lifecycleRoot, '.chat-lifecycle'), lifecycleRoot);
}

/** Persistent file and parent-directory retirement; force is deliberately irrelevant. */
export async function assertChatWritable(filePath, lifecycleRoot = path.dirname(filePath)) {
    await assertContainedChatPath(filePath, lifecycleRoot);
    const candidates = [filePath];
    if (pathKey(path.dirname(filePath)) !== pathKey(lifecycleRoot)) candidates.push(path.dirname(filePath));
    for (const candidate of candidates) {
        try { await fs.promises.lstat(markerPath(candidate, lifecycleRoot)); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        throw new ChatLifecycleError('retired_path');
    }
}

/**
 * Move an absent path's own marker aside. Names are `hold-<uuid>.json` so inherit scans skip them.
 * A visible path is left unchanged, including its marker. Parent markers are not touched.
 * @param {string} filePath
 * @param {string} lifecycleRoot
 * @returns {Promise<{filePath: string, lifecycleRoot: string, hold: string, marker: string}|null>}
 */
async function holdRetiredPathIfAbsent(filePath, lifecycleRoot) {
    await assertContainedChatPath(filePath, lifecycleRoot);
    try {
        await fs.promises.lstat(filePath);
        return null;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const marker = markerPath(filePath, lifecycleRoot);
    let markerStat;
    try { markerStat = await fs.promises.lstat(marker); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (markerStat.isSymbolicLink()) throw new ChatLifecycleError('path_alias');
    const hold = path.join(path.dirname(marker), `hold-${randomUUID()}.json`);
    await fs.promises.rename(marker, hold);
    return { filePath, lifecycleRoot, hold, marker };
}

/** Recycle a held marker. The active marker path stays empty so the name can be reused. */
async function commitRetiredPathHold(held) {
    if (!held) return null;
    return recycleChatPath(held.hold, held.lifecycleRoot);
}

/**
 * Put the marker back when the visible path is still absent.
 * A path that this attempt published is not re-blocked: the hold is recycled instead.
 * @param {{filePath: string, lifecycleRoot: string, hold: string, marker: string}|null} held
 */
async function restoreRetiredPathHold(held) {
    if (!held) return;
    try {
        await fs.promises.lstat(held.filePath);
        await commitRetiredPathHold(held);
        return;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    try {
        await fs.promises.lstat(held.marker);
        // Another marker now occupies the active name. Keep this hold as recovery evidence.
        await commitRetiredPathHold(held);
        return;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    await fs.promises.rename(held.hold, held.marker);
}

async function settleRetiredHolds(held, commit) {
    for (let index = held.length - 1; index >= 0; index--) {
        try {
            if (commit) await commitRetiredPathHold(held[index]);
            else await restoreRetiredPathHold(held[index]);
        } catch (error) {
            console.error('Retired-path admission could not settle a held marker', error);
        }
    }
}

/**
 * Deliberate create or rename-target admission. The caller holds the path locks.
 * The marker is recycled only after `task` resolves. If `task` rejects and the visible path is still absent, the marker is restored.
 * Ordinary saves must keep using assertChatWritable. Parent markers stay, so a child cannot revive a retired directory.
 * @template T
 * @param {string} filePath
 * @param {string} lifecycleRoot
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export async function usingRetiredPathReuse(filePath, lifecycleRoot, task) {
    return usingRetiredPathReuses([{ filePath, lifecycleRoot }], task);
}

/**
 * Same as usingRetiredPathReuse for several paths. Holds are taken before `task` and settled afterwards.
 * @template T
 * @param {Array<{filePath: string, lifecycleRoot: string}>} entries
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export async function usingRetiredPathReuses(entries, task) {
    /** @type {Array<{filePath: string, lifecycleRoot: string, hold: string, marker: string}|null>} */
    const held = [];
    try {
        for (const entry of entries) held.push(await holdRetiredPathIfAbsent(entry.filePath, entry.lifecycleRoot));
        const result = await task();
        await settleRetiredHolds(held, true);
        return result;
    } catch (error) {
        await settleRetiredHolds(held, false);
        throw error;
    }
}

/**
 * Immediately recycle an absent path's own marker. Prefer usingRetiredPathReuse when a later step can fail.
 * A path that still exists keeps its marker for the existing writable and target_exists checks.
 * @param {string} filePath Path being created or used as a rename target
 * @param {string} [lifecycleRoot] Directory that owns the retirement markers
 * @returns {Promise<string|null>} Recycled marker path, or null when nothing was cleared
 */
export async function clearRetiredPathIfAbsent(filePath, lifecycleRoot = path.dirname(filePath)) {
    const held = await holdRetiredPathIfAbsent(filePath, lifecycleRoot);
    if (!held) return null;
    return commitRetiredPathHold(held);
}

/** Move a file or directory to recoverable storage; never unlink it. */
export async function recycleChatPath(source, recycleRoot = path.dirname(source)) {
    try { await fs.promises.lstat(source); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const directory = path.join(recycleRoot, '.recycle');
    await checkLocalPath(directory, recycleRoot);
    await fs.promises.mkdir(directory, { recursive: true });
    const container = await fs.promises.mkdtemp(path.join(directory, 'chat-'));
    const destination = path.join(container, path.basename(source));
    await fs.promises.rename(source, destination);
    return destination;
}

/** Caller holds all affected directory/file locks. Marker stays outside recycled folders. */
export async function retireChatPath(filePath, lifecycleRoot, reason) {
    await assertChatWritable(filePath, lifecycleRoot);
    const token = randomUUID();
    const marker = markerPath(filePath, lifecycleRoot);
    await fs.promises.mkdir(path.dirname(marker), { recursive: true });
    await writeFileAtomic(marker, JSON.stringify({ version: 1, token, reason, retired_at: new Date().toISOString(), relative_path: path.relative(lifecycleRoot, filePath) }), 'utf8');
    return { marker, token, lifecycleRoot };
}

/** Roll back only the marker created by this operation, preserving it in recovery storage. */
export async function rollbackChatRetirement(retirement) {
    const data = JSON.parse(await fs.promises.readFile(retirement.marker, 'utf8'));
    if (data.token !== retirement.token) throw new ChatLifecycleError('retirement_changed');
    await recycleChatPath(retirement.marker, retirement.lifecycleRoot);
}

/** Preserve retired file identities when an active character directory changes name. */
export async function inheritChatRetirements(sourceDirectory, targetDirectory, lifecycleRoot) {
    let names;
    try { names = await fs.promises.readdir(path.join(lifecycleRoot, '.chat-lifecycle')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const inherited = [];
    try {
        for (const name of names) {
            if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
            const record = JSON.parse(await fs.promises.readFile(path.join(lifecycleRoot, '.chat-lifecycle', name), 'utf8'));
            const candidate = typeof record.relative_path === 'string'
                ? path.resolve(lifecycleRoot, record.relative_path)
                : typeof record.name === 'string' ? path.join(sourceDirectory, record.name) : null;
            if (!candidate || path.basename(markerPath(candidate, lifecycleRoot)) !== name) {
                // Legacy basename-only markers for other directories are not applicable.
                if (record.relative_path === undefined && typeof record.name === 'string') continue;
                throw new ChatLifecycleError('invalid_retirement');
            }
            if (pathKey(path.dirname(candidate)) !== pathKey(sourceDirectory)) continue;
            const target = path.join(targetDirectory, path.basename(candidate));
            try { inherited.push(await retireChatPath(target, lifecycleRoot, 'inherited_retirement')); }
            catch (error) {
                if (error instanceof ChatLifecycleError && error.reason === 'retired_path') continue;
                throw error;
            }
        }
        return inherited;
    } catch (error) {
        for (const retirement of inherited) await rollbackChatRetirement(retirement).catch(recoveryError => console.error('Inherited retirement remains fail-closed', recoveryError));
        throw error;
    }
}

/** Publish complete bytes with an exclusive hard link; readers never see a partial target.
 * Staging files move to recovery storage. Requires same-filesystem hard-link support.
 * The caller holds the destination's parent shared and the file exclusively.
 */
async function publishExclusive(filePath, prepare) {
    const staging = path.join(path.dirname(filePath), '.chat-staging');
    await checkLocalPath(staging, path.dirname(filePath));
    await fs.promises.mkdir(staging, { recursive: true });
    const temporary = path.join(staging, randomUUID());
    try {
        await prepare(temporary);
        await fs.promises.link(temporary, filePath);
    } catch (error) {
        await recycleChatPath(temporary, path.dirname(filePath)).catch(recoveryError => { console.error('Could not retain failed chat staging file', recoveryError); });
        if (error.code === 'EEXIST') throw new ChatLifecycleError('target_exists');
        throw error;
    }
    // A failed staging cleanup must not report a failed import after successful publication.
    await recycleChatPath(temporary, path.dirname(filePath)).catch(error => { console.error('Chat staging file retained in place', error); });
}

export async function createChatFileExclusive(filePath, data) {
    await publishExclusive(filePath, async temporary => {
        const file = await fs.promises.open(temporary, 'wx');
        try { await file.writeFile(data, 'utf8'); await file.sync(); }
        finally { await file.close(); }
    });
}

export async function copyChatFileExclusive(source, destination) {
    await publishExclusive(destination, async temporary => {
        await fs.promises.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
        const file = await fs.promises.open(temporary, 'r+');
        try { await file.sync(); } finally { await file.close(); }
    });
}

/** Bounded-memory evidence for failure recovery; never follows reparse aliases. */
export async function fingerprintChatPath(source) {
    const hash = createHash('sha256');
    async function visit(file, relative) {
        const stat = await fs.promises.lstat(file);
        if (stat.isSymbolicLink()) throw new ChatLifecycleError('path_alias');
        hash.update(JSON.stringify([relative, stat.isDirectory() ? 'directory' : 'file', stat.isFile() ? stat.size : null]));
        if (stat.isDirectory()) {
            const names = (await fs.promises.readdir(file)).sort();
            for (const name of names) await visit(path.join(file, name), path.join(relative, name));
        } else if (stat.isFile()) {
            for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
        } else throw new ChatLifecycleError('unsupported_file_type');
    }
    await visit(source, '');
    return hash.digest('hex');
}

/** Retire and move one file, rolling back the marker if a failed rename left it intact. */
export async function recycleRetiredChat(filePath, lifecycleRoot, reason = 'deleted') {
    const original = await fingerprintChatPath(filePath);
    const retirement = await retireChatPath(filePath, lifecycleRoot, reason);
    try { return await recycleChatPath(filePath, lifecycleRoot); }
    catch (error) {
        try {
            const retained = await fingerprintChatPath(filePath);
            if (retained === original) await rollbackChatRetirement(retirement);
        } catch (recoveryError) { console.error('Chat retirement remains fail-closed', recoveryError); }
        throw error;
    }
}

/** No overwrite; source changes are protected by the same locks used by saves. */
export async function renameChatFile(source, destination, lifecycleRoot) {
    await assertChatWritable(source, lifecycleRoot);
    // Destination admission only. The source stays retired for ordinary saves until this rename commits.
    return usingRetiredPathReuse(destination, lifecycleRoot, async () => {
        await assertChatWritable(destination, lifecycleRoot);
        try { await fs.promises.lstat(destination); throw new ChatLifecycleError('target_exists'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const original = await fingerprintChatPath(source);
        await copyChatFileExclusive(source, destination);
        let retirement;
        try {
            retirement = await retireChatPath(source, lifecycleRoot, 'renamed');
            await recycleChatPath(source, lifecycleRoot);
        } catch (error) {
            try {
                const retained = await fingerprintChatPath(source);
                if (retained === original) {
                    // Restore the old path before removing our candidate from the visible list.
                    if (retirement) await rollbackChatRetirement(retirement);
                    await recycleChatPath(destination, lifecycleRoot);
                }
            } catch (recoveryError) { console.error('Rename recovery copies retained; retirement remains fail-closed', recoveryError); }
            throw error;
        }
    });
}

/** Wait for every reservation that has already been accepted, including those still queued. */
export async function waitForChatIO() {
    while (pendingIO.size) await Promise.all([...pendingIO]);
}

/**
 * Keep the existing atomic-replacement and fsync behavior, using async I/O.
 * The caller holds the chat lock across validation and this write.
 * @param {string} filePath Target file
 * @param {string} data Serialized JSONL
 */
export async function writeChatFile(filePath, data) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomic(filePath, data, 'utf8');
}

function isLexicalChild(parent, target) {
    const relative = path.relative(path.resolve(parent), path.resolve(target));
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * List files already inside a recycle directory. Symlinks are not followed.
 * @param {string} recycleRoot
 * @returns {Promise<Array<{target: string, bytes: number, mtime: number}>>}
 */
async function listRecycleFiles(recycleRoot) {
    const files = [];
    async function visit(current) {
        const stat = await fs.promises.lstat(current);
        if (stat.isSymbolicLink()) {
            files.push({ target: current, bytes: stat.size, mtime: stat.mtimeMs });
            return;
        }
        if (stat.isDirectory()) {
            const names = await fs.promises.readdir(current);
            for (const name of names) await visit(path.join(current, name));
            return;
        }
        if (stat.isFile()) files.push({ target: current, bytes: stat.size, mtime: stat.mtimeMs });
    }
    let rootStat;
    try { rootStat = await fs.promises.lstat(recycleRoot); }
    catch (error) { if (error.code === 'ENOENT') return files; throw error; }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return files;
    const names = await fs.promises.readdir(recycleRoot);
    for (const name of names) await visit(path.join(recycleRoot, name));
    return files;
}

async function removeEmptyRecycleDirectories(recycleRoot) {
    async function visit(current) {
        const stat = await fs.promises.lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return;
        const names = await fs.promises.readdir(current);
        for (const name of names) await visit(path.join(current, name));
        if (pathKey(current) === pathKey(recycleRoot)) return;
        const remaining = await fs.promises.readdir(current);
        if (remaining.length === 0) await fs.promises.rmdir(current);
    }
    try { await visit(recycleRoot); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
}

/**
 * Delete oldest artifacts already inside `.recycle` until the byte budget holds.
 * This is the only automatic unlink on the backup path. Visible backups and primary chats are outside this directory and are never removed here.
 * @param {string} recycleRoot
 * @param {number} maxBytes
 * @returns {Promise<string[]>} Removed paths
 */
async function pruneRecycleStorage(recycleRoot, maxBytes) {
    const files = await listRecycleFiles(recycleRoot);
    files.sort((a, b) => a.mtime - b.mtime || a.target.localeCompare(b.target));
    let total = files.reduce((sum, file) => sum + file.bytes, 0);
    const removed = [];
    for (const file of files) {
        if (total <= maxBytes) break;
        if (!isLexicalChild(recycleRoot, file.target)) throw new Error('Refusing to prune outside recycled backup storage');
        await fs.promises.rm(file.target, { force: true });
        total -= file.bytes;
        removed.push(file.target);
    }
    if (removed.length) await removeEmptyRecycleDirectories(recycleRoot);
    return removed;
}

/**
 * Scan chat backups once and move expired files into recoverable storage.
 * `limit` (config `backups.common.numberOfBackups`) caps how many visible
 * backup files stay in the directory. It is not a disk bound: expired files
 * move into `.recycle` and remain until `maxRecycleBytes` says otherwise.
 * The caller holds the backup directory exclusively across creation and pruning.
 * @param {string} directory Backup directory
 * @param {string} prefix Chat backup name prefix
 * @param {number} limit Number of visible backups to keep
 * @param {{ maxRecycleBytes?: number }} [options] Byte budget for `.recycle`. Negative means unlimited.
 * @returns {Promise<{scanned: number, recycled: string[]}>}
 */
export async function recycleOldChatBackups(directory, prefix, limit, options = {}) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Backup retention must be a non-negative integer');
    const maxRecycleBytes = options.maxRecycleBytes ?? -1;
    const names = (await fs.promises.readdir(directory, { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.jsonl'))
        .map(entry => entry.name);
    const recycled = [];
    if (names.length > limit) {
        const records = [];
        // Bound concurrent metadata reads to avoid a burst of file descriptors.
        for (let offset = 0; offset < names.length; offset += 32) {
            const batch = await Promise.all(names.slice(offset, offset + 32).map(async name => {
                try {
                    const stat = await fs.promises.stat(path.join(directory, name));
                    return { name, mtime: stat.mtimeMs };
                } catch (error) {
                    if (error.code === 'ENOENT') return null;
                    throw error;
                }
            }));
            records.push(...batch.filter(Boolean));
        }
        records.sort((a, b) => a.mtime - b.mtime);
        const expired = records.slice(0, Math.max(0, records.length - limit));
        if (expired.length) {
            const recycleDirectory = path.join(directory, '.recycle', `${Date.now()}-${randomUUID()}`);
            await fs.promises.mkdir(recycleDirectory, { recursive: true });
            for (const record of expired) {
                const destination = path.join(recycleDirectory, record.name);
                try {
                    await fs.promises.rename(path.join(directory, record.name), destination);
                    recycled.push(destination);
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                }
            }
        }
    }
    // Negative budgets keep every recycled artifact. Zero purges recycle storage.
    if (Number.isFinite(maxRecycleBytes) && maxRecycleBytes >= 0) {
        await pruneRecycleStorage(path.join(directory, '.recycle'), maxRecycleBytes);
    }
    return { scanned: names.length, recycled };
}

/** Reject metadata IDs rather than silently mapping them to another history. */
export function isValidGroupChatId(id) {
    return typeof id === 'string' && id.length > 0 && sanitize(id) === id && id !== '.' && id !== '..';
}

/** Apply the same containment, alias and retirement policy as chat writes. */
export async function resolveGroupChatPath(directory, id) {
    if (!isValidGroupChatId(id)) throw new ChatLifecycleError('invalid_chat_id');
    const file = path.join(directory, `${id}.jsonl`);
    await assertChatWritable(file, directory);
    return file;
}
