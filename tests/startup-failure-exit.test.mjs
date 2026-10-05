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
