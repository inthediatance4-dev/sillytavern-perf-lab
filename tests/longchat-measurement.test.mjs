import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import yaml from 'yaml';
import { forwardConsoleBreak, prepareTemporaryLab } from '../scripts/longchat-lab-server.mjs';

// Allow for cold Python startup on Windows CI; this is a hang guard.
const PYTHON_HANG_GUARD_TIMEOUT_MS = Number(process.env.LONGCHAT_TEST_PYTHON_TIMEOUT_MS || 60000);

function pythonFailureMessage(result, startedAt) {
    return `Python error=${result.error}, status=${result.status}, signal=${result.signal}, elapsed=${Date.now() - startedAt}ms\nstderr: ${result.stderr}`;
}

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
import ctypes, subprocess, signal, sys
# Give this test a private console; never broadcast into the CI runner's console.
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.FreeConsole()
assert kernel.AllocConsole(), ctypes.get_last_error()
source = "import { forwardConsoleBreak } from './scripts/longchat-lab-server.mjs'; forwardConsoleBreak(); const timer = setTimeout(() => { process.exitCode = 1; }, 5000); process.on('SIGINT', () => { clearTimeout(timer); console.log('graceful'); }); console.log('ready');"
p = subprocess.Popen([sys.argv[1], '--input-type=module', '-e', source], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
assert p.stdout.readline().strip() == 'ready'
p.send_signal(signal.CTRL_BREAK_EVENT)
out, err = p.communicate(timeout=8)
assert p.returncode == 0 and 'graceful' in out, (p.returncode, out, err)
`;
    const startedAt = Date.now();
    const result = spawnSync(process.env.LONGCHAT_TEST_PYTHON || 'python', ['-c', code, process.execPath], { encoding: 'utf8', timeout: PYTHON_HANG_GUARD_TIMEOUT_MS });
    assert.equal(result.status, 0, pythonFailureMessage(result, startedAt));
});

test('deterministic data, percentiles and CPU ancestor attribution', () => {
    const python = process.env.LONGCHAT_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const script = `
import hashlib, importlib.util, json, pathlib, tempfile
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
fixture = pathlib.Path(tempfile.mkdtemp(prefix='longchat-report-'))
source = fixture / 'input'
source.mkdir()
ok = {'size':2000, 'truncation':100, 'iteration':0, 'profiled':False, 'status':'ok',
      'open':{'ms':10, 'longTasks':{'count':0, 'totalMs':0, 'maxMs':0}},
      'scroll':{'frameMs':{'median':16, 'p95':17}, 'over16_7Percent':1, 'over50Percent':0,
                'longTasks':{'count':0, 'totalMs':0, 'maxMs':0}, 'batches':[{'added':100, 'ms':600, 'tasks':[]}]},
      'send':{'ms':20, 'payloadBytes':300, 'serverMs':2, 'responseWaitMs':3},
      'afterOpen':{'usedSize':10, 'nodes':20, 'messages':100}, 'afterScroll':{'usedSize':11, 'nodes':21, 'messages':200}}
records = [ok, dict(ok, status='error', iteration=1), dict(ok, profiled=True, iteration=2),
           {'size':2000, 'truncation':100, 'iteration':3, 'profiled':False, 'status':'timeout'}]
for i, record in enumerate(records):
    m.write_json(source / f'run-{i}.json', record)
before = [path.read_bytes() for path in sorted(source.glob('*.json'))]
output = fixture / 'combined'
m.combine_results([source], output)
m.combine_results([source], output)
assert before == [path.read_bytes() for path in sorted(source.glob('*.json'))]
row = json.loads((output / 'aggregated.json').read_text())[0]
assert row['success'] == 1 and row['attempted'] == 3
assert row['metrics']['openMs'] == {'n':1,'median':10,'p95':10}
assert row['failedCompleted']['n'] == 1 and row['statusCounts']['timeout'] == 1
assert row['batchesByIndex'][0]['ms']['n'] == 1
index = json.loads((output / 'raw-index.json').read_text())
assert index[0]['sha256'] == hashlib.sha256(before[0]).hexdigest()
`;
    const startedAt = Date.now();
    const result = spawnSync(python, ['-c', script], { encoding: 'utf8', timeout: PYTHON_HANG_GUARD_TIMEOUT_MS, env: { ...process.env, PYTHONPATH: 'tests', PYTHONDONTWRITEBYTECODE: '1' } });
    assert.equal(result.status, 0, pythonFailureMessage(result, startedAt));
});
