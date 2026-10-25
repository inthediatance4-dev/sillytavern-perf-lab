import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import yaml from 'yaml';

test('launcher overrides an existing unsafe config on every preparation', async () => {
    const root = await fs.mkdtemp(path.resolve('.fixtures/launcher-'));
    await fs.mkdir(path.join(root, 'scripts'));
    await fs.copyFile('scripts/start-performance-lab.mjs', path.join(root, 'scripts/start-performance-lab.mjs'));
    const configPath = path.join(root, '.lab-config.yaml');
    const unsafe = { dataRoot: '/outside', listen: true, port: 8000, listenAddress: { ipv4: '0.0.0.0' }, protocol: { ipv4: false, ipv6: true }, ssl: { enabled: true }, extensions: { autoUpdate: true, enabled: true }, enableServerPlugins: true, browserLaunch: { enabled: true }, custom: 'preserved' };
    const { prepareLab, labServerArguments } = await import(pathToFileURL(path.join(root, 'scripts/start-performance-lab.mjs')));
    for (let i = 0; i < 2; i++) {
        await fs.writeFile(configPath, yaml.stringify(unsafe));
        const lab = await prepareLab();
        const config = yaml.parse(await fs.readFile(configPath, 'utf8'));
        assert.equal(config.dataRoot, path.join(root, '.lab-data'));
        assert.equal(config.listen, false);
        assert.equal(config.port, 8780);
        assert.equal(config.listenAddress.ipv4, '127.0.0.1');
        assert.deepEqual(config.protocol, { ipv4: true, ipv6: false });
        assert.equal(config.ssl.enabled, false);
        assert.equal(config.browserLaunch.enabled, false);
        assert.equal(config.extensions.autoUpdate, false);
        assert.equal(config.extensions.enabled, true);
        assert.equal(config.enableServerPlugins, false);
        assert.equal(config.exclusiveDataRoot, true);
        assert.equal(config.custom, 'preserved');
        const args = labServerArguments(lab);
        assert.equal(args[args.indexOf('--exclusiveDataRoot') + 1], 'true');
        assert.equal(args[args.indexOf('--dataRoot') + 1], lab.dataRoot);
    }
});
