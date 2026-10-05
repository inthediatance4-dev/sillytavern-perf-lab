import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import writeFileAtomic from 'write-file-atomic';

const queues = new Map();

/**
 * Serialize work for one path, including validation before the actual write.
 * Rejections do not poison the queue. Different paths remain independent.
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

/** Reserve every queue synchronously; never hold one lock while awaiting another. */
export function withPathLocks(filePaths, task) {
    const keys = [...new Set(filePaths.map(pathKey))].sort();
    const previous = [...new Set(keys.map(key => queues.get(key)).filter(Boolean))];
    const result = Promise.all(previous).then(task);
    const tail = result.then(() => undefined, () => undefined);
    for (const key of keys) queues.set(key, tail);
    tail.then(() => {
        for (const key of keys) if (queues.get(key) === tail) queues.delete(key);
    });
    return result;
}

/** File operations share their parent directory queue with directory retirement. */
export function chatLockPaths(filePaths) {
    return filePaths.flatMap(file => [path.dirname(file), file]);
}

export class ChatLifecycleError extends Error {
    constructor(reason) {
        super(`Chat lifecycle conflict: ${reason}. Reload the chat list or save under a different name.`);
        this.name = 'ChatLifecycleError';
        this.reason = reason;
    }
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

/** Persistent file and parent-directory retirement; force is deliberately irrelevant. */
export async function assertChatWritable(filePath, lifecycleRoot = path.dirname(filePath)) {
    const parts = path.relative(pathKey(lifecycleRoot), pathKey(filePath)).split(path.sep);
    const reserved = new Set(['.chat-lifecycle', '.chat-staging', '.recycle']);
    if (parts.some(part => reserved.has(process.platform === 'win32' ? part.replace(/[. ]+$/, '') : part))) throw new ChatLifecycleError('reserved_path');
    await checkLocalPath(filePath, lifecycleRoot);
    await checkLocalPath(path.join(lifecycleRoot, '.chat-lifecycle'), lifecycleRoot);
    const candidates = [filePath];
    if (pathKey(path.dirname(filePath)) !== pathKey(lifecycleRoot)) candidates.push(path.dirname(filePath));
    for (const candidate of candidates) {
        try { await fs.promises.lstat(markerPath(candidate, lifecycleRoot)); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        throw new ChatLifecycleError('retired_path');
    }
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
 * The caller holds the destination's parent and file locks.
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
}

/** Wait for all operations that have already entered the queues. */
export async function waitForChatIO() {
    while (queues.size) await Promise.all([...queues.values()]);
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

/**
 * Scan chat backups once and move expired files into recoverable storage.
 * The caller holds the backup directory lock across creation and pruning.
 * @param {string} directory Backup directory
 * @param {string} prefix Chat backup name prefix
 * @param {number} limit Number of backups to keep
 * @returns {Promise<{scanned: number, recycled: string[]}>}
 */
export async function recycleOldChatBackups(directory, prefix, limit) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Backup retention must be a non-negative integer');
    const names = (await fs.promises.readdir(directory, { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.jsonl'))
        .map(entry => entry.name);
    if (names.length <= limit) return { scanned: names.length, recycled: [] };
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
    const recycled = [];
    if (!expired.length) return { scanned: names.length, recycled };
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
    return { scanned: names.length, recycled };
}
