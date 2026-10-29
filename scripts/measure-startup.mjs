#!/usr/bin/env node
// Measurement harness only. Runtime data, browser profiles and caches stay outside evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { randomUUID, createHash } from 'node:crypto';
import yaml from 'yaml';
import isDocker from 'is-docker';
import { labServerArguments } from './start-performance-lab.mjs';
import { medianDifference, summarize, bootstrapSeed, resamples } from './benchmark-statistics.mjs';
import { createFakeOpenAI } from './fake-openai-endpoint.mjs';
import { describeDataRoot } from './describe-data-root.mjs';
import { write as writeCard } from '../src/character-card-parser.js';

if (process.platform === 'win32') throw new Error('Native Windows needs a CTRL_BREAK console supervisor and a local Python path; run the Linux harness or adapt the documented --launch contract first.');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = { scenario: 'S3', browser: 'warm', runs: 6, output: '.evidence/startup', node: '/tmp/node-v24.22.1-linux-x64/bin/node' };
const flags = new Set(['skip-drop-caches', 'lock-only', 'profile']);
for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i].replace(/^--/, '');
    if (flags.has(key)) args[key] = true;
    else if (['launch', 'scenario', 'browser', 'base', 'head', 'runs', 'output', 'node'].includes(key) && process.argv[i + 1]) args[key] = process.argv[++i];
    else throw new Error(`Unknown or incomplete option: ${process.argv[i]}`);
}
args.runs = Number(args.runs);
if (!Number.isInteger(args.runs) || args.runs < 1 || !['S1', 'S2', 'S3'].includes(args.scenario) || !['warm', 'cold'].includes(args.browser)) throw new Error('Invalid runs/scenario/browser');
if (Boolean(args.base) !== Boolean(args.head)) throw new Error('--base and --head must be supplied together');
if (args.profile && (args.base || args.runs !== 1)) throw new Error('--profile requires --runs 1 without A/B; profiling is separate from timing comparisons');
if (args.node === '/tmp/node-v24.22.1-linux-x64/bin/node') {
    try { await fs.access(args.node); } catch { args.node = 'node'; }
}
const output = path.resolve(args.output);
await fs.mkdir(output, { recursive: true });
// Refuse to overwrite retained measurements, including failed attempts.
await fs.writeFile(path.join(output, 'invocation.json'), '{}\n', { flag: 'wx' });
await fs.writeFile(path.join(output, '.gitignore'), 'browser-profile/\n');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'startup-measure-'));
const mono = () => process.hrtime.bigint();
const elapsed = t => Number(mono() - t) / 1e6;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms).unref());
function redact(value) {
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const [source, target] of [[repo, '<repo>'], [temporary, '<tmp>'], [os.homedir(), '<home>'], [os.hostname(), '<host>']]) text = text.split(source).join(target);
    text = text.replace(/\/workspace\/[^\s"'<>]*/g, '<repo>').replace(/\/home\/box\b/g, '<home>').replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://<host>');
    return typeof value === 'string' ? text : JSON.parse(text);
}
async function json(name, value) { await fs.writeFile(path.join(output, name), JSON.stringify(redact(value), null, 2) + '\n'); }
async function command(cmd, argv, options = {}) {
    const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    if (code !== 0) throw new Error(`${cmd} exited ${code}: ${stderr}`);
    return stdout;
}
async function freePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
async function materialize(input) {
    if (!input || input === 'WORKTREE') return { directory: repo, revision: 'WORKTREE' };
    try {
        if ((await fs.stat(input)).isDirectory()) return { directory: await fs.realpath(input), revision: input };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const revision = (await command('git', ['rev-parse', '--verify', `${input}^{commit}`], { cwd: repo })).trim();
    const directory = path.join(temporary, `product-${randomUUID()}`);
    await fs.mkdir(directory);
    const archive = path.join(temporary, `${randomUUID()}.tar`);
    await command('git', ['archive', '--output', archive, revision], { cwd: repo });
    await command('tar', ['-xf', archive, '-C', directory]);
    await fs.symlink(await fs.realpath(path.join(repo, 'node_modules')), path.join(directory, 'node_modules'), 'junction');
    return { directory, revision };
}
let generation = null;
const fake = await createFakeOpenAI({ reply: 'Synthetic reply' });
const fakeUrl = fake.url;
const port = await freePort();
const origin = `http://127.0.0.1:${port}/`;
const settings = JSON.parse(await fs.readFile(path.join(repo, 'default/content/settings.json'), 'utf8'));
Object.assign(settings, { firstRun: false, username: 'Synthetic Tester', main_api: 'openai' });
Object.assign(settings.oai_settings, { chat_completion_source: 'custom', custom_url: fakeUrl, custom_model: 'startup-synthetic', stream_openai: false });
settings.power_user.auto_connect = true;
const fixtureChat = [ { user_name: 'Synthetic Tester', character_name: 'Startup Synthetic', chat_metadata: { integrity: 'startup-synthetic' } },
    { name: 'Synthetic Tester', is_user: true, mes: 'Synthetic greeting', send_date: '2026-01-01T00:00:00.000Z', extra: {} },
    { name: 'Startup Synthetic', is_user: false, mes: 'Synthetic ready', send_date: '2026-01-01T00:00:01.000Z', extra: {} } ];
const cardData = { name: 'Startup Synthetic', description: 'Synthetic startup fixture', personality: '', scenario: '', first_mes: 'Synthetic ready', mes_example: '', creatorcomment: '', avatar: 'none', chat: 'startup-chat', talkativeness: '0.5', fav: false,
    spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Startup Synthetic', description: 'Synthetic startup fixture', personality: '', scenario: '', first_mes: 'Synthetic ready', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '', extensions: { talkativeness: '0.5', fav: false } } };
const png = writeCard(await fs.readFile(path.join(repo, 'public/img/ai4.png')), JSON.stringify(cardData));
async function resetFixture(lab) {
    const user = path.join(lab.dataRoot, 'default-user');
    await fs.mkdir(path.join(user, 'characters'), { recursive: true });
    await fs.mkdir(path.join(user, 'chats', 'StartupSynthetic'), { recursive: true });
    await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify(settings));
    await fs.writeFile(path.join(user, 'characters', 'StartupSynthetic.png'), png);
    await fs.writeFile(path.join(user, 'chats', 'StartupSynthetic', 'startup-chat.jsonl'), fixtureChat.map(row => JSON.stringify(row)).join('\n') + '\n');
}
const products = {};
for (const [side, input] of args.base ? [['base', args.base], ['head', args.head]] : [['head', null]]) {
    const product = await materialize(input);
    const dir = path.join(temporary, side);
    await fs.mkdir(dir);
    const lab = { dataRoot: path.join(dir, 'data'), configPath: path.join(dir, 'config.yaml'), port };
    const config = yaml.parse(await fs.readFile(path.join(product.directory, 'default/config.yaml'), 'utf8'));
    Object.assign(config, { dataRoot: lab.dataRoot, port, listen: false, exclusiveDataRoot: true, listenAddress: { ipv4: '127.0.0.1', ipv6: '::1' }, protocol: { ipv4: true, ipv6: false }, enableServerPlugins: false });
    config.ssl.enabled = false; config.browserLaunch.enabled = false;
    config.extensions.enabled = true; config.extensions.autoUpdate = false;
    await fs.writeFile(lab.configPath, yaml.stringify(config));
    await resetFixture(lab);
    // Keep exactly one synthetic card while allowing ordinary default presets/templates to seed.
    const index = JSON.parse(await fs.readFile(path.join(product.directory, 'default/content/index.json'), 'utf8'));
    await fs.writeFile(path.join(lab.dataRoot, 'default-user/content.log'), index.filter(item => item.type === 'character').map(item => item.filename).join('\n'));
    const sourceFiles = (await command('git', ['ls-files'], { cwd: repo })).trim().split('\n');
    const sourceHash = createHash('sha256');
    for (const file of [...new Set([...sourceFiles, 'src/startup-trace.js'])].sort()) {
        if (file.startsWith('docs/')) continue;
        try { sourceHash.update(file + '\0').update(await fs.readFile(path.join(product.directory, file))); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    products[side] = { ...product, lab, productSourceSha256: sourceHash.digest('hex') };
}
let worker, workerLines;
async function browserMeasure(side, trace) {
    worker.stdin.write(JSON.stringify({ origin, browser: args.browser, profile: path.join(output, 'browser-profile', 'shared'), trace }) + '\n');
    const line = await Promise.race([workerLines.next(), sleep(120000).then(() => { throw new Error('Browser worker deadline exceeded'); })]);
    if (line.done) throw new Error('Browser worker exited');
    const result = JSON.parse(line.value);
    if (!result.ok) throw new Error(result.error);
    return result.result;
}
async function cacheState(product, label) {
    const webpackRoot = isDocker() ? path.join(product.directory, 'dist/_webpack') : path.join(product.lab.dataRoot, '_webpack');
    if (args.scenario === 'S1') {
        for (const version of await fs.readdir(webpackRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
            if (version === '.recycle') continue;
            const cache = path.join(webpackRoot, version, 'cache');
            try {
                await fs.access(cache);
                await fs.mkdir(path.join(webpackRoot, '.recycle'), { recursive: true });
                await fs.rename(cache, path.join(webpackRoot, '.recycle', `${label}-${version}-${randomUUID()}`));
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
    if (args.scenario === 'S2' && !args['skip-drop-caches']) {
        if (process.platform !== 'linux') throw new Error('S2 automated cache drop requires Linux; use --skip-drop-caches and label it unflushed');
        await command('sync', []);
        // Noninteractive sudo fails clearly when unavailable; never silently label an unflushed run cold.
        await command('sudo', ['-n', 'sh', '-c', 'echo 3 > /proc/sys/vm/drop_caches']);
    }
    return { scenario: args.scenario, osCacheDropped: args.scenario === 'S2' && !args['skip-drop-caches'], webpackRoot };
}
async function httpReady(child, t0) {
    while (elapsed(t0) < 120000) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Server exited before HTTP readiness');
        try {
            const csrf = await fetch(origin + 'csrf-token', { signal: AbortSignal.timeout(1000) });
            const token = await csrf.json();
            if (csrf.ok && typeof token.token === 'string' && token.token) {
                const lib = await fetch(origin + 'lib.js', { signal: AbortSignal.timeout(3000) });
                await lib.arrayBuffer();
                if (lib.status === 200) return elapsed(t0);
            }
        } catch { /* Server has not bound/listened yet. */ }
        await sleep(10);
    }
    throw new Error('Startup HTTP deadline exceeded (120s)');
}
function traceSummary(events) {
    const stages = {}, begins = new Map();
    for (const event of events) {
        if (event.name.endsWith('_begin')) begins.set(event.name.slice(0, -6), event);
        if (event.name === 'server_main_imported') stages.server_main_import = Number(BigInt(event.t.hrtimeNs) - BigInt(begins.get('server_main_import').t.hrtimeNs)) / 1e6;
        if (event.name.endsWith('_end')) {
            const key = event.name.slice(0, -4), start = begins.get(key);
            if (start) stages[key] = (stages[key] ?? 0) + Number(BigInt(event.t.hrtimeNs) - BigInt(start.t.hrtimeNs)) / 1e6;
        }
    }
    return { stagesMs: stages, nodeTiming: events.find(e => e.name === 'node_timing')?.detail,
        ready: events.find(e => e.name === 'listen_ready')?.detail, webpack: events.find(e => e.name === 'webpack_stats')?.detail,
        lifecycleScans: events.filter(e => e.name === 'lifecycle_scan_stats').map(e => e.detail),
        childSpawns: events.filter(e => e.name === 'child_spawn').map(e => e.detail), events: events.length };
}
const records = [], locks = [];
async function run(side, label, discarded = false) {
    const product = products[side];
    await resetFixture(product.lab);
    const cache = await cacheState(product, label);
    const traceFile = path.join(temporary, `${label}.jsonl`);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('SILLYTAVERN_')));
    Object.assign(env, { ST_STARTUP_TRACE: traceFile, ST_LAB_CONFIG: product.lab.configPath, ST_LAB_DATA_ROOT: product.lab.dataRoot, ST_LAB_PORT: String(port), ST_LAB_NODE: args.node });
    let logs = '', child, exit;
    const epochMs = Date.now(), t0 = mono();
    const result = { side, label, discarded, cache, t0: { epochMs, hrtimeNs: t0.toString() }, status: 'failed' };
    generation = null;
    fake.reset();
    try {
        const profileArgs = args.profile ? ['--cpu-prof', `--cpu-prof-dir=${temporary}`, '--cpu-prof-name=startup.cpuprofile'] : [];
        // A custom launch command inherits ST_LAB_*; it must use that isolated root/config/port.
        child = args.launch ? spawn(args.launch, { shell: true, cwd: product.directory, env, detached: process.platform !== 'win32' })
            : spawn(args.node, [...profileArgs, ...labServerArguments(product.lab)], { cwd: product.directory, env, detached: process.platform !== 'win32' });
        exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
        child.stdout.on('data', chunk => logs += chunk); child.stderr.on('data', chunk => logs += chunk);
        result.httpMs = await httpReady(child, t0);
        if (!(await fs.stat(path.join(product.lab.dataRoot, '.st-lab-owner.lock'))).isFile()) throw new Error('Server ready without required owner lock');
        if (!args['lock-only']) {
            const trace = args.profile ? path.join(temporary, 'chromium-trace.json') : undefined;
            result.browser = await browserMeasure(side, trace);
            generation = fake.generations.at(-1);
            if (!generation) throw new Error('No generation request reached fake server');
            result.uiMs = result.browser.uiEpochMs - epochMs;
            result.sendMs = Number(BigInt(generation.receivedNs) - t0) / 1e6;
            result.navigationToUiMs = result.browser.navigationToUiMs;
            result.uiAfterHttpMs = result.uiMs - result.httpMs;
            result.sendAfterUiMs = result.sendMs - result.uiMs;
            result.generation = { path: generation.path, model: generation.model, messageCount: generation.messageCount };
            if (result.uiAfterHttpMs < 0 || result.sendAfterUiMs < 0) throw new Error('Endpoint clocks are out of order');
        }
        result.status = 'ok';
    } catch (error) { result.error = error.stack; }
    finally {
        if (child && child.exitCode === null && child.signalCode === null) {
            // Signal the whole launch group so shell/npm launchers also reach the server.
            if (process.platform === 'win32') {
                // Requires a console-owning wrapper to deliver CTRL_C_EVENT; taskkill would skip graceful cleanup.
                result.error = 'Windows graceful SIGINT needs a console wrapper; see README'; result.status = 'failed';
            } else process.kill(-child.pid, 'SIGINT');
        }
        if (exit) {
            try { result.exit = await Promise.race([exit, sleep(30000).then(() => { throw new Error('SIGINT exit deadline exceeded'); })]); }
            catch (error) { result.error = error.message; result.status = 'failed'; if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }
        }
        result.lockGone = await fs.lstat(path.join(product.lab.dataRoot, '.st-lab-owner.lock')).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; });
        if (!result.lockGone || result.exit?.code !== 0) { result.status = 'failed'; result.error ??= 'Shutdown/owner lock verification failed'; }
        let events = [];
        try { events = (await fs.readFile(traceFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
        catch (error) { result.traceUnavailable = error.code ?? error.message; }
        result.trace = traceSummary(events);
        if (result.browser) {
            const browser = result.browser;
            await fs.writeFile(path.join(output, `${label}.browser.json.gz`), gzipSync(JSON.stringify(redact(browser))));
            result.browser = { navEpochMs: browser.navEpochMs, uiEpochMs: browser.uiEpochMs, navigationToUiMs: browser.navigationToUiMs,
                resourceCounts: browser.resourceCounts, chromium: browser.chromium, pageErrors: browser.pageErrors,
                appReadyMs: browser.atUi.appReadyMs, atUiResourceCount: browser.atUi.resourceCount,
                atUiTransferBytes: browser.atUi.transferBytes, probe: `${label}.browser.json.gz` };
        }
        await fs.writeFile(path.join(output, `${label}.trace.jsonl.gz`), gzipSync(redact(events.map(e => JSON.stringify(e)).join('\n') + '\n')));
        await fs.writeFile(path.join(output, `${label}.log.gz`), gzipSync(redact(logs)));
        await json(`${label}.json`, result);
        locks.push(`${label}: status=${result.status} exit=${result.exit?.code} lockGone=${result.lockGone}`);
        await fs.writeFile(path.join(output, 'lock-check.txt'), locks.join('\n') + '\n');
    }
    console.log(`${label}: ${result.status} http=${result.httpMs?.toFixed(1)} ui=${result.uiMs?.toFixed(1)} send=${result.sendMs?.toFixed(1)} lockGone=${result.lockGone}`);
    if (result.status !== 'ok') throw new Error(`${label} failed: ${result.error}`);
    if (!discarded) records.push(result);
}
try {
    if (!args['lock-only']) {
        worker = spawn('/tmp/pw-venv/bin/python', ['-u', path.join(repo, 'scripts/measure-startup-browser.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
        workerLines = createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
        const ready = JSON.parse((await workerLines.next()).value);
        if (!ready.ready) throw new Error('Browser failed to launch');
        await json('browser-version.json', ready);
    }
    const toolFiles = ['scripts/benchmark-statistics.mjs', 'scripts/start-performance-lab.mjs', 'tests/lab_browser.py', 'server.js', 'src/startup-trace.js', 'src/server-main.js', 'src/process-identity.js', 'src/data-root-owner.js', 'src/lifecycle-reconcile.js', 'src/middleware/webpack-serve.js', 'scripts/measure-startup.mjs', 'scripts/measure-startup-browser.py', 'scripts/startup-browser-probe.js', 'scripts/describe-data-root.mjs'];
    const hashes = {};
    for (const file of toolFiles) hashes[file] = createHash('sha256').update(await fs.readFile(path.join(repo, file))).digest('hex');
    await json('invocation.json', { args, temporary, products, toolCommit: (await command('git', ['rev-parse', 'HEAD'], { cwd: repo })).trim(), toolSourceSha256: hashes,
        node: (await command(args.node, ['--version'])).trim(), os: { platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus().length, cpu: os.cpus()[0]?.model, totalMemory: os.totalmem() }, bootstrapSeed, resamples });
    // Every side gets an untimed fixture/cache/browser warmup before any scenario's samples.
    for (const side of Object.keys(products)) await run(side, `warmup-${side}`, true);
    for (let i = 0; i < args.runs; i++) for (const side of Object.keys(products)) await run(side, `${String(i + 1).padStart(2, '0')}-${side}`);
    const metrics = args['lock-only'] ? ['httpMs'] : ['httpMs', 'uiMs', 'sendMs', 'navigationToUiMs', 'uiAfterHttpMs', 'sendAfterUiMs'];
    const comparison = { metrics: {}, allCiIncludeZero: true, runsPerSide: args.runs, order: records.map(r => r.label), bootstrapSeed, resamples };
    for (const metric of metrics) {
        const sides = Object.fromEntries(Object.keys(products).map(side => [side, records.filter(r => r.side === side).map(r => r[metric])]));
        const row = { summaries: Object.fromEntries(Object.entries(sides).map(([side, values]) => [side, summarize(values)])) };
        if (sides.base) { row.difference = medianDifference(sides.base, sides.head); row.ciIncludesZero = row.difference.ci95[0] <= 0 && row.difference.ci95[1] >= 0; comparison.allCiIncludeZero &&= row.ciIncludesZero; }
        comparison.metrics[metric] = row;
    }
    await json('comparison.json', comparison);
    for (const [side, product] of Object.entries(products)) await json(`data-root-${side}.json`, await describeDataRoot(product.lab.dataRoot));
    if (args.profile) for (const name of ['startup.cpuprofile', 'chromium-trace.json']) await fs.writeFile(path.join(output, name + '.gz'), gzipSync(redact(await fs.readFile(path.join(temporary, name), 'utf8'))));
    console.log(JSON.stringify({ samples: records.length, allCiIncludeZero: comparison.allCiIncludeZero, output: redact(output) }));
} finally {
    worker?.stdin.end();
    if (worker) await new Promise(resolve => { worker.once('exit', resolve); setTimeout(() => { worker.kill(); resolve(); }, 5000).unref(); });
    await fake.close();
    // Retain temp fixture/caches. Cleanup is deliberately manual and recoverable.
}
