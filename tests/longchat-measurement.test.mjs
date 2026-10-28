import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import yaml from 'yaml';
import { forwardConsoleBreak, prepareTemporaryLab } from '../scripts/longchat-lab-server.mjs';

test('temporary measurement config isolates data and preserves retention defaults', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'longchat-config-'));
    const lab = await prepareTemporaryLab(directory, 18889);
    const config = yaml.parse(await fs.readFile(lab.configPath, 'utf8'));
    assert.equal(config.exclusiveDataRoot, true);
    assert.equal(config.listen, false);
    assert.equal(config.listenAddress.ipv4, '127.0.0.1');
    assert.equal(config.protocol.ipv6, false);
    assert.equal(config.browserLaunch.enabled, false);
    assert.equal(config.extensions.autoUpdate, false);
    assert.equal(config.enableServerPlugins, false);
    assert.equal(config.backups.chat.maxRecycleBytes, -1);
    assert.equal(lab.dataRoot, path.join(await fs.realpath(directory), 'data'));
    await assert.rejects(prepareTemporaryLab(directory, 18889), /must be empty/);
});

test('measurement config refuses workspace and invalid ports before writing', async () => {
    await assert.rejects(prepareTemporaryLab(process.cwd(), 18889), /system temp root/);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'longchat-invalid-'));
    await assert.rejects(prepareTemporaryLab(directory, 0), /Invalid port/);
    assert.deepEqual(await fs.readdir(directory), []);
});

test('Windows console break forwards to graceful SIGINT handlers (Linux simulation)', () => {
    const target = new EventEmitter();
    let interrupts = 0;
    target.on('SIGINT', () => interrupts++);
    forwardConsoleBreak(target);
    target.emit('SIGBREAK');
    assert.equal(interrupts, 1);
});

test('native Windows CTRL_BREAK reaches graceful SIGINT handler', { skip: process.platform !== 'win32' ? 'Requires a native Windows console process group; forwarding is simulated above on other systems' : false }, () => {
    const code = `
import subprocess, signal
source = "import { forwardConsoleBreak } from './scripts/longchat-lab-server.mjs'; forwardConsoleBreak(); const timer = setTimeout(() => { process.exitCode = 1; }, 8000); process.on('SIGINT', () => { clearTimeout(timer); console.log('graceful'); }); console.log('ready');"
p = subprocess.Popen(['node', '--input-type=module', '-e', source], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
assert p.stdout.readline().strip() == 'ready'
p.send_signal(signal.CTRL_BREAK_EVENT)
out, err = p.communicate(timeout=12)
assert p.returncode == 0 and 'graceful' in out, (p.returncode, out, err)
`;
    const result = spawnSync('python', ['-c', code], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('deterministic data, percentiles and CPU ancestor attribution', () => {
    const python = process.env.LONGCHAT_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const script = `
import importlib.util
spec = importlib.util.spec_from_file_location('longchat', 'tests/browser-longchat-perf.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
a = m.synthetic_rows(2000)
assert a == m.synthetic_rows(2000)
assert len(a) == 2001
assert sum('swipes' in r for r in a) == 200
assert all(a[i+1]['is_user'] == (i % 2 == 0) for i in range(2000))
assert m.distribution([1,2,3,4,100]) == {'n':5,'median':3,'p95':100}
assert m.distribution([])['median'] is None
assert m.redact({'path': r'C:\\Temp\\lab\\data'}, temporary=r'C:\\Temp\\lab') == {'path': r'<tmp>\\data'}
p = {'nodes':[{'id':1,'callFrame':{'url':'a','functionName':'parent','lineNumber':0},'children':[2]}, {'id':2,'callFrame':{'url':'b','functionName':'child','lineNumber':2}}], 'samples':[2,1], 'timeDeltas':[300,100]}
s = m.profile_summary(p)
assert s['self'][0]['function'] == 'child' and s['self'][0]['percent'] == 75
assert s['total'][0]['function'] == 'parent' and s['total'][0]['percent'] == 100
assert s['self'][0]['line'] == 3
p['nodes'][1]['children'] = [3]
p['nodes'].append({'id':3, 'callFrame':p['nodes'][1]['callFrame']})
p['samples'] = [3]
p['timeDeltas'] = [100]
s = m.profile_summary(p)
assert next(r for r in s['total'] if r['function'] == 'child')['percent'] == 100
`;
    const result = spawnSync(python, ['-c', script], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: 'tests', PYTHONDONTWRITEBYTECODE: '1' } });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
});
