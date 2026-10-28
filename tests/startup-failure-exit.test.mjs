import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import yaml from 'yaml';

const repository = fileURLToPath(new URL('../', import.meta.url));

async function availableLoopbackPort() {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
    });
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    return port;
}

test('a real frontend build failure exits the full application with status 1 before listening', async () => {
    const fixture = path.join(repository, '.fixtures', `startup-failure-exit-${crypto.randomUUID()}`);
    const dataRoot = path.join(fixture, 'data');
    fs.mkdirSync(dataRoot, { recursive: true });
    const port = await availableLoopbackPort();
    const configPath = path.join(fixture, 'config.yaml');
    // Use distribution defaults, never an existing user's configuration/data.
    const config = yaml.parse(fs.readFileSync(path.join(repository, 'default/config.yaml'), 'utf8'));
    config.dataRoot = dataRoot;
    config.listen = false;
    config.listenAddress = { ipv4: '127.0.0.1', ipv6: '::1' };
    config.protocol = { ipv4: true, ipv6: false };
    config.port = port;
    config.browserLaunch.enabled = false;
    config.enableServerPlugins = false;
    config.extensions.autoUpdate = false;
    config.extensions.models.autoDownload = false;
    config.enableDownloadableTokenizers = false;
    config.logging.minLogLevel = 3;
    fs.writeFileSync(configPath, yaml.stringify(config), { flag: 'wx' });

    const replacementConfig = path.join(fixture, 'failing-webpack-config.mjs');
    const actualConfig = new URL(pathToFileURL(path.join(repository, 'webpack.config.js')));
    actualConfig.searchParams.set('actual', 'startup-failure-exit');
    fs.writeFileSync(replacementConfig, `
import path from 'node:path';
import getActualConfig from ${JSON.stringify(actualConfig.href)};
export default function getFailingConfig(options) {
    const config = getActualConfig(options);
    config.entry = ${JSON.stringify(path.join(fixture, 'synthetic-missing-entry.mjs'))};
    config.cache = false;
    config.output = { ...config.output, path: ${JSON.stringify(path.join(fixture, 'webpack-output'))} };
    return config;
}
`);
    const loader = path.join(fixture, 'loader.mjs');
    fs.writeFileSync(loader, `
const replacement = ${JSON.stringify(pathToFileURL(replacementConfig).href)};
export async function resolve(specifier, context, nextResolve) {
    // Only the application's middleware configuration import is replaced.
    // The wrapper still imports the real configuration with a query suffix.
    if (specifier === '../../webpack.config.js' && context.parentURL?.endsWith('/src/middleware/webpack-serve.js')) {
        return { url: replacement, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
`);

    const env = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !key.toUpperCase().startsWith('SILLYTAVERN_')));
    const args = [
        '--experimental-loader', pathToFileURL(loader).href, path.join(repository, 'server.js'),
        '--configPath', configPath, '--dataRoot', dataRoot, '--port', String(port),
        '--listen', 'false', '--listenAddressIPv4', '127.0.0.1',
        '--enableIPv4', 'true', '--enableIPv6', 'false',
        '--browserLaunchEnabled', 'false', '--ssl', 'false',
    ];
    const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            cwd: repository, env, windowsHide: true, timeout: 45000,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
        child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    // Preserve original diagnostics and all synthetic files for inspection.
    fs.writeFileSync(path.join(fixture, 'stdout.log'), result.stdout);
    fs.writeFileSync(path.join(fixture, 'stderr.log'), result.stderr);
    fs.writeFileSync(path.join(fixture, 'result.json'), JSON.stringify({
        node: process.version, fixture, port, code: result.code, signal: result.signal,
        artificial_missing_entry: true, synthetic_only: true,
    }, null, 2) + '\n');
    const output = result.stdout + '\n' + result.stderr;
    assert.match(output, /Webpack frontend compilation failed/, 'Failure must come from the real frontend compiler');
    assert.match(output, /synthetic-missing-entry/, 'Compiler diagnostics must identify the artificial missing entry');
    assert.doesNotMatch(output, /SillyTavern is listening on/, 'The failed application must never announce readiness');
    assert.equal(result.signal, null, 'Shutdown must complete naturally rather than being killed by the test');
    assert.equal(result.code, 1, `A failed frontend build must not look successful to a process manager. Fixture: ${fixture}`);
});

test('exclusive ownership I/O failures exit 78 before data writes or listen', async t => {
    const { spawnSync } = await import('node:child_process');
    const fixture = fs.mkdtempSync(path.join(repository, '.fixtures', 'owner-startup-'));
    const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
    for (const operation of ['open', 'read', 'rename', 'unlink', 'proc']) {
        for (const code of ['EACCES', 'EIO', 'EPERM']) {
            await t.test(`${operation}: ${code}`, { skip: operation === 'proc' && process.platform !== 'linux' && 'Requires Linux /proc identity reads' }, async () => {
                const scenario = path.join(fixture, `${operation}-${code}`);
                const dataRoot = path.join(scenario, 'data');
                fs.mkdirSync(dataRoot, { recursive: true });
                const lock = path.join(dataRoot, '.st-lab-owner.lock');
                fs.writeFileSync(lock, JSON.stringify({
                    pid: ['rename', 'unlink'].includes(operation) ? dead : process.pid,
                    hostname: (await import('node:os')).hostname(), startedAt: '2000-01-01',
                }));
                const config = yaml.parse(fs.readFileSync(path.join(repository, 'default/config.yaml'), 'utf8'));
                config.dataRoot = dataRoot;
                config.browserLaunch.enabled = false;
                config.enableServerPlugins = false;
                config.extensions.autoUpdate = false;
                config.extensions.models.autoDownload = false;
                config.enableDownloadableTokenizers = false;
                const configPath = path.join(scenario, 'config.yaml');
                fs.writeFileSync(configPath, yaml.stringify(config));
                const auditPath = path.join(scenario, 'audit.json');
                const preload = path.join(scenario, 'inject.mjs');
                fs.writeFileSync(preload, `
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const root = ${JSON.stringify(dataRoot)};
const operation = ${JSON.stringify(operation)};
const code = ${JSON.stringify(code)};
const save = fs.writeFileSync;
const audit = { injected: 0, listens: 0, businessWrites: [] };
const fds = new Map();
function inside(file) { return typeof file === 'string' && (file === root || file.startsWith(root + path.sep)); }
function business(file) {
    return inside(file) && file !== root && !path.basename(file).startsWith('.st-lab-owner.lock') && !/^\\.c[0-9a-f]{12}$/.test(path.basename(file));
}
for (const method of ['openSync', 'readSync', 'readFileSync', 'renameSync', 'unlinkSync', 'mkdirSync', 'writeFileSync', 'appendFileSync', 'writeSync']) {
    const original = fs[method];
    fs[method] = function(...args) {
        const file = typeof args[0] === 'number' ? fds.get(args[0]) : String(args[0]);
        if ((method === 'openSync' && args[1] !== 'r' && typeof args[1] === 'number' && (args[1] & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT))) || /^(write|append|mkdir|rename|unlink)/.test(method)) {
            if (business(file)) audit.businessWrites.push([method, file]);
        }
        const hit = (operation === 'proc' && method === 'readFileSync' && file.startsWith('/proc/'))
            || (operation === 'open' && method === 'openSync' && file === path.join(root, '.st-lab-owner.lock'))
            || (operation === 'read' && method === 'readSync' && inside(file))
            || (operation === 'rename' && method === 'renameSync' && file === path.join(root, '.st-lab-owner.lock'))
            || (operation === 'unlink' && method === 'unlinkSync' && inside(file));
        if (hit) { audit.injected++; throw Object.assign(new Error('injected ' + operation + ' ' + code), { code }); }
        const value = original.apply(this, args);
        if (method === 'openSync') fds.set(value, file);
        return value;
    };
}
for (const method of ['mkdir', 'writeFile', 'appendFile', 'rename', 'unlink', 'open']) {
    const original = fs.promises[method];
    fs.promises[method] = function(...args) {
        if (business(String(args[0]))) audit.businessWrites.push([method, String(args[0])]);
        return original.apply(this, args);
    };
}
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) { audit.listens++; return listen.apply(this, args); };
syncBuiltinESMExports();
process.on('exit', () => save(${JSON.stringify(auditPath)}, JSON.stringify(audit)));
`);
                const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('SILLYTAVERN_')));
                const result = await new Promise((resolve, reject) => {
                    const child = spawn(process.execPath, [
                        '--import', pathToFileURL(preload).href, path.join(repository, 'server.js'),
                        '--configPath', configPath, '--dataRoot', dataRoot, '--exclusiveDataRoot', 'true',
                        '--enableIPv4', 'true', '--enableIPv6', 'false', '--browserLaunchEnabled', 'false',
                    ], { cwd: repository, env, timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] });
                    let output = '';
                    child.stdout.on('data', chunk => { output += chunk; });
                    child.stderr.on('data', chunk => { output += chunk; });
                    child.once('error', reject);
                    child.once('close', (status, signal) => resolve({ status, signal, output }));
                });
                const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
                assert.equal(result.signal, null, result.output);
                assert.equal(result.status, 78, result.output);
                assert.ok(audit.injected > 0, result.output);
                assert.equal(audit.listens, 0);
                assert.deepEqual(audit.businessWrites, []);
                assert.doesNotMatch(result.output, /SillyTavern is listening on/);
                assert.match(result.output, /ownership could not be determined/);
            });
        }
    }
});
