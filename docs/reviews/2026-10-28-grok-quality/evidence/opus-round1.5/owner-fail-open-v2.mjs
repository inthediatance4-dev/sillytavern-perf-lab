import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { review, source } from '../../review-context.mjs';
import '../../preserve-deletions.mjs';
const load = name => import(pathToFileURL(path.join(source, name)).href);
const mode = 'owner-fail-open';
const root = fs.mkdtempSync(path.join(review, 'temp', mode + '-v2-'));
function emit(result) {
    const record = { scenario: mode, reproduced: false, code: null, op: null, cause: null, name: null, message: null, ...result };
    fs.writeFileSync(path.join(review, mode + '-v2.json'), JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify(record));
}
try {
    const { acquireDataRootOwnership, DATA_ROOT_OWNER_LOCK } = await load('src/data-root-owner.js');
    const lock = path.join(root, DATA_ROOT_OWNER_LOCK);
    const payload = JSON.stringify({ pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), token: 'existing-live-owner' });
    fs.writeFileSync(lock, payload);
    const open = fs.openSync;
    fs.openSync = function(target, flags, ...args) {
        if (path.resolve(String(target)) === lock) { const error = new Error('synthetic lock ACL denies access while data files remain writable'); error.code = 'EACCES'; throw error; }
        return open(target, flags, ...args);
    };
    let outcome;
    try { outcome = acquireDataRootOwnership(root); } finally { fs.openSync = open; }
    assert.equal(fs.readFileSync(lock, 'utf8'), payload);
    emit({ scenario: mode, reproduced: outcome.unverified === true, result: outcome, existingLiveOwnerPreserved: true });
} catch (error) {
    if (!(error.name === 'DataRootOwnershipUnverifiedError' && error.code === 'EREAD' && error.cause?.code === 'EACCES')) throw error;
    emit({ reproduced: false, code: error.code ?? null, op: error.op ?? null,
        cause: error.cause?.code ?? null, name: error.name, message: error.message });
}
