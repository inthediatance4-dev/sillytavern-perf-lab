import assert from 'node:assert/strict';
import test from 'node:test';
import { historicalSource } from './helpers/historical-source.mjs';

test('missing historical Git objects are an optional prerequisite', async () => {
    assert.equal(await historicalSource('0000000000000000000000000000000000000000:missing'), null);
});

test('available historical sources remain independent Git bytes', async t => {
    const source = await historicalSource('HEAD:package.json');
    if (source === null) return t.skip('Git checkout unavailable');
    assert.match(source, /"name"/);
});
