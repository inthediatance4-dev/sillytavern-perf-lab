"""Acceptance on the isolated performance lab; synthetic data only.

Defaults to the launcher at http://127.0.0.1:8780/. See tests/lab_browser.py.
"""
import json
import pathlib
import sys
import uuid
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from lab_browser import assert_lab_page, evidence_dir, lab_origin, launch_chromium

root = pathlib.Path(__file__).resolve().parent.parent
origin = lab_origin()
out = evidence_dir(root)
errors = []
generation_requests = []
with sync_playwright() as p:
    browser = launch_chromium(p)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.on('pageerror', lambda error: errors.append(str(error)))
    def watch(request):
        if '/generate' in request.url and '/api/' in request.url:
            generation_requests.append(request.url)
    page.on('request', watch)
    page.goto(origin, wait_until='networkidle')
    page.wait_for_function('window.SillyTavern?.getContext')
    assert_lab_page(page, origin)
    # Finish first-run onboarding with a synthetic persona, using visible UI.
    welcome = page.locator('dialog[open]')
    if welcome.count():
        inputs = welcome.locator('input[type=text]')
        if inputs.count():
            inputs.last.fill('Synthetic Tester')
        welcome.locator('.popup-button-ok').click()
    suffix = uuid.uuid4().hex[:10]
    results = page.evaluate(r'''async (suffix) => {
        const token = (await (await fetch('/csrf-token')).json()).token;
        const post = async (endpoint, body) => {
            const r = await fetch(endpoint, { method: 'POST', headers: {
                'X-CSRF-Token': token, 'Content-Type': 'application/json'
            }, body: JSON.stringify(body) });
            if (!r.ok) throw new Error(endpoint + ': ' + r.status + ' ' + await r.text());
            return r.json();
        };
        const form = new FormData();
        form.set('ch_name', 'Synthetic Performance Sample');
        form.set('file_name', 'SyntheticLab-' + suffix);
        form.set('description', 'Artificial test character. No production conversations.');
        form.set('first_mes', 'This is an independent performance lab.');
        const created = await fetch('/api/characters/create', { method: 'POST',
            headers: { 'X-CSRF-Token': token }, body: form });
        if (!created.ok) throw new Error('create: ' + created.status);
        const avatar = await created.text();
        const all = await post('/api/characters/all', {});
        const card = all.find(c => c.avatar === avatar);
        if (!card) throw new Error('Synthetic character missing');
        const rows = [{ user_name: 'Synthetic Tester', character_name: card.name,
            chat_metadata: { integrity: 'synthetic-' + suffix } }];
        for (let i = 0; i < 24; i++) rows.push({ name: i % 2 ? card.name : 'Synthetic Tester',
            is_user: i % 2 === 0, send_date: new Date().toISOString(),
            mes: i === 0 ? 'alpha: Artificial message for search verification.' :
                i === 23 ? 'beta: All sample messages are synthetic; the live service is separate.' :
                'Synthetic performance message ' + i, extra: {} });
        const body = { avatar_url: avatar, file_name: card.chat, chat: rows };
        const saved = await post('/api/chats/save', body);
        const read = await post('/api/chats/get', body);
        if (JSON.stringify(read) !== JSON.stringify(rows)) throw new Error('Save/read mismatch');
        const hits = await post('/api/chats/search', { avatar_url: avatar, query: 'alpha beta' });
        if (hits.length !== 1 || hits[0].message_count !== 24) throw new Error('Cross-message search failed: ' + JSON.stringify(hits));
        const absent = await post('/api/chats/search', { avatar_url: avatar, query: 'absent-' + suffix });
        if (absent.length !== 0) throw new Error('Absent keyword matched');
        let backups = [];
        for (let i = 0; i < 30; i++) {
            backups = await post('/api/backups/chat/get', {});
            if (backups.some(b => b.file_name.includes(suffix))) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const backup = backups.find(b => b.file_name.includes(suffix));
        if (!backup) throw new Error('No backup for synthetic chat');
        const download = await fetch('/api/backups/chat/download', { method: 'POST', headers: {
            'X-CSRF-Token': token, 'Content-Type': 'application/json'
        }, body: JSON.stringify({ name: backup.file_name }) });
        if (!download.ok || await download.text() !== rows.map(r => JSON.stringify(r)).join('\n')) {
            throw new Error('Backup download mismatch');
        }
        await SillyTavern.getContext().getCharacters();
        const index = SillyTavern.getContext().characters.findIndex(c => c.avatar === avatar);
        await SillyTavern.getContext().selectCharacterById(String(index));
        return { avatar, saved, messages: read.length - 1, searchHits: hits.length,
            absentHits: absent.length, backupDownloadExact: true };
    }''', suffix)
    page.wait_for_function('SillyTavern.getContext().chat.length === 24')
    page.locator('#chat .mes').last.wait_for(state='visible')
    page.screenshot(path=str(out / 'desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(out / 'mobile.png'), full_page=True)
    assert not errors, errors
    assert not generation_requests, generation_requests
    results.update({'pageErrors': errors, 'generationRequests': generation_requests,
                    'browser': browser.version, 'origin': origin})
    (out / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results))
    browser.close()
