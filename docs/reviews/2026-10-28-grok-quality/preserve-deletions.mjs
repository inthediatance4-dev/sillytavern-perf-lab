// Review-only guard: turn filesystem deletions into recoverable renames.
// Inherited by child Node processes; reviewed application sources are unchanged.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { review as root } from './review-context.mjs';
const recycle = path.join(root, 'recycle', 'test-deletions');
fs.mkdirSync(recycle, { recursive: true });
const rename = fs.renameSync.bind(fs);
const lstat = fs.lstatSync.bind(fs);
const readdir = fs.readdirSync.bind(fs);
const child = (base, target) => { const rel = path.relative(base, target); return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
function retain(target, options = {}, kind = 'rm') {
    target = path.resolve(target instanceof URL ? fileURLToPath(target) : String(target));
    if (!child(root, target) || target.toLowerCase().includes('node_modules')) {
        const error = new Error('Review guard refused deletion outside synthetic fixtures: ' + target);
        error.code = 'EACCES'; throw error;
    }
    let stat;
    try { stat = lstat(target); } catch (error) { if (kind === 'rm' && options.force && error.code === 'ENOENT') return; throw error; }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
        if (kind === 'unlink' || (kind === 'rm' && !options.recursive)) { const error = new Error('Is a directory'); error.code = 'EISDIR'; throw error; }
        if (kind === 'rmdir' && !options.recursive && readdir(target).length) { const error = new Error('Directory not empty'); error.code = 'ENOTEMPTY'; throw error; }
    } else if (kind === 'rmdir') { const error = new Error('Not a directory'); error.code = 'ENOTDIR'; throw error; }
    const destination = path.join(recycle, `${process.pid}-${randomUUID()}`);
    rename(target, destination);
    fs.appendFileSync(path.join(root, 'preserved-deletions.jsonl'), JSON.stringify({ target, destination, kind }) + '\n');
}
for (const name of ['rm', 'unlink', 'rmdir']) {
    fs[name + 'Sync'] = (target, options) => retain(target, options, name);
    fs[name] = (target, options, callback) => {
        if (typeof options === 'function') { callback = options; options = {}; }
        try { retain(target, options, name); queueMicrotask(() => callback(null)); }
        catch (error) { queueMicrotask(() => callback(error)); }
    };
    fsp[name] = async (target, options) => retain(target, options, name);
}
syncBuiltinESMExports();
