import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import { keyToEnv, toBoolean } from './util.js';

const MiB = 1024 * 1024;
const evidencePath = new URL('../docs/reviews/2026-10-28-grok-quality/evidence/opus-round3/export-memory.json', import.meta.url);

export function parseDeployArgs(args) {
    args = args.flatMap(arg => {
        const index = arg.indexOf('=');
        return index > 0 ? [arg.slice(0, index), arg.slice(index + 1)] : [arg];
    });
    const options = {};
    const names = { '--config': 'configPath', '--configPath': 'configPath', '--data-root': 'dataRoot', '--dataRoot': 'dataRoot' };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--json' && !options.json) options.json = true;
        else if (arg === '--no-exclusiveDataRoot' && options.exclusiveDataRoot === undefined) options.exclusiveDataRoot = false;
        else if (arg === '--exclusiveDataRoot' && options.exclusiveDataRoot === undefined) {
            options.exclusiveDataRoot = true;
            if (['true', 'false'].includes(args[i + 1])) options.exclusiveDataRoot = args[++i] === 'true';
        } else if (names[arg] && options[names[arg]] === undefined && args[i + 1] && !args[i + 1].startsWith('--')) {
            options[names[arg]] = args[++i];
        } else throw new Error('Usage: npm run check:deploy -- [--config <file>] [--data-root <dir>] [--exclusiveDataRoot [true|false]] [--json]');
    }
    return options;
}

/** Read-only hint, not an allocation guarantee. Paths/providers are injectable for container tests. */
export async function checkDeploy(options = {}, {
    env = process.env,
    cgroupPaths = ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes', '/sys/fs/cgroup/memory.limit_in_bytes'],
    totalmem = os.totalmem,
    memoryEvidence = evidencePath,
    access = fs.access,
} = {}) {
    const configPath = path.resolve(options.configPath ?? './config.yaml');
    const config = yaml.parse(await fs.readFile(configPath, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Config must be a YAML mapping');
    const effective = (key, fallback) => env[keyToEnv(key)] ?? key.split('.').reduce((value, part) => value?.[part], config) ?? fallback;
    const dataRoot = path.resolve(options.dataRoot ?? effective('dataRoot', './data'));
    const exclusiveDataRoot = options.exclusiveDataRoot ?? toBoolean(effective('exclusiveDataRoot', false));
    const rawRecycle = effective('backups.chat.maxRecycleBytes', -1);
    const maxRecycleBytes = isNaN(parseFloat(rawRecycle)) ? -1 : parseFloat(rawRecycle);
    const checks = [];
    const add = (level, check, message) => checks.push({ level, check, message });
    add(exclusiveDataRoot ? 'OK' : 'FAIL', 'exclusiveDataRoot', `exclusiveDataRoot=${exclusiveDataRoot}; exclusive ownership is a deployment prerequisite.`);
    add('INFO', 'maxRecycleBytes', `backups.chat.maxRecycleBytes=${maxRecycleBytes}. Default -1 keeps recycled backups (no automatic deletion); disk usage can grow. A nonnegative budget trades retention for disk space.`);
    let rootReady = false;
    try {
        const stat = await fs.stat(dataRoot);
        if (!stat.isDirectory()) throw new Error('not a directory');
        await access(dataRoot, constants.W_OK | constants.X_OK);
        rootReady = true;
        add('OK', 'dataRoot', 'Data root exists and is writable (access check only; no probe file created).');
    } catch (error) { add('FAIL', 'dataRoot', `Data root unavailable or not writable: ${error.message}`); }

    let largestChat = { path: null, bytes: 0 };
    async function visit(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            if (['.recycle', '.chat-staging', '.chat-lifecycle', 'backups'].includes(entry.name) || entry.isSymbolicLink()) continue;
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(target);
            else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                const stat = await fs.stat(target);
                if (stat.size > largestChat.bytes) largestChat = { path: target, bytes: stat.size };
            }
        }
    }
    if (rootReady) {
        try { await visit(dataRoot); }
        catch (error) { add('WARN', 'chatScan', `Largest chat scan incomplete: ${error.message}`); }
    }
    const hostBytes = totalmem();
    let memoryLimit = { bytes: hostBytes, source: 'os.totalmem()' };
    for (const file of cgroupPaths) {
        try {
            const raw = (await fs.readFile(file, 'utf8')).trim();
            // v2 "max" and v1's huge unlimited sentinel must not hide a smaller host limit.
            if (!/^\d+$/.test(raw)) continue;
            const bytes = Number(raw);
            if (bytes > 0 && bytes < memoryLimit.bytes) memoryLimit = { bytes, source: file };
        } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') add('WARN', 'memoryDetection', `Cannot read ${file}: ${error.message}`);
        }
    }
    let exportEstimate = { bytes: 150 * MiB, source: 'Fallback constant: 150 MiB process RSS allowance for bounded streaming export; not a measured guarantee.' };
    try {
        const measured = JSON.parse(await fs.readFile(memoryEvidence, 'utf8'));
        if (!(measured.current?.peakRss > 0) || !(measured.inputBytes > 0)) throw new Error('missing positive inputBytes/current.peakRss');
        exportEstimate = {
            bytes: Math.max(150 * MiB, Math.ceil(measured.current.peakRss * 1.25)),
            measuredInputBytes: measured.inputBytes,
            measuredPeakRssBytes: measured.current.peakRss,
            source: `Measured streaming export: input=${measured.inputBytes} bytes, peak RSS=${measured.current.peakRss} bytes (${memoryEvidence}); allowance=max(150 MiB, peak RSS × 1.25).`,
        };
    } catch (error) {
        if (error.code !== 'ENOENT') add('WARN', 'memoryEvidence', `Cannot use export evidence: ${error.message}`);
    }
    add('INFO', 'largestChat', `Largest visible JSONL chat: ${largestChat.bytes} bytes (${largestChat.path ?? 'none'}). Streaming export memory is bounded rather than proportional to file size.`);
    add('INFO', 'exportEstimate', `${exportEstimate.source} Estimated need=${exportEstimate.bytes} bytes. Concurrent requests, very large individual rows, and other server work need additional headroom.`);
    const low = memoryLimit.bytes < 512 * MiB || memoryLimit.bytes < exportEstimate.bytes;
    add(low ? 'WARN' : 'OK', 'memoryLimit', `Memory limit=${memoryLimit.bytes} bytes (${memoryLimit.source}); warn below 512 MiB or estimated export need.`);
    return { configPath, dataRoot, exclusiveDataRoot, maxRecycleBytes, largestChat, memoryLimit, exportEstimate, checks, exitCode: checks.some(check => ['WARN', 'FAIL'].includes(check.level)) ? 1 : 0 };
}
