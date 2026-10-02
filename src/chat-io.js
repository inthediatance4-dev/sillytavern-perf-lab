import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
    const resolved = path.resolve(filePath);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    const result = (queues.get(key) || Promise.resolve()).then(task);
    const tail = result.then(() => undefined, () => undefined);
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return result;
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
