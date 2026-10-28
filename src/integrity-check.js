import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DEFAULT_USER, USER_DIRECTORY_TEMPLATE } from './constants.js';
import { checkLocalPath } from './chat-io.js';
import { scanLifecycle } from './lifecycle-reconcile.js';

async function entries(directory) {
    try { return await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

/** Read the same user keys as startup without initializing (or writing) node-persist. */
export async function discoverLifecycleRoots(dataRoot) {
    await checkLocalPath(dataRoot, dataRoot);
    if (!(await fs.promises.stat(dataRoot)).isDirectory()) throw new Error(`Not a data directory: ${dataRoot}`);
    const storage = path.join(dataRoot, '_storage');
    await checkLocalPath(storage, dataRoot);
    const handles = new Set();
    for (const entry of await entries(storage)) {
        if (entry.name.startsWith('.')) continue;
        const file = path.join(storage, entry.name);
        await checkLocalPath(file, dataRoot);
        const record = JSON.parse(await fs.promises.readFile(file, 'utf8'));
        if (!record || typeof record.key !== 'string' || !record.key) throw new Error(`Invalid user storage record: ${file}`);
        if (!record.key.startsWith('user:')) continue;
        const handle = record.key.slice(5);
        if (!handle || handle === '.' || handle === '..' || /[\\/:]/.test(handle)) throw new Error(`Invalid user handle: ${file}`);
        handles.add(handle);
    }
    // Startup creates this user when the storage has no user keys. Do not create it here.
    if (!handles.size) handles.add(DEFAULT_USER.handle);
    const roots = [];
    for (const handle of [...handles].sort()) {
        for (const key of ['chats', 'characters', 'groupChats']) {
            const root = path.join(dataRoot, handle, USER_DIRECTORY_TEMPLATE[key]);
            await checkLocalPath(root, dataRoot);
            roots.push(root);
        }
    }
    return roots;
}

async function checkJsonl(file, root, findings) {
    const stream = fs.createReadStream(file, { encoding: 'utf8', flags: 'r' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let number = 0;
    try {
        for await (let line of lines) {
            number++;
            if (number === 1) line = line.replace(/^\uFEFF/, '');
            if (!line.trim()) continue;
            try {
                const row = JSON.parse(line);
                if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Expected a JSON object');
            } catch {
                findings.push({ kind: 'corrupt-jsonl', root, source: file, line: number });
            }
        }
    } finally {
        lines.close();
        stream.destroy();
    }
}

/** Read-only offline inspection. No ownership lock, storage initialization or recovery. */
export async function checkIntegrity(dataRoot) {
    dataRoot = path.resolve(dataRoot);
    const roots = await discoverLifecycleRoots(dataRoot);
    const findings = [];
    const recycle = [];
    for (const root of roots) {
        for (const item of await scanLifecycle(root)) {
            if (item.kind === 'published' || item.kind === 'manual') {
                const record = JSON.parse(item.contents);
                findings.push({ kind: 'marker-visible-conflict', root, source: item.source, visible: item.visible, intent: record.intent ?? null, state: item.kind });
            } else if (item.kind === 'orphan' || item.kind === 'manual-temp') {
                findings.push(item);
            }
        }
        const usage = { root, bytes: 0, count: 0 };
        async function visit(directory, recycled = false) {
            await checkLocalPath(directory, dataRoot);
            for (const entry of await entries(directory)) {
                const file = path.join(directory, entry.name);
                await checkLocalPath(file, dataRoot);
                const inRecycle = recycled || entry.name === '.recycle';
                if (entry.isDirectory()) await visit(file, inRecycle);
                else if (entry.isFile()) {
                    if (inRecycle) {
                        usage.count++;
                        usage.bytes += (await fs.promises.stat(file)).size;
                    } else if (/^hold-.*\.json$/.test(entry.name)) {
                        findings.push({ kind: 'leftover-hold', root, source: file });
                    } else if (entry.name.endsWith('.jsonl')) {
                        await checkJsonl(file, root, findings);
                    }
                }
            }
        }
        await visit(root);
        recycle.push(usage);
        if (usage.count) findings.push({ kind: 'recycle-usage', ...usage });
    }
    return { dataRoot, roots, findings, recycle };
}
