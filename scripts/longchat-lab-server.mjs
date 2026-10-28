// Measurement-only entry point: the caller supplies a freshly created temp directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { labServerArguments } from './start-performance-lab.mjs';

export function forwardConsoleBreak(target = process) {
    target.on('SIGBREAK', () => target.emit('SIGINT'));
}

export async function prepareTemporaryLab(directory, port) {
    const real = await fs.realpath(directory);
    const relative = path.relative(await fs.realpath(os.tmpdir()), real);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Expected a fresh directory under the system temp root');
    if ((await fs.readdir(real)).length) throw new Error('Temporary lab directory must be empty');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    const config = yaml.parse(await fs.readFile(new URL('../default/config.yaml', import.meta.url), 'utf8'));
    const lab = { dataRoot: path.join(real, 'data'), configPath: path.join(real, 'config.yaml'), port };
    Object.assign(config, { dataRoot: lab.dataRoot, port, listen: false, exclusiveDataRoot: true,
        listenAddress: { ipv4: '127.0.0.1', ipv6: '::1' }, protocol: { ipv4: true, ipv6: false },
        enableServerPlugins: false });
    config.ssl.enabled = false;
    config.browserLaunch.enabled = false;
    config.extensions.autoUpdate = false;
    config.extensions.enabled = false;
    await fs.writeFile(lab.configPath, yaml.stringify(config), { flag: 'wx' });
    return lab;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const lab = await prepareTemporaryLab(process.argv[2], Number(process.argv[3]));
    for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('SILLYTAVERN_')) delete process.env[key];
    forwardConsoleBreak();
    process.argv = [process.execPath, ...labServerArguments(lab)];
    await import('../server.js');
}
