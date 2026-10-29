import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
const { labServerArguments } = await import(new URL('./scripts/start-performance-lab.mjs', 'file://' + process.cwd() + '/'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-cc-probe-'));
const config = yaml.parse(fs.readFileSync('default/config.yaml', 'utf8'));
Object.assign(config, { dataRoot: path.join(root, 'data'), port: 18786, exclusiveDataRoot: true, enableServerPlugins: false });
config.extensions.autoUpdate = false;
const configPath = path.join(root, 'config.yaml');
fs.writeFileSync(configPath, yaml.stringify(config));
fs.mkdirSync('.evidence/review-fix-b2-probe', { recursive: true });
const log = path.resolve('.evidence/review-fix-b2-probe/activation.jsonl');
fs.writeFileSync(log, '', { flag: 'wx' });
const cache = path.join(root, 'compile-cache');
const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./preload.mjs', import.meta.url)), ...labServerArguments({configPath, dataRoot:config.dataRoot, port: config.port})], { detached: true, env: {...process.env, CC_PROBE_LOG:log, CC_PROBE_CACHE:cache}, stdio:['ignore','pipe','pipe'] });
const exit = new Promise(resolve => child.once('exit', (code,signal)=>resolve({code,signal})));
let output=''; child.stdout.on('data',c=>output+=c); child.stderr.on('data',c=>output+=c);
let ready=false;
try {
    for (let i=0;i<1200;i++) {
        if(child.exitCode!==null) throw new Error(output);
        try {const r=await fetch(`http://127.0.0.1:${config.port}/csrf-token`); if(r.ok && (await r.json()).token) {ready=true; break;}} catch {}
        await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!ready) throw new Error('probe readiness deadline');
} finally {process.kill(-child.pid,'SIGINT');}
const ended=await exit;
const files=fs.readdirSync(cache,{recursive:true}).filter(p=>fs.statSync(path.join(cache,p)).isFile());
const result={ready,exit:ended,cacheEntriesAfterFirstRun:files.length,cacheFiles:files,cacheRoot:'<tmp>/compile-cache',lockGone:!fs.existsSync(path.join(config.dataRoot,'.st-lab-owner.lock'))};
fs.writeFileSync('.evidence/review-fix-b2-probe/result.json',JSON.stringify(result,null,2)+'\n');
fs.writeFileSync('.evidence/review-fix-b2-probe/server.log',output);
console.log(JSON.stringify(result));
if(!ready||ended.code!==0||files.length===0||!result.lockGone) process.exitCode=1;
