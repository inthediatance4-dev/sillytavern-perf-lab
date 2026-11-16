#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Metadata only: no file contents, and no symlink traversal.
export async function describeDataRoot(root) {
    const result = { characters: { count: 0, bytes: 0 }, chats: { count: 0, bytes: 0 }, groups: { count: 0 }, worldinfo: { count: 0 }, extensions: [] };
    async function entries(dir) {
        try { return await fs.readdir(dir, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    }
    async function count(dir, into, pattern, recursive = true) {
        for (const entry of await entries(dir)) {
            if (entry.name.startsWith('.')) continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory() && recursive) await count(file, into, pattern);
            else if (entry.isFile() && pattern.test(entry.name)) {
                into.count++;
                if ('bytes' in into) into.bytes += (await fs.lstat(file)).size;
            }
        }
    }
    for (const user of await entries(root)) {
        if (!user.isDirectory() || user.name.startsWith('.') || user.name.startsWith('_')) continue;
        const dir = path.join(root, user.name);
        await count(path.join(dir, 'characters'), result.characters, /\.png$/i, false);
        await count(path.join(dir, 'chats'), result.chats, /\.jsonl$/i);
        await count(path.join(dir, 'group chats'), result.chats, /\.jsonl$/i);
        await count(path.join(dir, 'groups'), result.groups, /\.json$/i, false);
        await count(path.join(dir, 'worlds'), result.worldinfo, /\.json$/i, false);
        for (const entry of await entries(path.join(dir, 'extensions'))) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) result.extensions.push(entry.name);
        }
    }
    result.extensions = [...new Set(result.extensions)].sort();
    return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length !== 4 || process.argv[2] !== '--data-root') throw new Error('Usage: describe-data-root.mjs --data-root <path>');
    console.log(JSON.stringify(await describeDataRoot(path.resolve(process.argv[3])), null, 2));
}
