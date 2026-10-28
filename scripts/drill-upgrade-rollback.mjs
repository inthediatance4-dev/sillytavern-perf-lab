import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { labServerArguments } from './start-performance-lab.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(repo, 'docs/reviews/2026-10-28-grok-quality/evidence/opus-round3/drill');
const report = { platform: process.platform, node: process.version, checks: [], findings: [], runs: [] };
const children = new Set();
let temporary;
let gitRoot = repo;
let reportName = 'report';
const worktrees = [];
const clean = value => String(value).split(temporary || '\0').join('<tmp>').split(os.hostname()).join('<host>');
function check(condition, message) {
    report.checks.push({ message, pass: Boolean(condition) });
    if (!condition) report.findings.push(message);
}
function command(executable, args, { cwd = repo, env = process.env, timeout = 120000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.on('data', data => { stdout += data; });
        child.stderr.on('data', data => { stderr += data; });
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeout);
        child.once('error', reject);
        child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    });
}
async function git(args) {
    const result = await command('git', args, { cwd: gitRoot });
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.trim();
}
async function snapshot(root, protectedOnly = true) {
    const result = {};
    async function walk(directory, protectedPath = false) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            const included = protectedPath || ['.chat-lifecycle', '.recycle', '.chat-staging'].includes(entry.name);
            assert(!entry.isSymbolicLink(), `Unexpected data symlink: ${file}`);
            if (entry.isDirectory()) {
                if (!protectedOnly || included) result[path.relative(root, file) + '/'] = 'directory';
                await walk(file, included);
            } else if (!protectedOnly || included) {
                const stat = await fs.stat(file);
                result[path.relative(root, file)] = { sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex'), size: stat.size, mtimeMs: stat.mtimeMs };
            }
        }
    }
    if (protectedOnly) {
        for (const directory of ['chats', 'characters', 'group chats']) await walk(path.join(root, 'default-user', directory));
    } else await walk(root);
    return result;
}
async function start(source, dataRoot, label) {
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const config = yaml.parse(await fs.readFile(path.join(source, 'default/config.yaml'), 'utf8'));
    Object.assign(config, { dataRoot, port, listen: false, listenAddress: { ipv4: '127.0.0.1', ipv6: '::1' }, protocol: { ipv4: true, ipv6: false }, exclusiveDataRoot: true, whitelistMode: false, basicAuthMode: false, enableServerPlugins: false });
    config.browserLaunch = { ...config.browserLaunch, enabled: false };
    config.extensions = { ...config.extensions, autoUpdate: false };
    config.ssl = { ...config.ssl, enabled: false };
    const configPath = path.join(temporary, `${label}.yaml`);
    await fs.writeFile(configPath, yaml.stringify(config));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('SILLYTAVERN_')));
    const child = spawn(process.execPath, labServerArguments({ configPath, dataRoot, port }), { cwd: source, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const run = { label, log: '', url: `http://127.0.0.1:${port}`, exit: null };
    report.runs.push(run);
    console.log(`${label}: starting bounded loopback server`);
    child.stdout.on('data', data => { run.log += data; });
    child.stderr.on('data', data => { run.log += data; });
    const closed = new Promise(resolve => child.once('close', (code, signal) => { run.exit = { code, signal }; children.delete(child); resolve(); }));
    child.once('error', error => { run.log += error.message; });
    const watchdog = setTimeout(() => { run.timedOut = true; child.kill('SIGKILL'); }, 240000);
    let cookie = '', token;
    const server = {
        run,
        async stop(signal = 'SIGTERM') {
            const stopStarted = Date.now();
            if (!run.exit) child.kill(signal);
            await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(`${label}: shutdown stuck (watchdog will record failure)`)), 15000); timer.unref(); })]);
            run.shutdown = { signal, elapsedMs: Date.now() - stopStarted };
            clearTimeout(watchdog);
        },
        async post(endpoint, body, allowFailure = false) {
            const form = body instanceof FormData;
            const response = await fetch(run.url + endpoint, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': token, ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: form ? body : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
            const text = await response.text();
            if (!allowFailure) assert(response.ok, `${label} ${endpoint}: ${response.status} ${text}`);
            let value;
            try { value = JSON.parse(text); } catch { value = text; }
            return allowFailure ? { status: response.status, value } : value;
        },
    };
    const deadline = Date.now() + 60000;
    while (!run.exit && Date.now() < deadline) {
        try {
            const response = await fetch(run.url + '/csrf-token', { signal: AbortSignal.timeout(1000) });
            if (response.ok) {
                cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
                token = (await response.json()).token;
                run.started = true;
                return server;
            }
        } catch { /* bounded startup polling */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!run.exit) await server.stop();
    run.started = false;
    return server;
}
const rows = [{ user_name: 'Synthetic', character_name: 'Drill', chat_metadata: {} }, ...Array.from({ length: 6 }, (_, i) => ({ name: 'Synthetic', is_user: i % 2 === 0, mes: `Synthetic message ${i}`, send_date: '2026-10-28', extra: {} }))];
async function create(server, name) {
    const form = new FormData();
    form.set('ch_name', name);
    form.set('file_name', name);
    form.set('first_mes', 'Synthetic drill only');
    return server.post('/api/characters/create', form);
}
async function main() {
    assert.equal(process.platform, 'linux', 'Linux-only drill; Windows hands-on acceptance remains separate');
    await fs.mkdir(output, { recursive: true });
    try {
        await fs.access(path.join(output, `${reportName}.json`));
        reportName = `report-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'st-upgrade-drill-'));
    report.head = await git(['rev-parse', 'HEAD']);
    report.newSource = 'Current working tree (including uncommitted changes)';
    const revisions = { OLD: await git(['rev-parse', 'origin/codex/sillytavern-1.19-sync']), PREV: await git(['rev-parse', '9293a4e']) };
    // Worktree metadata must also stay in the temporary directory. No source .git writes.
    const clone = path.join(temporary, 'git-source');
    await git(['clone', '--no-hardlinks', '--no-checkout', repo, clone]);
    gitRoot = clone;
    const sources = {};
    for (const label of ['OLD', 'PREV']) {
        const commit = revisions[label];
        assert(commit.startsWith(label === 'OLD' ? '48a153e' : '9293a4e'));
        sources[label] = path.join(temporary, label);
        await git(['worktree', 'add', '--detach', sources[label], commit]);
        worktrees.push(sources[label]);
        await fs.symlink(await fs.realpath(path.join(repo, 'node_modules')), path.join(sources[label], 'node_modules'), 'dir');
        report[label] = commit;
    }
    const data = path.join(temporary, 'data');
    await fs.mkdir(data);
    const old = await start(sources.OLD, data, 'old-seed');
    assert(old.run.started, old.run.log);
    const avatar = await create(old, 'Drill');
    await create(old, 'RenameMe');
    for (const file_name of ['deleted', 'retained']) await old.post('/api/chats/save', { avatar_url: avatar, file_name, chat: rows });
    const group = await old.post('/api/groups/create', { name: 'Synthetic Group', members: [avatar] });
    await old.post('/api/chats/group/save', { id: group.chat_id, chat: rows });
    await old.stop();
    check(old.run.exit.code === 0, 'OLD seed stops gracefully');
    await fs.cp(data, path.join(temporary, 'pre-upgrade-backup'), { recursive: true, preserveTimestamps: true });
    const backupContents = async directory => Object.fromEntries(Object.entries(await snapshot(directory, false)).map(([key, value]) => [key, typeof value === 'object' ? { sha256: value.sha256, size: value.size } : value]));
    check(JSON.stringify(await backupContents(data)) === JSON.stringify(await backupContents(path.join(temporary, 'pre-upgrade-backup'))), 'Whole-root pre-upgrade backup paths and bytes match (copy timestamp precision excluded)');
    const upgraded = await start(repo, data, 'new-upgrade');
    assert(upgraded.run.started, upgraded.run.log);
    await upgraded.post('/api/chats/delete', { avatar_url: avatar, chatfile: 'deleted.jsonl' });
    await upgraded.post('/api/characters/rename', { avatar_url: 'RenameMe.png', new_name: 'Renamed' });
    await upgraded.post('/api/chats/save', { avatar_url: avatar, file_name: 'new-format', chat: rows });
    await upgraded.stop('SIGKILL');
    const owner = JSON.parse(await fs.readFile(path.join(data, '.st-lab-owner.lock'), 'utf8'));
    check(owner.v === 2, 'Crash leaves a v2 owner record');
    report.crashedOwner = owner;
    const chats = path.join(data, 'default-user/chats');
    const protectedState = await snapshot(data);
    const deleteRecords = Object.keys(protectedState).filter(file => file.endsWith('.json') && file.includes('.chat-lifecycle/'));
    check((await Promise.all(deleteRecords.map(file => fs.readFile(path.join(data, file), 'utf8')))).some(text => { const record = JSON.parse(text); return record.intent === 'delete' && record.relative_path.endsWith('deleted.jsonl'); }), 'Deleted chat has an intent:delete retirement marker');
    for (const directory of [path.join(chats, 'Drill'), path.join(data, 'default-user/characters'), path.join(data, 'default-user/group chats')]) {
        await fs.mkdir(path.join(directory, '.chat-staging'), { recursive: true });
        await fs.writeFile(path.join(directory, '.chat-staging', randomUUID()), 'synthetic orphan');
    }
    // Clone a real marker to preserve the production path identity and schema.
    const marker = (await fs.readdir(path.join(chats, '.chat-lifecycle'))).find(name => name.endsWith('.json'));
    const record = JSON.parse(await fs.readFile(path.join(chats, '.chat-lifecycle', marker), 'utf8'));
    const { markerPath } = await import('../src/chat-io.js');
    const visible = path.join(chats, 'Drill/published.jsonl');
    await fs.writeFile(visible, rows.map(row => JSON.stringify(row)).join('\n'));
    await fs.writeFile(markerPath(visible, chats), JSON.stringify({ ...record, token: randomUUID(), relative_path: 'Drill/published.jsonl', intent: 'publish', publish_visible_before: false }));
    const beforeCheck = await snapshot(data, false);
    const integrity = await command(process.execPath, ['scripts/check-integrity.mjs', '--data-root', data, '--json']);
    report.integrity = { ...integrity, report: JSON.parse(integrity.stdout) };
    check(integrity.code === 1, 'Integrity exits 1 for expected findings');
    const kinds = report.integrity.report.findings.map(item => item.kind);
    check(kinds.filter(kind => kind === 'orphan').length === 3 && kinds.filter(kind => kind === 'marker-visible-conflict').length === 1 && kinds.includes('recycle-usage') && kinds.every(kind => ['orphan', 'marker-visible-conflict', 'recycle-usage'].includes(kind)), 'Integrity finds exactly three staging orphans, one publish conflict, and nonempty recycle usage only');
    check(JSON.stringify(beforeCheck) === JSON.stringify(await snapshot(data, false)), 'Integrity changes no paths, bytes or mtimes');
    report.observations = ['OLD 48a153e already implements retirement checks and exclusive owner locking; test expectations are measured rather than assumed.'];
    report.rollbacks = [];
    for (const label of ['OLD', 'PREV']) {
        const copy = path.join(temporary, `rollback-${label}`);
        await fs.cp(data, copy, { recursive: true, preserveTimestamps: true });
        const before = await snapshot(copy);
        const server = await start(sources[label], copy, `rollback-${label}`);
        const rollback = { label, started: server.run.started, before };
        report.rollbacks.push(rollback);
        if (server.run.started) {
            const list = await server.post('/api/characters/chats', { avatar_url: avatar });
            const characters = await server.post('/api/characters/all', {});
            const groups = await server.post('/api/groups/all', {});
            rollback.lists = { list, characters: characters.map(card => card.avatar), groups };
            check(!JSON.stringify(list).includes('deleted.jsonl'), `${label}: deleted chat absent before explicit save`);
            check(!JSON.stringify(rollback.lists).includes('.chat-staging') && !JSON.stringify(rollback.lists).includes('synthetic orphan'), `${label}: staging not listed as chats, characters or groups`);
            check(JSON.stringify(await server.post('/api/chats/get', { avatar_url: avatar, file_name: 'retained' })) === JSON.stringify(rows), `${label}: retained chat bytes round trip`);
            check(JSON.stringify(await server.post('/api/chats/group/get', { id: group.chat_id })) === JSON.stringify(rows), `${label}: group chat survives rollback`);
            rollback.ownerWhileRunning = await fs.readFile(path.join(copy, '.st-lab-owner.lock'), 'utf8');
            rollback.ownerBehavior = rollback.ownerWhileRunning === JSON.stringify(owner) ? 'ignored unchanged v2 record' : 'reclaimed/replaced dead v2 record';
            rollback.explicitSave = await server.post('/api/chats/save', { avatar_url: avatar, file_name: 'deleted', chat: rows }, true);
            rollback.afterExplicitSave = await server.post('/api/characters/chats', { avatar_url: avatar });
            report.observations.push(`${label}: ${rollback.ownerBehavior}; explicit save status ${rollback.explicitSave.status}`);
            rollback.explicitResurrection = JSON.stringify(rollback.afterExplicitSave).includes('deleted.jsonl');
            if (rollback.explicitResurrection) report.findings.push(`${label}: explicit save recreates the deleted name; user-action resurrection, not automatic resurrection`);
            await server.stop();
        } else {
            rollback.ownerBehavior = 'startup refused; see run log for exact message';
            check(server.run.exit?.code !== 0, `${label}: refusal exits nonzero`);
        }
        rollback.after = await snapshot(copy);
        check(JSON.stringify(before) === JSON.stringify(rollback.after), `${label}: user lifecycle protected directory paths, hashes, sizes and mtimes unchanged through startup, API operations and shutdown`);
    }
    const browserData = path.join(temporary, 'browser-data');
    await fs.mkdir(browserData);
    const browser = await start(repo, browserData, 'new-browser');
    assert(browser.run.started, browser.run.log);
    const browserOut = path.join(temporary, 'browser-evidence');
    report.browser = await command('/tmp/pw-venv/bin/python', ['tests/browser-lifecycle-lab.py'], { env: { ...process.env, LAB_URL: browser.run.url, LAB_EVIDENCE_DIR: browserOut }, timeout: 180000 });
    report.browser.command = 'LAB_URL=http://127.0.0.1:<port> LAB_EVIDENCE_DIR=<evidence-dir> /tmp/pw-venv/bin/python tests/browser-lifecycle-lab.py';
    try {
        const browserResults = JSON.parse(await fs.readFile(path.join(browserOut, 'results.json'), 'utf8'));
        report.browser.results = browserResults;
    } catch { /* stdout/stderr records browser/network unavailability */ }
    check(report.browser.code === 0, 'Headless NEW browser lifecycle passes');
    await browser.stop('SIGINT');
    check(browser.run.exit.code === 0, 'NEW browser server handles SIGINT gracefully');
    report.summary = { checks: report.checks.length, passed: report.checks.filter(item => item.pass).length, failed: report.checks.filter(item => !item.pass).length, browserPassed: report.browser.code === 0, windowsAcceptance: 'Not performed: Linux-only drill' };
}
try {
    await main();
} catch (error) {
    report.error = error.stack;
    process.exitCode = 1;
} finally {
    for (const child of children) {
        report.findings.push('Server required emergency teardown; this is not a successful graceful shutdown');
        child.kill('SIGKILL');
        await new Promise(resolve => child.once('close', resolve));
    }
    for (const worktree of worktrees.reverse()) {
        try { await git(['worktree', 'remove', '--force', worktree]); }
        catch (error) { report.findings.push(`Worktree cleanup failed: ${error.message}`); process.exitCode = 1; }
    }
    // Retain synthetic data on failure for diagnosis; successful runs remove only this owned temp root.
    report.cleanup = { worktreesRemoved: !report.findings.some(item => item.startsWith('Worktree cleanup failed')), temporaryDataRetained: Boolean(report.error) };
    if (temporary && !report.error) await fs.rm(temporary, { recursive: true, force: true });
    if (report.checks.some(item => !item.pass)) process.exitCode = 1;
    const redacted = JSON.parse(clean(JSON.stringify(report)));
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, `${reportName}.json`), JSON.stringify(redacted, null, 2) + '\n', { flag: 'wx' });
    const markdown = `# Linux synthetic upgrade / rollback drill\n\nNode: ${report.node}; HEAD: ${report.head}\n\n${report.checks.map(item => `- ${item.pass ? 'PASS' : 'FAIL'}: ${item.message}`).join('\n')}\n\n${report.findings.map(item => `- FINDING: ${item}`).join('\n') || 'No unsafe behavior observed.'}\n\n${report.rollbacks?.map(item => `${item.label} v2 owner: ${item.ownerBehavior}`).join('\n\n') || ''}\n\n${report.error ? `Error: ${report.error}\n\n` : ''}${report.observations?.join('\n\n') || ''}\n\nFull API observations, integrity findings, protected-directory snapshots and exact startup logs: [JSON report](${reportName}.json).\n\nBrowser command (start NEW with a fresh synthetic temp root first):\n\n\`\`\`sh\n${report.browser?.command || 'LAB_URL=http://127.0.0.1:<port> LAB_EVIDENCE_DIR=<evidence-dir> /tmp/pw-venv/bin/python tests/browser-lifecycle-lab.py'}\n\`\`\`\n\nWindows hands-on acceptance remains untested. This drill does not authorize deployment.\n`;
    await fs.writeFile(path.join(output, `${reportName}.md`), clean(markdown), { flag: 'wx' });
    console.log(clean(JSON.stringify({ output, checks: report.checks.length, failed: report.checks.filter(item => !item.pass).length, findings: report.findings, error: report.error })));
}
