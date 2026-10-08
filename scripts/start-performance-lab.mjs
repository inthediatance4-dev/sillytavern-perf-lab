import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 8776;

/** Reject paths outside this lab or passing through a symlink/junction. */
export async function assertLocalPath(target) {
    const resolved = path.resolve(target);
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new Error('Lab path is outside the independent workspace');
    }
    let current = root;
    for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
        if (part) current = path.join(current, part);
        try {
            const stat = await fs.lstat(current);
            if (stat.isSymbolicLink()) throw new Error('Lab path contains a link/junction');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return resolved;
}

/** Create fresh lab configuration once, using distribution defaults only. */
export async function prepareLab() {
    const dataRoot = await assertLocalPath(path.join(root, '.lab-data'));
    const configPath = await assertLocalPath(path.join(root, '.lab-config.yaml'));
    await fs.mkdir(dataRoot, { recursive: true });
    try {
        await fs.access(configPath);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const config = yaml.parse(await fs.readFile(path.join(root, 'default/config.yaml'), 'utf8'));
        config.dataRoot = dataRoot;
        config.listen = false;
        config.port = port;
        config.browserLaunch.enabled = false;
        config.extensions.autoUpdate = false;
        config.enableServerPlugins = false;
        config.logging.minLogLevel = 1;
        // Keep backup semantics; a small retention makes fixture recycling visible.
        config.backups.common.numberOfBackups = 5;
        await fs.writeFile(configPath, yaml.stringify(config), { flag: 'wx' });
    }
    return { root, dataRoot, configPath, port, listenAddress: '127.0.0.1' };
}

async function assertPortAvailable() {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(port, '127.0.0.1', resolve);
    });
    await new Promise(resolve => probe.close(resolve));
}

async function main() {
    if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Only --check is supported; lab paths and address are fixed');
    const lab = await prepareLab();
    if (process.argv.includes('--check')) { console.log(JSON.stringify(lab)); return; }
    await assertPortAvailable();
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('SILLYTAVERN_')));
    const args = ['server.js', '--configPath', lab.configPath, '--dataRoot', lab.dataRoot, '--port', String(port), '--listen', 'false', '--listenAddressIPv4', '127.0.0.1', '--enableIPv4', 'true', '--enableIPv6', 'false', '--browserLaunchEnabled', 'false', '--ssl', 'false'];
    console.log(`Independent lab: http://127.0.0.1:${port}/ (data: ${lab.dataRoot})`);
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', error => { console.error(error.message); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
        // Windows sends console Ctrl+C to the child too. kill() would forcibly
        // terminate it before its asynchronous shutdown handlers can finish.
        if (process.platform !== 'win32') child.kill(signal);
    });
    child.once('exit', code => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
