import assert from 'node:assert/strict';
import test from 'node:test';
const api = await import('../public/scripts/plugin-runtime/prompt-shield.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
});
test('opaque per-request reservation hides body from WI, reserves tokens and restores exactly', async () => {
    const shield = api.createPromptShield({ uuid: () => 'unique', count: async text => [...text].length });
    const text = '\uE000directorfate1xabc\uE001秘密 {{char}}\uE002directorfate1xabc\uE003';
    const persisted = { mes: 'ordinary {{user}}' };
    const request = [persisted, { mes: text, extra: { directorFatePrompt: true } }];
    await shield.seal(request);
    assert.equal(request[0], persisted);
    assert.doesNotMatch(request[1].mes, /秘密|char|directorfate/);
    assert.ok([...request[1].mes].length >= [...text].length);
    const data = { messages: [{ content: request[1].mes }, { content: 'ordinary {{user}}' }] };
    shield.restore(data);
    assert.equal(data.messages[0].content, text);
    assert.equal(data.messages[1].content, 'ordinary {{user}}');
});
test('two plugins sharing a request neither reseal nor expose the first private frame', async () => {
    let serial = 0;
    const shield = api.createPromptShield({ uuid: () => String(++serial), count: async text => text.length });
    const request = [{ mes: 'first secret', extra: { affinityPrompt: true } }];
    await shield.seal(request);
    const first = request[0].mes;
    request.push({ mes: 'second secret', extra: { directorFatePrompt: true } });
    await shield.seal(request);
    assert.equal(request[0].mes, first);
    const data = { prompt: request.map(item => item.mes).join('\n') };
    shield.restore(data);
    assert.equal(data.prompt, 'first secret\nsecond secret');
});
test('unknown complete private reservations fail closed without stripping ordinary text', () => {
    const shield = api.createPromptShield({ uuid: () => 'id', count: async text => text.length });
    const data = { prompt: 'plain stprivate text \uE040stprivate99xabc\uE041padding\uE042stprivate99xabc\uE043 end' };
    shield.restore(data);
    assert.equal(data.prompt, 'plain stprivate text  end');
});
