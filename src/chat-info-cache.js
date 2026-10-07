import fs from 'node:fs';
import path from 'node:path';

/**
 * Create a process-local cache for recent-chat info, without caller annotations.
 * Every access stats the resolved file with bigint timestamps. A read is retained
 * only if its pre/post identities match and it still owns the pending slot.
 *
 * Limits count retained snapshots, not file sizes. Byte weights conservatively
 * include UTF-8 JSON, UTF-16 strings and key/object overhead; they are estimates,
 * not a measured heap limit. Expired snapshots are pruned on access (no timer).
 * Pending overflow reads normally but is neither coalesced nor retained.
 *
 * @param {(file: string, metadata: boolean) => Promise<object>} readInfo Reader without annotations or a search matcher.
 * @param {object} [options] Cache limits and deterministic test dependencies.
 * @param {typeof fs.promises.stat} [options.stat] File stat implementation.
 * @param {() => number} [options.now] Clock in milliseconds.
 * @param {number} [options.maxEntries=256] Maximum retained snapshots.
 * @param {number} [options.maxBytes=8388608] Maximum total estimated bytes (8 MiB).
 * @param {number} [options.maxEntryBytes=524288] Maximum estimated bytes per snapshot (512 KiB).
 * @param {number} [options.maxPending=256] Maximum coalescing records.
 * @param {number} [options.ttlMs=60000] Absolute lifetime from insertion (60 seconds).
 * @returns {(file: string, additionalData?: object, withMetadata?: boolean) => Promise<object>} Cached reader.
 */
export function createChatInfoCache(readInfo, options = {}) {
    const stat = options.stat ?? ((file, statOptions) => fs.promises.stat(file, statOptions));
    const now = options.now ?? Date.now;
    const maxEntries = options.maxEntries ?? 256;
    const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    const maxEntryBytes = options.maxEntryBytes ?? 512 * 1024;
    const maxPending = options.maxPending ?? 256;
    const ttlMs = options.ttlMs ?? 60_000;
    for (const limit of [maxEntries, maxBytes, maxEntryBytes, maxPending, ttlMs]) {
        if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Cache limits must be nonnegative safe integers');
    }
    const entries = new Map();
    const pending = new Map();
    let retainedBytes = 0;

    const discard = key => {
        const entry = entries.get(key);
        if (entry) { retainedBytes -= entry.weight; entries.delete(key); }
    };
    const prune = () => {
        const time = now();
        for (const [key, entry] of entries) if (entry.expiresAt <= time) discard(key);
    };
    const identity = stats => {
        // BigIntStats provides nanoseconds. The fallback allows regular injected
        // Stats while keeping the version tuple's units consistent.
        const ns = (exact, ms) => exact ?? BigInt(Math.round(Number(ms) * 1_000_000));
        return [stats.dev, stats.ino, stats.size, ns(stats.mtimeNs, stats.mtimeMs), ns(stats.ctimeNs, stats.ctimeMs)].map(String).join(':');
    };
    const valid = value => value !== null && typeof value === 'object' && !Array.isArray(value)
        && typeof value.file_name === 'string' && value.file_name.length > 0
        && Number.isFinite(value.chat_items) && value.chat_items >= 0;
    const annotated = (value, additionalData) => {
        const copy = structuredClone(value);
        // Invalid reader responses (including {}) keep their original semantics.
        return valid(copy) ? Object.assign(copy, structuredClone(additionalData)) : copy;
    };
    const retain = (key, version, value) => {
        if (!valid(value) || maxEntries === 0 || ttlMs === 0) return;
        const json = JSON.stringify(value);
        let weight = Buffer.byteLength(json, 'utf8') + json.length * 2 + key.length * 2 + 256;
        if (weight > maxEntryBytes || weight > maxBytes) return;
        const objects = [value];
        while (objects.length) {
            const object = objects.pop();
            const values = Object.values(object);
            weight += 64 + values.length * 16;
            if (weight > maxEntryBytes || weight > maxBytes) return;
            for (const child of values) if (child !== null && typeof child === 'object') objects.push(child);
        }
        discard(key);
        while (entries.size >= maxEntries || retainedBytes + weight > maxBytes) discard(entries.keys().next().value);
        entries.set(key, { version, value, weight, expiresAt: now() + ttlMs });
        retainedBytes += weight;
    };

    return async function getCachedInfo(file, additionalData = {}, withMetadata = false) {
        const resolved = path.resolve(file);
        const metadata = Boolean(withMetadata);
        const key = JSON.stringify([resolved, metadata]);
        prune();
        let version;
        // A stat may settle after another call has installed a newer record.
        // Re-stat in that case instead of invalidating that newer observation.
        for (;;) {
            const priorEntry = entries.get(key);
            const priorPending = pending.get(key);
            try {
                version = identity(await stat(resolved, { bigint: true }));
            } catch (error) {
                if (entries.get(key) === priorEntry) discard(key);
                if (pending.get(key) === priorPending) pending.delete(key);
                throw error;
            }
            if (entries.get(key) === priorEntry && pending.get(key) === priorPending) break;
        }
        const cached = entries.get(key);
        if (cached && cached.version === version && cached.expiresAt > now()) {
            entries.delete(key);
            entries.set(key, cached);
            return annotated(cached.value, additionalData);
        }
        discard(key);
        const existing = pending.get(key);
        if (existing?.version === version) return annotated(await existing.promise, additionalData);

        // A newer version supersedes this key's old pending record. Completion
        // cleanup uses record identity, so the older operation cannot win later.
        if (existing) pending.delete(key);
        const tracked = pending.size < maxPending;
        const record = { version, promise: null };
        if (tracked) pending.set(key, record);
        record.promise = (async () => {
            try {
                const snapshot = structuredClone(await readInfo(resolved, metadata));
                const after = identity(await stat(resolved, { bigint: true }));
                if (tracked && pending.get(key) === record && after === version) retain(key, version, snapshot);
                return snapshot;
            } catch (error) {
                if (tracked && pending.get(key) === record) discard(key);
                throw error;
            } finally {
                if (tracked && pending.get(key) === record) pending.delete(key);
            }
        })();
        return annotated(await record.promise, additionalData);
    };
}
