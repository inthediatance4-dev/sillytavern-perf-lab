import fs from 'node:fs';
import path from 'node:path';
import { assertContainedChatPath, checkLocalPath, markerPath, pathLockKey, recycleChatPath, restoreLegacyRetiredHolds, writeLifecycleAtomic } from './chat-io.js';

const markerName = /^[a-f0-9]{64}\.json$/;
const stagingName = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?:\.[0-9]{1,10})?$/;

/** Read-only classification. Call only with a quiescent root; never follow aliases. */
export async function scanLifecycle(root, { fs: filesystem = fs } = {}) {
    const io = filesystem.promises;
    const findings = [];
    async function exists(file) {
        try { await io.lstat(file); return true; }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    }
    async function visit(directory) {
        await checkLocalPath(directory, root, filesystem);
        let entries;
        try { entries = await io.readdir(directory, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
        for (const entry of entries) {
            const source = path.join(directory, entry.name);
            // Recycled evidence is intentionally outside reconciliation's scan.
            if (entry.name === '.recycle') continue;
            await checkLocalPath(source, root, filesystem);
            if (entry.isDirectory()) {
                await visit(source);
            } else if (entry.isFile() && (
                (path.basename(directory) === '.chat-staging' && stagingName.test(entry.name))
                || (directory === path.join(root, '.chat-lifecycle') && /^[a-f0-9]{64}\.json\.[0-9]{1,10}$/.test(entry.name))
            )) {
                findings.push({ kind: 'orphan', root, source });
            } else if (entry.isFile() && directory === path.join(root, '.chat-lifecycle') && markerName.test(entry.name)) {
                const contents = await io.readFile(source, 'utf8');
                const record = JSON.parse(contents);
                if (!record || typeof record.relative_path !== 'string' || !record.relative_path || path.isAbsolute(record.relative_path)) throw new Error(`Invalid retirement: ${source}`);
                if (record.relative_path.split(/[\\/]/).includes('..')) throw new Error(`Invalid retirement path: ${source}`);
                const visible = path.resolve(root, record.relative_path);
                await assertContainedChatPath(visible, root, filesystem);
                if (pathLockKey(markerPath(visible, root)) !== pathLockKey(source)) throw new Error(`Retirement identity mismatch: ${source}`);
                const present = await exists(visible);
                const kind = record.intent === 'publish'
                    ? present ? record.publish_visible_before ? 'manual' : 'published' : 'unpublished'
                    : present ? 'manual' : 'retired';
                findings.push({ kind, root, source, visible, contents });
            } else if (entry.isFile() && /\.(?:jsonl|png|json)\.[0-9]{1,10}$/.test(entry.name)) {
                findings.push({ kind: 'manual-temp', root, source });
            }
        }
    }
    await visit(root);
    return findings;
}

/** Startup only, while data-root ownership is held. Preserve all ambiguous evidence. */
export async function applyReconciliation(findings, { log = console.warn } = {}) {
    for (const finding of findings) {
        const { kind, source, root, visible, contents } = finding;
        await checkLocalPath(source, root);
        if (contents !== undefined && await fs.promises.readFile(source, 'utf8') !== contents) throw new Error(`Retirement changed during reconciliation: ${source}`);
        if (visible) {
            await assertContainedChatPath(visible, root);
            const present = await fs.promises.lstat(visible).then(() => true, error => {
                if (error.code === 'ENOENT') return false;
                throw error;
            });
            if ((kind === 'published' && !present) || (kind === 'unpublished' && present)) throw new Error(`Visible path changed during reconciliation: ${visible}`);
        }
        if (kind === 'published' || kind === 'orphan') {
            const destination = await recycleChatPath(source, root);
            log('Lifecycle reconciliation recycled:', source, destination);
        } else if (kind === 'unpublished') {
            const record = JSON.parse(contents);
            delete record.intent;
            delete record.publish_visible_before;
            await writeLifecycleAtomic(source, JSON.stringify(record));
            log('Lifecycle reconciliation retained retirement:', source);
        } else if (kind === 'manual' || kind === 'manual-temp') {
            log('Lifecycle reconciliation requires manual handling; evidence and retirement preserved:', source, visible || 'ambiguous legacy atomic filename');
        }
    }
}

/** Real startup entry point, also used by crash/restart tests. */
export async function reconcileLifecycle(root, options) {
    await restoreLegacyRetiredHolds(root);
    const findings = await scanLifecycle(root);
    await applyReconciliation(findings, options);
    return findings;
}
