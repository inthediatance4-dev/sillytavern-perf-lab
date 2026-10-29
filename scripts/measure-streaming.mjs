#!/usr/bin/env node
// Linux lab orchestrator; products, data, profiles and caches stay in temporary roots.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import yaml from 'yaml';
import { createFakeOpenAI } from './fake-openai-endpoint.mjs';
import { measureStreamingMetrics } from './streaming-measurement.mjs';
import { labServerArguments } from './start-performance-lab.mjs';
import { prepareTemporaryLab } from './longchat-lab-server.mjs';
import { write as writeCard } from '../src/character-card-parser.js';
import { medianDifference, summarize, bootstrapSeed, resamples } from './benchmark-statistics.mjs';

if (process.platform === 'win32') throw new Error('Run this measurement orchestrator on Linux (archive extraction and graceful process-group shutdown); endpoint/unit tests support Windows.');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = { scenario: 'main', runs: 10, output: '.evidence/streaming', node: process.execPath, python: process.env.LAB_PYTHON || '/tmp/pw-venv/bin/python', rate: 200, seed: 'opus-streaming-s0', jitter: 0.25 };
for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i].replace(/^--/, '');
    if (['matrix', 'smoke'].includes(key)) args[key] = true;
    else if (['scenario', 'runs', 'output', 'node', 'python', 'base', 'head', 'rate', 'seed', 'jitter', 'messages', 'tokens', 'smooth', 'reasoning', 'mode', 'timing-overlay'].includes(key) && process.argv[i + 1]) args[key] = process.argv[++i];
    else throw new Error(`Unknown or incomplete option: ${process.argv[i]}`);
}
for (const key of ['runs', 'rate', 'jitter']) args[key] = Number(args[key]);
if (!Number.isInteger(args.runs) || args.runs < 1 || Boolean(args.base) !== Boolean(args.head)) throw new Error('Invalid runs or incomplete --base/--head pair');
const presets = {
    main: { messages: 2000, tokens: 3000, smooth: false, reasoning: false, mode: 'send' },
    short: { messages: 100, tokens: 500, smooth: false, reasoning: false, mode: 'send' },
    smooth: { messages: 2000, tokens: 3000, smooth: true, reasoning: false, mode: 'send' },
    reasoning: { messages: 2000, tokens: 3000, smooth: false, reasoning: true, mode: 'send' },
    continue: { messages: 2000, tokens: 3000, smooth: false, reasoning: false, mode: 'continue' },
};
const scenarios = args.matrix ? Object.entries(presets) : args.scenario.split(',').map(name => {
    if (!presets[name]) throw new Error(`Unknown scenario: ${name}`);
    const scenario = { ...presets[name] };
    for (const key of ['messages', 'tokens']) if (args[key] !== undefined) scenario[key] = Number(args[key]);
    for (const key of ['smooth', 'reasoning']) if (args[key] !== undefined) {
        if (!['on', 'off', 'none', 'with'].includes(args[key])) throw new Error(`Invalid ${key}`);
        scenario[key] = ['on', 'with'].includes(args[key]);
    }
    if (args.mode) scenario.mode = args.mode;
    if (![100, 2000].includes(scenario.messages) || ![500, 3000].includes(scenario.tokens) || !['send', 'continue'].includes(scenario.mode)) throw new Error('Invalid scenario dimensions');
    return [name, scenario];
});
const runsFor = name => args.matrix && name === 'main' && !args.smoke ? Math.max(10, args.runs) : args.runs;
if (!args.smoke && scenarios.some(([name]) => runsFor(name) < (name === 'main' ? 10 : 7))) throw new Error('Acceptance requires >=10 main / >=7 other runs (use --smoke only for tool debugging)');
const output = path.resolve(args.output);
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'invocation.json'), '{}\n', { flag: 'wx' });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'streaming-measure-'));
function redact(value) {
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const [source, target] of [[repo, '<repo>'], [temporary, '<tmp>'], [os.homedir(), '<home>'], [os.hostname(), '<host>']]) text = text.split(source).join(target);
    text = text.replace(/\/workspace\/[^\s"'<>]*/g, '<repo>').replace(/\/home\/box\b/g, '<home>').replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://<host>');
    return typeof value === 'string' ? text : JSON.parse(text);
}
async function json(name, value) { await fs.writeFile(path.join(output, name), JSON.stringify(redact(value), null, 2) + '\n'); }
async function command(executable, argv, cwd = repo) {
    const child = spawn(executable, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    if (code !== 0) throw new Error(`${executable} exited ${code}: ${stderr}`);
    return stdout;
}
async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
const products = {}, records = [];
let worker, lines;
const fake = await createFakeOpenAI();
function isLiveTree(input) {
    // WORKTREE measures this checkout, including uncommitted edits. An omitted side does the same.
    if (!input || input === 'WORKTREE') return true;
    return path.resolve(input) === repo;
}
async function materialize(side, input) {
    const live = isLiveTree(input);
    const revision = live ? 'WORKTREE' : (await command('git', ['rev-parse', '--verify', `${input}^{commit}`])).trim();
    let directory = repo;
    if (!live) {
        directory = path.join(temporary, `product-${side}`);
        await fs.mkdir(directory);
        const archive = path.join(temporary, `${side}.tar`);
        await command('git', ['archive', '--output', archive, revision]);
        await command('tar', ['-xf', archive, '-C', directory]);
        await fs.symlink(await fs.realpath(path.join(repo, 'node_modules')), path.join(directory, 'node_modules'), 'junction');
        if (args['timing-overlay']) {
            // Explicit instrumentation-only patch for historical products without S0 probes.
            const patch = path.resolve(args['timing-overlay']);
            await command('git', ['apply', '--check', patch], directory);
            await command('git', ['apply', patch], directory);
            await fs.copyFile(path.join(repo, 'public/scripts/streaming-perf.js'), path.join(directory, 'public/scripts/streaming-perf.js'));
        }
    }
    const data = path.join(temporary, side);
    await fs.mkdir(data);
    const lab = await prepareTemporaryLab(data, await freePort());
    // Match startup measurements: built-in extensions enabled, automatic updates disabled.
    const config = yaml.parse(await fs.readFile(lab.configPath, 'utf8'));
    config.extensions.enabled = true;
    await fs.writeFile(lab.configPath, yaml.stringify(config));
    const origin = `http://127.0.0.1:${lab.port}/`;
    return { directory, revision, lab, origin };
}
const settings = JSON.parse(await fs.readFile(path.join(repo, 'default/content/settings.json'), 'utf8'));
Object.assign(settings, { firstRun: false, username: 'Synthetic Tester', main_api: 'openai' });
Object.assign(settings.oai_settings, { chat_completion_source: 'custom', custom_url: fake.url, custom_model: 'startup-synthetic', stream_openai: true, show_thoughts: true });
Object.assign(settings.power_user, { auto_connect: true, chat_truncation: 100 });
const cardData = { name: 'Startup Synthetic', description: 'Synthetic streaming fixture', personality: '', scenario: '', first_mes: 'Synthetic ready', mes_example: '', creatorcomment: '', avatar: 'none', chat: 'startup-chat', talkativeness: '0.5', fav: false,
    spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Startup Synthetic', description: 'Synthetic streaming fixture', personality: '', scenario: '', first_mes: 'Synthetic ready', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '', extensions: { talkativeness: '0.5', fav: false } } };
const png = writeCard(await fs.readFile(path.join(repo, 'public/img/ai4.png')), JSON.stringify(cardData));
async function fixture(product, scenario) {
    settings.power_user.smooth_streaming = scenario.smooth;
    const user = path.join(product.lab.dataRoot, 'default-user');
    await fs.mkdir(path.join(user, 'characters'), { recursive: true });
    await fs.mkdir(path.join(user, 'chats', 'StartupSynthetic'), { recursive: true });
    await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify(settings));
    await fs.writeFile(path.join(user, 'characters', 'StartupSynthetic.png'), png);
    const file = path.join(temporary, `fixture-${scenario.messages}.jsonl`);
    try { await fs.access(file); }
    catch { await command(args.python, [path.join(repo, 'scripts/measure-streaming-browser.py'), '--fixture', String(scenario.messages), file]); }
    await fs.copyFile(file, path.join(user, 'chats', 'StartupSynthetic', 'startup-chat.jsonl'));
    const index = JSON.parse(await fs.readFile(path.join(product.directory, 'default/content/index.json'), 'utf8'));
    await fs.writeFile(path.join(user, 'content.log'), index.filter(item => item.type === 'character').map(item => item.filename).join('\n'));
}
async function start(product) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('SILLYTAVERN_')));
    const child = product.child = spawn(args.node, labServerArguments(product.lab), { cwd: product.directory, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    product.logs = '';
    child.stdout.on('data', chunk => product.logs += chunk); child.stderr.on('data', chunk => product.logs += chunk);
    product.exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error('Lab exited before readiness: ' + product.logs);
        try {
            const csrf = await fetch(product.origin + 'csrf-token', { signal: AbortSignal.timeout(1000) });
            const lib = await fetch(product.origin + 'lib.js', { signal: AbortSignal.timeout(5000) });
            await lib.arrayBuffer();
            if (csrf.ok && lib.ok) {
                await fs.access(path.join(product.lab.dataRoot, '.st-lab-owner.lock'));
                return;
            }
        } catch { /* Poll HTTP readiness. */ }
        await sleep(50);
    }
    throw new Error('Lab readiness deadline exceeded');
}
async function run(side, name, scenario, iteration, discarded = false) {
    const label = `${name}-${discarded ? 'warmup' : String(iteration).padStart(2, '0')}-${side}`;
    const product = products[side];
    await fixture(product, scenario);
    const expected = fake.configure({ ...scenario, rate: args.rate, jitter: args.jitter, seed: args.seed });
    fake.reset();
    const result = { side, scenario: name, dimensions: scenario, iteration, discarded, status: 'failed' };
    try {
        worker.stdin.write(JSON.stringify({ origin: product.origin, scenario }) + '\n');
        const line = await lines.next();
        if (line.done) throw new Error('Browser worker exited');
        const response = JSON.parse(line.value);
        if (!response.ok) throw new Error(response.error);
        const browser = response.result, generation = fake.generations.at(-1);
        await fs.writeFile(path.join(output, label + '.raw.json.gz'), gzipSync(JSON.stringify(redact({ browser, generation }))));
        if (fake.requests[0]?.stream !== true || !browser.finalText.endsWith(expected.content.trim())) throw new Error('Stream request/final fixture text mismatch');
        if (!generation?.doneEpochMs || fake.generations.length !== 1) throw new Error('Expected exactly one completed stream');
        if (!browser.loafSupported || browser.pageErrors.length || !browser.firstPaintEpochMs || !browser.finalPaintEpochMs) throw new Error('Missing paint/LoAF support or browser errors: ' + JSON.stringify({ first:browser.firstPaintEpochMs, final:browser.finalPaintEpochMs, loaf:browser.loafSupported, errors:browser.pageErrors }));
        if (browser.firstPaintEpochMs < generation.firstChunkEpochMs || browser.finalPaintEpochMs < generation.lastChunkEpochMs) throw new Error('Paint clocks out of order');
        const firstVisibleChunk = generation.chunks.find(c => c.field === browser.firstPaintKind);
        if (!firstVisibleChunk || browser.firstVisibleMutationEpochMs < firstVisibleChunk.epochMs || browser.firstPaintEpochMs < firstVisibleChunk.epochMs) throw new Error('First visible mutation/paint preceded the generated visible token');
        if (browser.scrollProbe?.delta < 590) throw new Error('Scroll probe could not move up 600px');
        if (scenario.reasoning && !browser.finalReasoning) throw new Error('Reasoning was not parsed');
        const measured = measureStreamingMetrics(browser, generation, scenario);
        result.metrics = measured.metrics;
        result.measurementWindow = measured.window;
        result.windowSamples = measured.samples;
        result.dom = browser.dom || null;
        result.samples = { frames: browser.frames.length, keys: browser.typing.length, hooks: browser.hooks.records.length };
        result.settings = browser.settings;
        result.generation = { ...generation, chunks: generation.chunks.length, requestBodySha256: createHash('sha256').update(JSON.stringify(fake.requests[0])).digest('hex') };
        result.finalTextSha256 = createHash('sha256').update(browser.finalText).digest('hex');
        result.status = 'ok';
    } catch (error) { result.error = error.stack; }
    await json(label + '.json', result);
    console.log(JSON.stringify({ label, status: result.status, metrics: result.metrics, error: result.error && redact(result.error) }));
    if (result.status !== 'ok') throw new Error('Run failed; see ' + label + '.json');
    if (!discarded) records.push({ ...result, label });
}
try {
    for (const [side, input] of args.base ? [['base', args.base], ['head', args.head]] : [['head', null]]) {
        products[side] = await materialize(side, input);
        await fixture(products[side], scenarios[0][1]);
        await start(products[side]);
    }
    worker = spawn(args.python, [path.join(repo, 'scripts/measure-streaming-browser.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
    lines = createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
    const ready = JSON.parse((await lines.next()).value);
    if (!ready.ready) throw new Error('Browser failed to launch');
    const files = ['scripts/measure-streaming.mjs', 'scripts/fake-openai-endpoint.mjs', 'scripts/measure-streaming-browser.py', 'scripts/streaming-browser-probe.js', 'scripts/benchmark-statistics.mjs', 'scripts/streaming-measurement.mjs', 'tests/browser-longchat-perf.py', 'tests/lab_browser.py', 'public/script.js', 'public/scripts/reasoning.js', 'public/scripts/streaming-perf.js'];
    const hashes = {};
    for (const file of files) hashes[file] = createHash('sha256').update(await fs.readFile(path.join(repo, file))).digest('hex');
    await json('invocation.json', { args, scenarios, products: Object.fromEntries(Object.entries(products).map(([side, p]) => [side, { revision: p.revision, lab: p.lab }])), temporary,
        timingOverlaySha256: args['timing-overlay'] ? createHash('sha256').update(await fs.readFile(args['timing-overlay'])).digest('hex') : null,
        toolCommit: (await command('git', ['rev-parse', 'HEAD'])).trim(), sourceSha256: hashes, chromium: ready.chromium,
        node: (await command(args.node, ['--version'])).trim(), platform: os.platform(), cpus: os.cpus().length, cpu: os.cpus()[0]?.model, bootstrapSeed, resamples });
    for (const [name, scenario] of scenarios) {
        for (const side of Object.keys(products)) await run(side, name, scenario, 0, true);
        for (let i = 1; i <= runsFor(name); i++) {
            // Reverse the first side every pair to balance order effects.
            const sides = Object.keys(products);
            if (i % 2 === 0) sides.reverse();
            for (const side of sides) await run(side, name, scenario, i);
        }
    }
    const comparison = { runsPerSide: Object.fromEntries(scenarios.map(([name]) => [name, runsFor(name)])), bootstrapSeed, resamples, order: records.map(r => r.label), scenarios: {}, allCiIncludeZero: args.base ? true : null };
    for (const [name] of scenarios) {
        const table = {};
        for (const metric of Object.keys(records.find(r => r.scenario === name).metrics)) {
            const values = Object.fromEntries(Object.keys(products).map(side => [side, records.filter(r => r.side === side && r.scenario === name).map(r => r.metrics[metric])]));
            const row = { summaries: Object.fromEntries(Object.entries(values).map(([side, values]) => [side, summarize(values)])) };
            if (values.base) {
                row.difference = medianDifference(values.base, values.head);
                row.ciIncludesZero = row.difference.ci95[0] <= 0 && row.difference.ci95[1] >= 0;
                comparison.allCiIncludeZero &&= row.ciIncludesZero;
            }
            table[metric] = row;
        }
        comparison.scenarios[name] = table;
    }
    await json('comparison.json', comparison);
    const readme = ['# Streaming measurements', '', `Runs per side/scenario: ${scenarios.map(([name]) => `${name}=${runsFor(name)}`).join(', ')}. Bootstrap: ${resamples} paired resamples, seed \`${bootstrapSeed}\`.`, '',
        '| Scenario | Side | Frame p95 ms | >33ms % | Typing p95 ms | First token ms | Finish ms | Updates/s | Scroll stolen |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
    for (const [name, table] of Object.entries(comparison.scenarios)) for (const side of Object.keys(products)) readme.push(`| ${name} | ${side} | ` + ['frameP95Ms', 'framesOver33Pct', 'typingP95Ms', 'firstTokenMs', 'finishMs', 'updatesPerSecond', 'scrollStolen'].map(key => table[key].summaries[side].median.toFixed(2)).join(' | ') + ' |');
    readme.push('', 'Non-smooth frame/typing/hook metrics use the provider first-chunk..last-chunk window. Smooth metrics extend that window through final visible paint to include the existing per-character backlog; first-token and finish latency keep their provider-clock definitions. Each run records both window bounds and named network/render sample counts.', '', 'Cells are medians of per-run metrics. All per-metric summaries and 95% median-difference CIs are in comparison.json; raw browser/endpoint samples are gzipped beside each run.', '');
    if (args.base) readme.push(`All metric CIs include zero: **${comparison.allCiIncludeZero}**.`, '');
    const main = comparison.scenarios.main;
    if (main) {
        const frame = main.frameP95Ms.summaries.head.median, typing = main.typingP95Ms.summaries.head.median;
        const stolen = Math.max(...main.scrollStolen.summaries.head.samples);
        const decision = frame <= 20 && typing <= 50 && stolen === 0 ? 'skip S1 and S3, only S2' : 'S1 then S2, S3 decided after S1';
        readme.push(`Decision on main: **${decision}**. Frame p95 median ${frame.toFixed(2)} ms (threshold 20); typing p95 median ${typing.toFixed(2)} ms (threshold 50); maximum scroll-stolen ${stolen} (target 0).`, '');
    }
    await fs.writeFile(path.join(output, 'README.md'), readme.join('\n'));
    console.log(JSON.stringify({ allCiIncludeZero: comparison.allCiIncludeZero, output: redact(output) }));
} finally {
    worker?.stdin.end();
    if (worker) await new Promise(resolve => { worker.once('exit', resolve); setTimeout(() => { worker.kill(); resolve(); }, 5000).unref(); });
    for (const [side, product] of Object.entries(products)) if (product.child) {
        if (product.child.exitCode === null) process.kill(-product.child.pid, 'SIGINT');
        const exit = await Promise.race([product.exit, sleep(30000, undefined, { ref: false }).then(() => { throw new Error('Lab shutdown deadline exceeded'); })]);
        const lockGone = await fs.stat(path.join(product.lab.dataRoot, '.st-lab-owner.lock')).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; });
        await json(`shutdown-${side}.json`, { exit, lockGone });
        await fs.writeFile(path.join(output, `server-${side}.log.gz`), gzipSync(redact(product.logs)));
        if (exit.code !== 0 || !lockGone) throw new Error('Lab shutdown/owner lock verification failed');
    }
    await fake.close();
}
