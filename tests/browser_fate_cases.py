"""Real-browser Fate Card checks on the existing synthetic lab."""
import gzip
import json
from pathlib import Path
import urllib.request
import uuid


def run_fate_checks(page, sample, fake_url, result, connect_api, swipe_message):
    connect_api(page)
    page.evaluate("async () => { window.__fateLabMain = await import('/script.js'); }")
    endpoint = fake_url.removesuffix('/v1')
    secret = 'FATE_PRIVATE_01: A stranger brings a sealed map bearing {{char}} and {{random::a,b}}.'
    reply = 'A stranger arrives with a sealed map. Synthetic Fate reply.'

    def configure(text=reply, **extra):
        payload = {'reply':text, 'tokens':8, 'rate':10000, 'jitter':0, **extra}
        request = urllib.request.Request(endpoint + '/__configure', data=json.dumps(payload).encode(),
                                         headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request) as response:
            assert response.status == 200

    def requests():
        with urllib.request.urlopen(endpoint + '/__requests') as response:
            return json.load(response)

    def body(index=-1):
        return json.dumps(requests()[index], ensure_ascii=False)

    def generation_response(response):
        return response.url.endswith('/api/backends/chat-completions/generate') and response.request.method == 'POST'

    def assert_provider_failure(response, name):
        # Non-streaming upstream errors are wrapped by the native proxy in an
        # HTTP 200 error envelope. Verify the actual provider's HTTP failure too.
        assert response.json().get('error')
        with urllib.request.urlopen(endpoint + '/__timings') as timing_response:
            status = json.load(timing_response)[-1]['status']
        assert status == 500
        result.setdefault('fateProviderFailures', {})[name] = {'providerStatus':status,'proxyStatus':response.status}

    def fate():
        return page.evaluate('structuredClone(SillyTavern.getContext().chatMetadata.director?.fate ?? {})')

    def open_panel():
        if page.locator('#director_fate_panel').is_visible():
            return
        if not page.locator('#directorPopover').is_visible():
            page.locator('#directorButton').click()
        assert page.locator('#director_fate_open').count() == 1, 'Fate Cards entry missing'
        page.locator('#director_fate_open').click()
        page.locator('#director_fate_panel').wait_for(state='visible')

    def close_panel():
        page.locator('dialog[open] .popup-button-cancel').click()
        page.locator('#director_fate_panel').wait_for(state='hidden')

    def tab(name):
        page.locator('#director_fate_tab_' + name).click()
        assert page.locator('#director_fate_tab_' + name).get_attribute('aria-selected') == 'true'
        page.locator('#director_fate_' + name).wait_for(state='visible')

    def log_entry(card):
        return page.locator('.director_fate_log_entry[data-entry-id="' + card['id'] + '"]')

    def mark(slot):
        return page.locator('#chat .mes[mesid="' + str(slot) + '"] .director_fate_mark')

    def assert_mark(card, slot):
        target = mark(slot)
        target.wait_for(state='visible')
        assert target.text_content() == '🎴'
        assert target.get_attribute('aria-label') == '命运牌：〈' + card['title'] + '〉'
        assert target.get_attribute('data-rarity') == card['rarity']
        assert target.evaluate("node => Boolean(node.closest('.ch_name')) && node.previousElementSibling?.classList.contains('name_text') && !node.closest('.mes_text')")
        markup = target.evaluate('(node) => node.outerHTML')
        assert card['event'] not in markup and card['event'].partition(':')[0] not in markup
        assert page.locator('#chat .mes[mesid="' + str(slot) + '"] .mes_text .director_fate_mark').count() == 0

    def assert_mark_motion_suppressed(card, slot):
        assert_mark(card, slot)
        # Completion schedules mark painting in a microtask. Check after the
        # next frame as well so a suppressed animation cannot leave is_fresh.
        page.evaluate('() => new Promise(requestAnimationFrame)')
        assert not mark(slot).evaluate("node => node.classList.contains('is_fresh')")
        assert mark(slot).evaluate('node => getComputedStyle(node).animationName') == 'none'

    def idle():
        page.wait_for_function("!window.__fateLabMain.isGenerating() && !window.__fateLabMain.isChatSaving", timeout=30000)

    def hidden(text):
        assert text not in page.locator('body').evaluate('(node) => node.outerHTML')

    def ritual_hidden(text):
        # outerHTML covers text, title, aria-* and data-* alike. Also check the
        # private marker so escaping or rendering only part cannot conceal a leak.
        panel_html = page.locator('#director_fate_panel').evaluate('(node) => node.outerHTML')
        toast_html = page.locator('#toast-container').evaluate('(node) => node.outerHTML') if page.locator('#toast-container').count() else ''
        for private in (text, text.partition(':')[0]):
            assert private not in panel_html, 'Private event leaked into Fate panel markup'
            assert private not in toast_html, 'Private event leaked into toast markup'
        assert page.locator('.director_fate_face').text_content() == ''

    def reveal_toast(held):
        toast = page.locator('#toast-container .toast').filter(has_text='命运已降临').filter(has_text=held['title']).last
        toast.wait_for(state='visible')
        assert held['event'] not in toast.evaluate('(node) => node.outerHTML')
        return toast

    def settings():
        if not page.locator('#director_fate_settings').is_visible():
            page.locator('#director_fate_settings_toggle').click()
        page.locator('#director_fate_reveal').wait_for(state='visible')

    def saved_settings_match(response, **expected):
        if not response.url.endswith('/api/settings/save') or response.request.method != 'POST':
            return False
        data = response.request.post_data_buffer
        if response.request.headers.get('content-encoding') == 'gzip':
            data = gzip.decompress(data)
        saved = json.loads(data)['extension_settings']['director']['fate']
        return all(saved.get(key) == value for key, value in expected.items())

    def reload_browser():
        page.reload()
        page.locator('#directorButton').wait_for(state='visible', timeout=30000)
        page.evaluate("""async sample => {
            window.__fateLabMain = await import('/script.js');
            const c=SillyTavern.getContext();
            await c.selectCharacterById(c.characters.findIndex(card=>card.avatar===sample.avatar));
            if(SillyTavern.getContext().chatId!==sample.chatName) await SillyTavern.getContext().openCharacterChat(sample.chatName);
        }""", sample)
        connect_api(page)

    def fade_only():
        for face in ('.director_fate_back', '.director_fate_face'):
            assert page.locator(face).evaluate("node => { const style=getComputedStyle(node); return style.transform==='none' && style.transitionProperty==='opacity' && style.transitionDuration==='0.15s'; }")
        for selector, pseudo in (('.director_fate_back', '::before'), ('.director_fate_seal', None), ('.director_fate_seal', '::after')):
            assert page.locator(selector).evaluate('(node, pseudo) => getComputedStyle(node, pseudo).animationName', pseudo) == 'none'

    def ensure_offer():
        offer = page.locator('.director_fate_offer')
        if offer.count() == 0 or not offer.is_visible():
            page.locator('#director_fate_draw').click()
        page.locator('.director_fate_offer').wait_for(state='visible')
        page.wait_for_function("() => { const cards=[...document.querySelectorAll('.director_fate_choice')]; return cards.length===3 && cards.every(card => !card.disabled); }")

    def draw(text=secret):
        configure(json.dumps({'event':text}))
        open_panel()
        tab('current')
        previous = (fate().get('held') or {}).get('id')
        ensure_offer()
        hidden(text)
        page.locator('.director_fate_choice').first.click()
        page.wait_for_function("id => { const h=SillyTavern.getContext().chatMetadata.director?.fate?.held; return h && h.id !== id; }", arg=previous)
        page.wait_for_function("!document.querySelector('#director_fate_draw').disabled")
        held = fate()['held']
        assert held['event'] == text
        assert not fate().get('offer')
        hidden(text)
        return held

    def apply(held, inspect_ritual=False):
        configure()
        assert page.locator('#send_textarea').input_value() == ''
        before = len(requests())
        if inspect_ritual:
            # Pause the native HTTP request to inspect the applying state before
            # any reply exists, independent of provider or machine speed.
            pending = []
            pattern = '**/api/backends/chat-completions/generate'
            def hold_generation(route):
                pending.append(route)
            page.route(pattern, hold_generation)
            try:
                with page.expect_request(lambda request: request.url.endswith('/api/backends/chat-completions/generate') and request.method == 'POST'):
                    page.locator('#director_fate_apply').click()
                page.locator('#director_fate_panel').wait_for(state='hidden')
                open_panel()
                page.wait_for_function("document.querySelector('.director_fate_card')?.dataset.state === 'applying'")
                assert page.locator('#director_fate_status').inner_text() == '命运在转动…'
                ritual_hidden(held['event'])
                assert all(entry['id'] != held['id'] for entry in fate().get('log', []))
                assert page.locator('#chat .director_fate_mark').count() == 0
                tab('log')
                hidden(held['event'])
                assert log_entry(held).count() == 0
                tab('current')
                result['checks']['fateApplyingMarkupAndToastsKeepEventPrivate'] = True
                result['checks']['fateBeforeCompletionHasNoLogOrMessageMark'] = True
                page.emulate_media(reduced_motion='reduce')
                fade_only()
                page.emulate_media(reduced_motion='no-preference')
                settings()
                page.locator('#director_fate_motion').select_option('off')
                fade_only()
                page.locator('#director_fate_motion').select_option('system')
                result['checks']['fateApplyingReducedMotionAndMotionOffDisableAnimations'] = True
                assert len(pending) == 1
                close_panel()
            finally:
                try:
                    # Removing the last handler disables interception and can
                    # release paused requests. Continue them before unroute.
                    for route in pending:
                        route.continue_()
                finally:
                    page.unroute(pattern, hold_generation)
        else:
            page.locator('#director_fate_apply').click()
        page.locator('#director_fate_panel').wait_for(state='hidden')
        page.wait_for_function("id => { const f=SillyTavern.getContext().chatMetadata.director?.fate; return !f?.held && f?.bound?.id === id; }", arg=held['id'], timeout=30000)
        idle()
        open_panel()
        page.wait_for_function("!document.querySelector('#director_fate_draw').disabled")
        close_panel()
        assert len(requests()) > before
        assert body(before).count(held['event']) == 1

    # A normal pending instruction must survive the quiet draw and coexist
    # with the Fate prompt during the eventual real story generation.
    open_panel()
    assert page.locator('.director_fate_card').get_attribute('data-state') == 'empty'
    assert page.locator('.director_fate_face').text_content() == ''
    close_panel()
    result['checks']['fateEmptyCardHasNoFaceText'] = True
    page.locator('#directorButton').click()
    page.locator('#directorPopover [data-preset-id="direct"]').click()
    page.locator('dialog[open] #director-input-0').fill('ORDINARY_DIRECTOR_FATE_COEXIST')
    page.locator('dialog[open] .popup-button-ok').click()
    page.wait_for_function("Object.values(SillyTavern.getContext().chatMetadata.script_injects ?? {}).some(x => x.directorEphemeral)")
    before = page.evaluate('SillyTavern.getContext().chat.length')
    held = draw()
    assert page.evaluate('SillyTavern.getContext().chat.length') == before
    assert 'ORDINARY_DIRECTOR_FATE_COEXIST' not in body()
    assert page.evaluate("Object.values(SillyTavern.getContext().chatMetadata.script_injects).some(x => x.value.includes('ORDINARY_DIRECTOR_FATE_COEXIST'))")
    assert len(page.locator('#director_fate_title').inner_text()) > 0
    assert page.locator('.director_fate_card').get_attribute('data-state') == 'sealed'
    assert page.locator('.director_fate_back').count() == 1
    assert page.locator('#director_fate_status').inner_text() == '牌已封存。'
    ritual_hidden(secret)
    page.emulate_media(reduced_motion='reduce')
    assert page.locator('.director_fate_back').evaluate("node => getComputedStyle(node,'::before').animationName") == 'none'
    fade_only()
    page.emulate_media(reduced_motion='no-preference')
    result['checks']['fateSystemReducedMotionUsesFadeWithoutBreathing'] = True
    settings()
    assert page.locator('#director_fate_reveal').input_value() == 'tap'
    assert not page.locator('#director_fate_sound').is_checked()
    assert page.locator('#director_fate_motion').input_value() == 'system'
    for control in ('director_fate_reveal', 'director_fate_sound', 'director_fate_motion'):
        assert page.locator('label[for="' + control + '"]').count() == 1
    page.locator('#director_fate_settings_toggle').click()
    result['checks']['fateSealedMarkupPrivateAndDefaultRitualSettings'] = True
    result['checks']['fateDrawSealedAndExistingInstructionPreserved'] = True

    page.set_viewport_size({'width':390,'height':844})
    assert page.locator('#director_fate_panel').evaluate('n => n.scrollWidth <= n.clientWidth')
    assert page.locator('.director_fate_card').evaluate('n => { const r=n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }')
    hidden(secret)
    screenshots=Path(__file__).resolve().parents[1] / '.evidence' / 'fate'
    screenshots.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(screenshots / 'mobile.png'))
    result['checks']['fateRitualMobileCardHasNoOverflow'] = True
    page.set_viewport_size({'width':1440,'height':1000})
    page.screenshot(path=str(screenshots / 'desktop.png'))
    close_panel()
    page.locator('#send_textarea').fill('Unsent draft stays here.')
    open_panel()
    assert page.locator('#send_textarea').input_value() == 'Unsent draft stays here.'
    attempts = len(requests())
    page.locator('#director_fate_apply').click()
    page.wait_for_function("document.querySelector('#director_fate_status')?.textContent.includes('草稿')")
    assert len(requests()) == attempts
    assert page.locator('#send_textarea').input_value() == 'Unsent draft stays here.'
    close_panel()
    page.locator('#send_textarea').fill('')
    page.evaluate('async () => { await SillyTavern.getContext().reloadCurrentChat(); }')
    assert fate()['held']['id'] == held['id']
    open_panel()
    hidden(secret)
    result['checks']['fateMobileDraftAndReload'] = True

    close_panel()
    page.locator('#file_form_input').set_input_files({
        'name':'fate-unsent-attachment.txt', 'mimeType':'text/plain',
        'buffer':b'Pending attachment must stay unsent during Fate adoption.',
    })
    open_panel()
    attempts = len(requests())
    messages = page.evaluate('SillyTavern.getContext().chat.length')
    page.locator('#director_fate_apply').click()
    page.wait_for_function("document.querySelector('#director_fate_status')?.textContent.includes('附件')")
    assert len(requests()) == attempts
    assert page.evaluate('SillyTavern.getContext().chat.length') == messages
    assert page.locator('#file_form_input').evaluate('input => input.files.length') == 1
    assert fate()['held']['id'] == held['id']
    assert page.locator('#director_fate_panel').is_visible()
    close_panel()
    page.locator('#file_form_input').set_input_files([])
    open_panel()
    result['checks']['fatePendingAttachmentStaysUnsentAndPreserved'] = True

    # Observe the live row before completion so the short pulse cannot finish
    # before Python inspects it. Count newly fresh nodes and real animation ends.
    page.evaluate("""() => {
        const chat = document.querySelector('#chat');
        const seen = new WeakSet();
        window.__fateMarkPulse = { fresh: 0, starts: 0, ends: 0 };
        const noteFresh = () => {
            for (const node of chat.querySelectorAll('.director_fate_mark.is_fresh')) {
                if (seen.has(node)) continue;
                seen.add(node);
                window.__fateMarkPulse.fresh++;
            }
        };
        window.__fateMarkObserver = new MutationObserver(noteFresh);
        window.__fateMarkObserver.observe(chat, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        window.__fateMarkAnimation = event => {
            if (!event.target.matches('.director_fate_mark')) return;
            window.__fateMarkPulse[event.type === 'animationstart' ? 'starts' : 'ends']++;
        };
        chat.addEventListener('animationstart', window.__fateMarkAnimation);
        chat.addEventListener('animationend', window.__fateMarkAnimation);
    }""")
    apply(held, inspect_ritual=True)
    hidden(secret)
    slot = fate()['bound']['slotIndex']
    assert_mark(held, slot)
    assert page.locator('#chat .mes[mesid="' + str(slot) + '"] .mes_text').inner_text() == reply
    page.wait_for_function("() => window.__fateMarkPulse.ends === 1 && !document.querySelector('#chat .director_fate_mark')?.classList.contains('is_fresh')")
    assert page.evaluate('window.__fateMarkPulse') == {'fresh':1, 'starts':1, 'ends':1}
    mark(slot).click()
    page.locator('#director_fate_panel').wait_for(state='visible')
    entry = log_entry(held)
    assert page.locator('#director_fate_tab_log').get_attribute('aria-selected') == 'true'
    assert entry.evaluate('node => node === document.activeElement')
    assert entry.locator('.director_fate_log_event').text_content() == ''
    assert entry.locator('.director_fate_log_flip').inner_text() == '翻开'
    hidden(secret)
    assert page.locator('#director_fate_tab_current').get_attribute('role') == 'tab'
    assert page.locator('#director_fate_tab_log').get_attribute('role') == 'tab'
    assert page.locator('.director_fate_tab').count() == 2
    assert page.locator('.director_fate_tab').evaluate_all("nodes => nodes.every(node => !node.classList.contains('menu_button'))")
    assert page.locator('#director_fate_tab_log').evaluate("node => node.parentElement.getAttribute('role') === 'tablist'")
    page.locator('#director_fate_tab_log').focus()
    page.keyboard.press('ArrowLeft')
    page.wait_for_function("document.activeElement?.id === 'director_fate_tab_current' && document.activeElement.getAttribute('aria-selected') === 'true'")
    page.keyboard.press('ArrowRight')
    page.wait_for_function("document.activeElement?.id === 'director_fate_tab_log' && document.activeElement.getAttribute('aria-selected') === 'true'")
    page.keyboard.press('ArrowRight')
    page.wait_for_function("document.activeElement?.id === 'director_fate_tab_current' && document.activeElement.getAttribute('aria-selected') === 'true'")
    page.keyboard.press('End')
    page.wait_for_function("document.activeElement?.id === 'director_fate_tab_log' && document.activeElement.getAttribute('aria-selected') === 'true'")
    page.keyboard.press('Home')
    page.wait_for_function("document.activeElement?.id === 'director_fate_tab_current' && document.activeElement.getAttribute('aria-selected') === 'true'")
    assert page.locator('#director_fate_tab_current').get_attribute('tabindex') == '0'
    assert page.locator('#director_fate_tab_log').get_attribute('tabindex') == '-1'
    # The native accessibility observer processes dynamically inserted controls.
    # Their dedicated class must keep their tab roles after another mutation.
    tab('log')
    log_entry(held).locator('.director_fate_log_flip').focus()
    assert page.locator('#director_fate_tab_current').get_attribute('role') == 'tab'
    assert page.locator('#director_fate_tab_log').get_attribute('role') == 'tab'
    page.keyboard.press('Escape')
    page.locator('#director_fate_panel').wait_for(state='hidden')
    page.wait_for_function("document.activeElement?.id === 'director_fate_open'")
    result['checks']['fateMessageMarkPrivatePlacedOutsideTextAndPulsesOnce'] = True
    result['checks']['fateMarkOpensFocusedLogAndTabsKeyboardEscRestoreFocus'] = True
    result['checks']['fateTabsKeepRolesThroughNativeAccessibilityObserverAndWrapHomeEnd'] = True
    reveal_toast(held).click()
    page.locator('#director_fate_panel').wait_for(state='visible')
    assert page.locator('.director_fate_card').get_attribute('data-state') == 'revealed'
    assert page.locator('#director_fate_status').inner_text() == '命运已降临，点击翻牌。'
    ritual_hidden(secret)
    page.locator('#director_fate_flip').click()
    page.wait_for_function('event => document.querySelector(".director_fate_face")?.textContent === event', arg=secret)
    tab('log')
    assert log_entry(held).locator('.director_fate_log_event').text_content() == secret
    assert log_entry(held).locator('.director_fate_log_flip').is_hidden()
    tab('current')
    result['checks']['fateTitleOnlyCompletionToastAndExplicitTapReveal'] = True
    result['checks']['fateCurrentFlipAlsoRevealsSameLogEntry'] = True

    close_panel()
    anchor = page.evaluate('slot => SillyTavern.getContext().chat[slot - 1].mes', slot)
    try:
        page.evaluate("slot => { SillyTavern.getContext().chat[slot - 1].mes = 'Changed anchor for the stale-card check.'; }", slot)
        open_panel()
        assert page.locator('.director_fate_card').get_attribute('data-state') == 'stale'
        ritual_hidden(secret)
        assert not page.locator('#director_fate_flip').is_visible()
        close_panel()
    finally:
        page.evaluate('({slot, anchor}) => { SillyTavern.getContext().chat[slot - 1].mes = anchor; }', {'slot':slot, 'anchor':anchor})
    open_panel()
    assert page.locator('.director_fate_face').text_content() == secret
    result['checks']['fateStaleAnchorHidesPreviouslyFlippedEvent'] = True
    page.locator('#chat [mesid="' + str(slot) + '"]').evaluate("node => { window.__fateJumpCount=0; node.scrollIntoView=() => { window.__fateJumpCount++; }; }")
    page.locator('#director_fate_jump').click()
    page.locator('#director_fate_panel').wait_for(state='hidden')
    page.wait_for_function('window.__fateJumpCount === 1')
    open_panel()
    row = page.locator('#chat [mesid="' + str(slot) + '"]')
    row.evaluate("node => { window.__fateJumpRow=node; node.removeAttribute('mesid'); }")
    try:
        page.locator('#director_fate_jump').click()
        page.locator('#toast-container .toast').filter(has_text='该消息未加载，请向上滚动').last.wait_for(state='visible')
    finally:
        page.evaluate("slot => { window.__fateJumpRow.setAttribute('mesid',String(slot)); delete window.__fateJumpRow.scrollIntoView; delete window.__fateJumpRow; }", slot)
    open_panel()
    page.keyboard.press('Escape')
    page.locator('#director_fate_panel').wait_for(state='hidden')
    page.wait_for_function("document.activeElement?.id === 'director_fate_open'")
    page.locator('#directorButton').click()
    result['checks']['fateRevealJumpLoadedMissingAndEscFocus'] = True
    assert 'ORDINARY_DIRECTOR_FATE_COEXIST' in body()
    result['fateInstructionState'] = page.evaluate('structuredClone(SillyTavern.getContext().chatMetadata)')
    assert page.evaluate('SillyTavern.getContext().chatMetadata.director.boundInstruct.text') == 'ORDINARY_DIRECTOR_FATE_COEXIST' or page.evaluate("SillyTavern.getContext().chatMetadata.director.boundInstruct.text.includes('ORDINARY_DIRECTOR_FATE_COEXIST')")
    assert page.evaluate('SillyTavern.getContext().chat.at(-1).mes') == reply
    target = page.evaluate('SillyTavern.getContext().chat.length - 1')
    swipe_count = page.evaluate('SillyTavern.getContext().chat.at(-1).swipes.length')
    swipe_message(page, target, swipe_count)
    assert body().count(secret) == 1
    page.evaluate("async () => { await SillyTavern.getContext().generate('regenerate'); }")
    assert body().count(secret) == 1
    assert fate()['bound']['id'] == held['id']
    page.evaluate("async () => { await SillyTavern.getContext().generate('normal'); }")
    assert secret not in body()
    result['checks']['fateAdoptAndExactSwipeRegenerateWithoutNormalRetrigger'] = True
    idle()
    assert not fate().get('bound')
    assert len([entry for entry in fate().get('log', []) if entry['id'] == held['id']]) == 1
    # Solo replies have no generation id. Swipe/regenerate leave this binding
    # unchanged, so completion must preserve the entry without counting a write.
    assert next(entry for entry in fate()['log'] if entry['id'] == held['id'])['replays'] == 0
    assert_mark(held, slot)
    assert page.evaluate('window.__fateMarkPulse') == {'fresh':1, 'starts':1, 'ends':1}
    page.evaluate("""() => {
        window.__fateMarkObserver.disconnect();
        const chat = document.querySelector('#chat');
        chat.removeEventListener('animationstart', window.__fateMarkAnimation);
        chat.removeEventListener('animationend', window.__fateMarkAnimation);
    }""")
    reload_browser()
    assert_mark(held, slot)
    assert not mark(slot).evaluate("node => node.classList.contains('is_fresh')")
    open_panel()
    tab('log')
    entry = log_entry(held)
    assert entry.locator('.director_fate_log_jump').is_enabled()
    assert entry.locator('.director_fate_log_event').text_content() == ''
    hidden(secret)
    entry.locator('.director_fate_log_flip').click()
    assert entry.locator('.director_fate_log_event').text_content() == secret
    close_panel()
    result['checks']['fateLogAndMessageMarkPersistAfterNextMessageAndBrowserReload'] = True
    result['checks']['fateUnchangedReplayKeepsLogAndDoesNotRepeatMessagePulse'] = True

    held = draw('FATE_PRIVATE_02: An unexpected invitation offers a new route.')
    configure('MALFORMED_PRIVATE_BODY not valid JSON')
    page.locator('#director_fate_draw').click()
    page.locator('.director_fate_choice').first.wait_for(state='visible')
    page.locator('.director_fate_choice').first.click()
    page.wait_for_function("document.querySelector('#director_fate_status').textContent.includes('未抽到')")
    assert fate()['held']['id'] == held['id']
    assert len(fate()['offer']['cards']) == 3
    hidden('MALFORMED_PRIVATE_BODY')
    configure(nextStatus=500)
    with page.expect_response(generation_response) as failed_apply:
        page.locator('#director_fate_apply').click()
    assert_provider_failure(failed_apply.value, 'apply')
    page.locator('#director_fate_panel').wait_for(state='hidden')
    idle()
    open_panel()
    page.wait_for_function("!document.querySelector('#director_fate_apply').disabled")
    assert fate()['held']['id'] == held['id']
    apply(held)
    result['checks']['fateMalformedDrawAndFailedApplyKeepSameCardForRetry'] = True
    assert not page.evaluate('SillyTavern.getContext().chatMetadata.director.boundInstruct')
    page.evaluate("async () => { await SillyTavern.getContext().generate('regenerate'); }")
    assert body().count(held['event']) == 1
    configure(nextStatus=500)
    target=page.evaluate('SillyTavern.getContext().chat.length - 1')
    swipe_count=page.evaluate('SillyTavern.getContext().chat.at(-1).swipes.length')
    with page.expect_response(generation_response) as failed_swipe:
        swipe_message(page,target,swipe_count)
    assert_provider_failure(failed_swipe.value, 'nativeSwipe')
    idle()
    result['checks']['fateOnlyDirectRegenerateAndNativeFailureUnlock'] = True

    held = draw('FATE_PRIVATE_03: A distant signal interrupts the quiet scene.')
    configure('Slow synthetic Fate reply. ' * 50, rate=5)
    page.evaluate("async () => { (await import('/scripts/openai.js')).oai_settings.stream_openai = true; }")
    page.locator('#director_fate_apply').click()
    page.locator('#director_fate_panel').wait_for(state='hidden')
    page.wait_for_function("window.__fateLabMain.is_send_press && !!SillyTavern.getContext().streamingProcessor", timeout=30000)
    page.wait_for_function("SillyTavern.getContext().chat.at(-1)?.mes?.includes('Slow synthetic')", timeout=30000)
    page.evaluate('() => SillyTavern.getContext().stopGeneration()')
    idle()
    open_panel()
    page.wait_for_function("!document.querySelector('#director_fate_apply').disabled")
    assert fate()['held']['id'] == held['id']
    page.locator('#director_fate_discard').click()
    page.wait_for_function('!SillyTavern.getContext().chatMetadata.director.fate?.held')
    close_panel()
    page.evaluate("async () => { (await import('/scripts/openai.js')).oai_settings.stream_openai = false; }")
    configure()
    page.evaluate("async () => { await SillyTavern.getContext().generate('normal'); }")
    idle()
    assert held['event'] not in body()
    result['checks']['fateStopRetainsCardAndDiscardDisarmsOrdinarySend'] = True

    # Stop during pre-interceptor setup, while GENERATION_STARTED is still awaited
    # and Generate has not replaced abortController. No chat row and no provider call.
    held = draw('FATE_PREP_STOP: A bell rings before the story can move.')
    chat_before = page.evaluate('SillyTavern.getContext().chat.length')
    requests_before = len(requests())
    page.evaluate("""() => {
        const c = SillyTavern.getContext();
        let release;
        window.__fatePrepGate = new Promise(resolve => { release = resolve; });
        window.__fateReleasePrep = release;
        window.__fatePrepEntered = false;
        window.__fateSawStop = false;
        window.__fateNoteStop = () => { window.__fateSawStop = true; };
        window.__fateDelayPrep = async type => {
            if (type !== 'normal') return;
            c.eventSource.removeListener(c.eventTypes.GENERATION_STARTED, window.__fateDelayPrep);
            window.__fatePrepEntered = true;
            await window.__fatePrepGate;
        };
        c.eventSource.on(c.eventTypes.GENERATION_STARTED, window.__fateDelayPrep);
        c.eventSource.on(c.eventTypes.GENERATION_STOPPED, window.__fateNoteStop);
    }""")
    try:
        page.locator('#director_fate_apply').click()
        page.wait_for_function("() => window.__fatePrepEntered === true && getComputedStyle(document.querySelector('#mes_stop')).display !== 'none'")
        # The Fate dialog covers the send form. Click the Stop control directly.
        page.evaluate("""() => {
            const stop = document.querySelector('#mes_stop');
            if (getComputedStyle(stop).display === 'none') throw new Error('Stop is hidden during prep');
            stop.click();
        }""")
        page.wait_for_function('window.__fateSawStop === true')
        page.evaluate('() => window.__fateReleasePrep()')
        page.locator('#director_fate_panel').wait_for(state='hidden', timeout=30000)
        idle()
        assert page.evaluate('SillyTavern.getContext().chat.length') == chat_before
        assert len(requests()) == requests_before, len(requests())
        open_panel()
        assert fate()['held']['id'] == held['id']
        assert not fate().get('bound')
        assert page.evaluate("getComputedStyle(document.querySelector('#mes_stop')).display") == 'none'
        page.wait_for_function("!document.querySelector('#director_fate_apply').disabled")
        result['checks']['fateStopDuringPrepSendsNoProviderRequest'] = True
        close_panel()
    finally:
        page.evaluate("""() => {
            const c = SillyTavern.getContext();
            if (window.__fateDelayPrep) c.eventSource.removeListener(c.eventTypes.GENERATION_STARTED, window.__fateDelayPrep);
            if (window.__fateNoteStop) c.eventSource.removeListener(c.eventTypes.GENERATION_STOPPED, window.__fateNoteStop);
            if (typeof window.__fateReleasePrep === 'function') window.__fateReleasePrep();
        }""")

    # A real two-member group: the private event appears only in the first
    # member's request; native regenerate must replay the same entire batch.
    second_avatar = page.evaluate("""async ({sample,suffix}) => {
        const c=SillyTavern.getContext();
        const post=async (url,data) => {
            const r=await fetch(url,{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify(data)});
            if(!r.ok) throw new Error('group fixture request failed');
            return r.json();
        };
        const form=new FormData();
        form.set('ch_name','Fate Synthetic Two');form.set('file_name','FateTwo-'+suffix);form.set('first_mes','Ready');
        const response=await fetch('/api/characters/create',{method:'POST',headers:{'X-CSRF-Token':c.getRequestHeaders()['X-CSRF-Token']},body:form});
        if(!response.ok) throw new Error('second Fate character failed');
        const avatar=await response.text();
        await c.getCharacters();
        if(!SillyTavern.getContext().characters.some(x=>x.avatar===avatar)) throw new Error('second member not loaded');
        const chatId='FateGroup-'+suffix;
        const group=await post('/api/groups/create',{name:'Fate Synthetic Group',members:[sample.avatar,avatar],
            chat_id:chatId,chats:[chatId],activation_strategy:1,generation_mode:0});
        await post('/api/chats/group/save',{id:chatId,chat:[
            {user_name:'Synthetic Tester',character_name:'Group',chat_metadata:{integrity:chatId}},
            {name:'Synthetic Tester',is_user:true,is_system:false,mes:'A new group scene.',extra:{},send_date:'2026-01-01T00:00:00.000Z'},
        ]});
        const g=await import('/scripts/group-chats.js');await g.getGroups();
        if(!await g.openGroupById(group.id)) throw new Error('Fate group did not open');
        return avatar;
    }""", {'sample':sample,'suffix':uuid.uuid4().hex[:10]})
    page.wait_for_function('!!SillyTavern.getContext().groupId && SillyTavern.getContext().chat.length === 1')
    held = draw('FATE_GROUP_PRIVATE: A courier arrives asking for the party.')
    apply(held)
    batch = requests()[-2:]
    assert [json.dumps(r).count(held['event']) for r in batch] == [1,0]
    names = page.evaluate('SillyTavern.getContext().chat.filter(m=>!m.is_user&&!m.is_system).map(m=>m.name)')
    assert set(names) == {'Director Synthetic','Fate Synthetic Two'}, names
    group_slot = fate()['bound']['slotIndex']
    assert_mark(held, group_slot)
    assert mark(group_slot + 1).count() == 0
    assert page.locator('#chat .director_fate_mark').count() == 1
    assert len(fate()['log']) == 1 and fate()['log'][0]['id'] == held['id']
    group_generation = fate()['log'][0]['generationId']
    assert group_generation is not None and fate()['log'][0]['replays'] == 0
    result['checks']['fateGroupOnlyFirstBatchMemberGetsLogAndMessageMark'] = True
    page.evaluate("async () => { await (await import('/scripts/group-chats.js')).regenerateGroup(); }")
    assert [json.dumps(r).count(held['event']) for r in requests()[-2:]] == [1,0]
    assert fate()['bound']['id'] == held['id']
    assert len(fate()['log']) == 1 and fate()['log'][0]['id'] == held['id']
    assert fate()['log'][0]['generationId'] != group_generation
    assert fate()['log'][0]['generationId'] == fate()['bound']['generationId']
    assert fate()['log'][0]['replays'] == 1
    assert_mark(held, group_slot)
    assert mark(group_slot + 1).count() == 0
    result['checks']['fateGroupReplayUpdatesExistingLogOnceForChangedGeneration'] = True
    page.evaluate("async () => { const m=await import('/script.js');await m.deleteLastMessage();await m.deleteLastMessage();await m.Generate('normal'); }")
    assert all(held['event'] not in json.dumps(r) for r in requests()[-2:])
    result['checks']['fateRealGroupBatchReplayAndManualDeletionDoesNotRetrigger'] = True

    # Switch chats through the native API during the awaited generation-start
    # hook. The real quiet request finishes after ownership has changed.
    page.evaluate("""async avatar => {
        const c=SillyTavern.getContext();
        await c.selectCharacterById(c.characters.findIndex(x=>x.avatar===avatar));
    }""", sample['avatar'])
    kept = draw('FATE_STALE_KEEP: An unopened letter awaits its moment.')
    configure(json.dumps({'event':'FATE_STALE_DROP: This response belongs to the old chat.'}))
    page.evaluate("""avatar => {
        const c=SillyTavern.getContext();
        window.__fateOldMetadata=c.chatMetadata;
        const switchDuringDraw=async type => {
            if(type!=='quiet') return;
            c.eventSource.removeListener(c.eventTypes.GENERATION_STARTED,switchDuringDraw);
            const current=SillyTavern.getContext();
            await current.selectCharacterById(current.characters.findIndex(x=>x.avatar===avatar));
        };
        c.eventSource.on(c.eventTypes.GENERATION_STARTED,switchDuringDraw);
    }""", second_avatar)
    page.locator('#director_fate_draw').click()
    page.locator('.director_fate_choice').first.wait_for(state='visible')
    with page.expect_response(generation_response) as stale_reply:
        page.locator('.director_fate_choice').first.click()
    assert stale_reply.value.status == 200
    stale_reply.value.body()
    idle()
    page.evaluate('() => new Promise(requestAnimationFrame)')
    assert page.evaluate('SillyTavern.getContext().characters[SillyTavern.getContext().characterId].avatar') == second_avatar
    assert not fate().get('held')
    assert page.evaluate('window.__fateOldMetadata.director.fate.held.id') == kept['id']
    hidden('FATE_STALE_DROP')
    close_panel()
    page.evaluate("""async avatar => {
        const c=SillyTavern.getContext();
        await c.reloadCurrentChat();
        if(SillyTavern.getContext().chatMetadata.director?.fate?.held) throw new Error('stale draw saved into destination chat');
        const current=SillyTavern.getContext();
        await current.selectCharacterById(current.characters.findIndex(x=>x.avatar===avatar));
    }""", sample['avatar'])
    assert fate()['held']['id'] == kept['id']
    result['checks']['fateStaleDrawDoesNotReplaceOrSaveIntoAnotherChat'] = True

    # Reveal policies use the same completed binding. The event must remain
    # absent while sealed even when the next completed card will reveal itself.
    open_panel()
    settings()
    page.locator('#director_fate_reveal').select_option('auto')
    auto = draw('FATE_AUTO_PRIVATE: An old keepsake returns in an unexpected place.')
    ritual_hidden(auto['event'])
    was_reduced = page.evaluate("document.body.classList.contains('reduced-motion')")
    page.evaluate("document.body.classList.add('reduced-motion')")
    try:
        apply(auto)
        assert_mark_motion_suppressed(auto, fate()['bound']['slotIndex'])
    finally:
        page.evaluate("reduced => document.body.classList.toggle('reduced-motion', reduced)", was_reduced)
    result['checks']['fateAppReducedMotionSkipsMessageMarkPulse'] = True
    reveal_toast(auto)
    open_panel()
    page.wait_for_function('event => document.querySelector(".director_fate_face")?.textContent === event', arg=auto['event'])
    assert not page.locator('#director_fate_flip').is_visible()
    tab('log')
    assert log_entry(auto).locator('.director_fate_log_event').text_content() == auto['event']
    assert log_entry(auto).locator('.director_fate_log_flip').is_hidden()
    tab('current')
    result['checks']['fateAutoShowsOnlyCompletedEventWithoutFlip'] = True
    result['checks']['fateLogAutoRevealsCompletedEventWithoutFlip'] = True

    settings()
    page.locator('#director_fate_reveal').select_option('off')
    off = draw('FATE_OFF_PRIVATE: A hidden stairway opens beyond the ruined gate.')
    ritual_hidden(off['event'])
    page.emulate_media(reduced_motion='reduce')
    try:
        apply(off)
        assert_mark_motion_suppressed(off, fate()['bound']['slotIndex'])
    finally:
        page.emulate_media(reduced_motion='no-preference')
    result['checks']['fateSystemReducedMotionSkipsMessageMarkPulse'] = True
    reveal_toast(off).click()
    page.locator('#director_fate_panel').wait_for(state='visible')
    assert page.locator('.director_fate_card').get_attribute('data-state') == 'revealed'
    assert not page.locator('#director_fate_flip').is_visible()
    ritual_hidden(off['event'])
    hidden(off['event'])
    tab('log')
    assert log_entry(off).locator('.director_fate_log_event').text_content() == ''
    assert log_entry(off).locator('.director_fate_log_flip').is_hidden()
    hidden(off['event'])
    tab('current')
    result['checks']['fateOffStillToastsTitleAndNeverShowsEvent'] = True
    result['checks']['fateLogOffNeverPutsEventInMarkup'] = True

    settings()
    with page.expect_response(lambda response: saved_settings_match(response, reveal='off', sound=True, motion='off')) as saved_settings:
        page.locator('#director_fate_sound').check()
        page.locator('#director_fate_motion').select_option('off')
    assert saved_settings.value.ok
    assert page.locator('#director_fate_panel').evaluate('node => node.classList.contains("director_fate_nomotion")')
    fade_only()
    reload_browser()
    open_panel()
    settings()
    assert page.locator('#director_fate_reveal').input_value() == 'off'
    assert page.locator('#director_fate_sound').is_checked()
    assert page.locator('#director_fate_motion').input_value() == 'off'
    ritual_hidden(off['event'])
    result['checks']['fateRitualSettingsPersistAfterBrowserReload'] = True

    # A flip lasts only for this page lifetime. Keeping the same bound card on
    # disk must not cause tap mode to disclose its event after another reload.
    with page.expect_response(lambda response: saved_settings_match(response, reveal='tap', sound=True, motion='off')) as saved_tap:
        page.locator('#director_fate_reveal').select_option('tap')
    assert saved_tap.value.ok
    ritual_hidden(off['event'])
    tab('log')
    hidden(off['event'])
    log_entry(off).locator('.director_fate_log_flip').click()
    assert log_entry(off).locator('.director_fate_log_event').text_content() == off['event']
    tab('current')
    assert page.locator('.director_fate_face').text_content() == off['event']
    assert not page.locator('#director_fate_flip').is_visible()
    result['checks']['fateLogTapFlipAlsoRevealsCurrentCard'] = True
    page.set_viewport_size({'width':390,'height':844})
    assert page.locator('#director_fate_panel').evaluate('node => node.scrollWidth <= node.clientWidth')
    assert page.locator('.director_fate_card').evaluate('node => { const rect=node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }')
    page.screenshot(path=str(screenshots / 'reveal-mobile.png'))
    page.set_viewport_size({'width':1440,'height':1000})
    reload_browser()
    open_panel()
    assert page.locator('.director_fate_card').get_attribute('data-state') == 'revealed'
    ritual_hidden(off['event'])
    assert page.locator('#director_fate_flip').is_visible()
    result['checks']['fateTapFlipMemoryResetsOnBrowserReload'] = True
    settings()
    with page.expect_response(lambda response: saved_settings_match(response, reveal='tap', sound=False, motion='system')) as restored_settings:
        page.locator('#director_fate_sound').uncheck()
        page.locator('#director_fate_motion').select_option('system')
    assert restored_settings.value.ok
    close_panel()

    # Deal three local backs, keep them through a failed pick and a reload, then seal one.
    offer_secret = 'FATE_OFFER_PRIVATE: Three sealed backs hide one concrete turn.'
    page.set_viewport_size({'width':390,'height':844})
    open_panel()
    assert page.locator('#director_fate_draw').inner_text() == '发牌'
    page.locator('#director_fate_draw').click()
    page.locator('.director_fate_offer').wait_for(state='visible')
    page.wait_for_function("() => { const cards=[...document.querySelectorAll('.director_fate_choice')]; return cards.length===3 && cards.every(card => !card.disabled); }")
    assert page.locator('#director_fate_draw').inner_text() == '换一组'
    labels = page.locator('.director_fate_choice').evaluate_all("nodes => nodes.map(node => node.getAttribute('aria-label'))")
    assert [label.startswith('第 ' + str(index) + ' 张：〈') and '，〈' in label for index, label in enumerate(labels, start=1)] == [True, True, True]
    layout = page.locator('.director_fate_offer').evaluate("""node => {
        const cards = [...node.querySelectorAll('.director_fate_choice')].map(el => el.getBoundingClientRect());
        const panel = node.closest('#director_fate_panel');
        return {
            row: cards.length === 3 && cards.every(card => Math.abs(card.top - cards[0].top) < 2),
            fits: cards.every(card => card.left >= -1 && card.right <= window.innerWidth + 1),
            widths: cards.map(card => card.width),
            separated: cards[1].left >= cards[0].right - 1 && cards[2].left >= cards[1].right - 1,
            panelFits: panel.scrollWidth <= panel.clientWidth + 1,
        };
    }""")
    assert layout['row'] and layout['fits'] and layout['separated'] and layout['panelFits'], layout
    assert all(70 <= width <= 140 for width in layout['widths']), layout
    hidden(offer_secret)
    offer_id = fate()['offer']['id']
    close_panel()
    idle()
    reload_browser()
    page.set_viewport_size({'width':390,'height':844})
    open_panel()
    assert fate()['offer']['id'] == offer_id
    assert page.locator('.director_fate_choice').count() == 3
    page.locator('.director_fate_offer').wait_for(state='visible')
    hidden(offer_secret)
    result['checks']['fateOfferSurvivesBrowserReload'] = True
    result['checks']['fateOfferMobileRowHasNoOverflow'] = True
    configure('FATE_OFFER_BROKEN not valid JSON')
    page.locator('.director_fate_choice').nth(0).click()
    page.wait_for_function("document.querySelector('#director_fate_status').textContent.includes('未抽到')")
    assert fate()['offer']['id'] == offer_id
    assert len(fate()['offer']['cards']) == 3
    assert not fate().get('held')
    assert not page.locator('.director_fate_choice').first.is_disabled()
    hidden('FATE_OFFER_BROKEN')
    result['checks']['fateOfferKeptAfterQuietFailureAndRepick'] = True
    configure(json.dumps({'event':offer_secret}))
    page.locator('.director_fate_choice').nth(1).click()
    # Metadata updates before the chat save resolves. Wait until that save refreshes the panel.
    page.wait_for_function("""() => {
        const fate = SillyTavern.getContext().chatMetadata.director?.fate;
        const card = document.querySelector('.director_fate_card');
        return fate?.held && !fate.offer && card?.dataset.state === 'sealed' && !card.hidden;
    }""")
    assert page.locator('.director_fate_card').get_attribute('data-state') == 'sealed'
    assert page.locator('#director_fate_status').inner_text() == '牌已封存。'
    hidden(offer_secret)
    held = fate()['held']
    assert held['event'] == offer_secret
    settings()
    page.locator('#director_fate_motion').select_option('off')
    apply(held)
    assert_mark_motion_suppressed(held, fate()['bound']['slotIndex'])
    result['checks']['fateMotionOffSkipsMessageMarkPulse'] = True
    reveal_toast(held).click()
    page.locator('#director_fate_panel').wait_for(state='visible')
    assert page.locator('.director_fate_face').text_content() == ''
    page.locator('#director_fate_flip').click()
    page.wait_for_function('event => document.querySelector(".director_fate_face")?.textContent === event', arg=offer_secret)
    result['checks']['fateDealPickSealApplyReveal'] = True
    result['checks']['fateOfferMarkupKeepsEventPrivate'] = True
    tab('log')
    entries = fate()['log']
    assert page.locator('#director_fate_tab_log').inner_text() == '本局命运（' + str(len(entries)) + '）'
    assert page.locator('.director_fate_log_entry').evaluate_all('nodes => nodes.map(node => node.dataset.entryId)') == [entry['id'] for entry in entries]
    assert log_entry(held).get_by_text('第 ' + str(entries[0]['slotIndex'] + 1) + ' 条', exact=True).count() == 1
    for logged in entries:
        row = log_entry(logged)
        assert row.locator('.director_fate_log_heading strong').inner_text() == logged['title']
        assert row.locator('.director_fate_rarity_dot').get_attribute('data-rarity') == logged['rarity']
        strength = {'light':'轻微波澜', 'medium':'明显转折', 'strong':'重大变故'}[logged['strength']]
        assert row.locator('.director_fate_log_details').get_by_text(strength, exact=True).count() == 1
        assert row.locator('.director_fate_log_status').count() == 0
    assert page.locator('#director_fate_panel').evaluate('node => node.scrollWidth <= node.clientWidth')
    assert page.locator('.director_fate_log_entry').evaluate_all("nodes => nodes.every(node => { const rect=node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })")
    assert page.locator('.director_fate_log_entry').evaluate_all("nodes => { const rows=nodes.map(node => node.getBoundingClientRect()); return rows.every((row, index) => Math.abs(row.left - rows[0].left) <= 1 && (index === 0 || row.top >= rows[index - 1].bottom - 1)); }")
    page.screenshot(path=str(screenshots / 'log-mobile.png'))
    result['checks']['fateLogNewestFirstMobileSingleColumnHasNoOverflow'] = True
    result['checks']['fateLogListsRarityTitleStrengthAndOmitsOkStatus'] = True
    page.set_viewport_size({'width':1440,'height':1000})
    close_panel()

    # Give the real lazy-loading chat renderer a valid historical entry near
    # the start. Derive its card fields from a completed card, and fingerprint
    # the actual preceding row with the production helper.
    idle()
    old_entry = page.evaluate("""async ({sample, suffix}) => {
        const c = SillyTavern.getContext();
        const { messageFingerprint } = await import('/scripts/extensions/director/instruct.js');
        const template = structuredClone(c.chatMetadata.director.fate.log[0]);
        const file = 'FateLogLong-' + suffix;
        const rows = [];
        for (let index = 0; index < 2000; index++) {
            rows.push({ name: index % 2 ? 'Director Synthetic' : 'Synthetic Tester',
                is_user: index % 2 === 0, is_system: false, mes: 'Synthetic Fate history ' + index,
                extra: {}, send_date: '2026-01-01T00:00:00.000Z' });
        }
        const entry = { ...template, id: 'fate-history-' + suffix, slotIndex: 1,
            prevFingerprint: messageFingerprint(rows[0]), generationId: null, replays: 0 };
        const metadata = { integrity: file, director: { fate: { version: 1, log: [entry] } } };
        const response = await fetch('/api/chats/save', { method: 'POST', headers: c.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: sample.avatar, file_name: file, chat: [
                { user_name: 'Synthetic Tester', character_name: 'Director Synthetic', chat_metadata: metadata },
                ...rows,
            ] }) });
        if (!response.ok) throw new Error('Fate history fixture failed');
        if (await c.openCharacterChat(file) === false) throw new Error('Fate history chat did not open');
        return entry;
    }""", {'sample':sample, 'suffix':uuid.uuid4().hex[:10]})
    page.wait_for_function("() => SillyTavern.getContext().chat.length === 2000 && document.querySelectorAll('#chat .mes').length === 100 && !!document.querySelector('#show_more_messages')", timeout=60000)
    assert mark(old_entry['slotIndex']).count() == 0
    first_loaded = page.evaluate("Number(document.querySelector('#chat .mes').getAttribute('mesid'))")
    distance = first_loaded - old_entry['slotIndex']
    assert distance > 500
    open_panel()
    tab('log')
    hidden(old_entry['event'])
    assert log_entry(old_entry).locator('.director_fate_log_jump').is_enabled()
    log_entry(old_entry).locator('.director_fate_log_jump').click()
    confirmation = page.locator('dialog[open]').filter(has_text='需要加载约 ' + str(distance) + ' 条消息')
    confirmation.wait_for(state='visible')
    confirmation.get_by_text('取消', exact=True).click()
    confirmation.wait_for(state='hidden')
    assert mark(old_entry['slotIndex']).count() == 0
    assert page.locator('#chat .mes').count() == 100
    open_panel()
    tab('log')
    log_entry(old_entry).locator('.director_fate_log_jump').click()
    confirmation.get_by_text('加载', exact=True).click()
    page.wait_for_function("""slot => {
        const node = document.querySelector('#chat .mes[mesid="' + slot + '"]');
        if (!node?.classList.contains('director-fate-highlight')) return false;
        const rect = node.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight && !document.querySelector('dialog[open]');
    }""", arg=old_entry['slotIndex'], timeout=180000)
    assert_mark(old_entry, old_entry['slotIndex'])
    assert page.locator('#chat .mes[mesid="1"] .mes_text').inner_text() == 'Synthetic Fate history 1'
    assert not mark(old_entry['slotIndex']).evaluate("node => node.classList.contains('is_fresh')")
    hidden(old_entry['event'])
    result['checks']['fateLogJumpConfirmsLoadsAndHighlightsUnloadedOldMessage'] = True
    result['fateLogLongChat'] = {'messages':2000, 'loadedBeforeJump':100, 'confirmDistance':distance}

    # This historical jump runs with Fate motion disabled. The pre-existing
    # chapter highlight timer must still clear it without animation events.
    page.wait_for_function("!document.querySelector('#chat .mes[mesid=\"1\"]')?.classList.contains('director-fate-highlight')")
    result['checks']['fateLogJumpHighlightClearsWithoutAnimationEvents'] = True

    # Editing the predecessor emits the native MESSAGE_EDITED/MESSAGE_UPDATED
    # events. Restoring it must validate and repaint the existing mark again.
    victim = page.locator('#chat .mes[mesid="0"]')
    if victim.count() == 0:
        page.locator('#show_more_messages').click()
        victim.wait_for(state='attached')
    victim.scroll_into_view_if_needed()
    victim.hover()
    victim.locator('.mes_edit').click()
    victim.locator('#curEditTextarea').fill('Edited Fate history predecessor')
    victim.locator('.mes_edit_done').click()
    page.wait_for_function("SillyTavern.getContext().chat[0].mes === 'Edited Fate history predecessor' && document.querySelectorAll('#chat .director_fate_mark').length === 0")
    open_panel()
    tab('log')
    assert log_entry(old_entry).locator('.director_fate_log_status').inner_text() == '消息已改写'
    assert log_entry(old_entry).locator('.director_fate_log_jump').is_disabled()
    hidden(old_entry['event'])
    close_panel()
    victim.scroll_into_view_if_needed()
    victim.hover()
    victim.locator('.mes_edit').click()
    victim.locator('#curEditTextarea').fill('Synthetic Fate history 0')
    victim.locator('.mes_edit_done').click()
    page.wait_for_function("SillyTavern.getContext().chat[0].mes === 'Synthetic Fate history 0'")
    assert_mark(old_entry, old_entry['slotIndex'])
    open_panel()
    tab('log')
    assert log_entry(old_entry).locator('.director_fate_log_status').count() == 0
    assert log_entry(old_entry).locator('.director_fate_log_jump').is_enabled()
    close_panel()
    result['checks']['fateEditingPredecessorInvalidatesAndRestoringRepaintsMark'] = True

    # Remove the real predecessor through the native message editor. The log
    # retains the history while invalidating the old position and its mark.
    victim = page.locator('#chat .mes[mesid="0"]')
    if victim.count() == 0:
        page.locator('#show_more_messages').click()
        victim.wait_for(state='attached')
    victim.scroll_into_view_if_needed()
    victim.hover()
    victim.locator('.mes_edit').click()
    victim.locator('.mes_edit_delete').click()
    page.locator('dialog[open]').get_by_text('Delete Message', exact=True).click()
    page.wait_for_function("() => SillyTavern.getContext().chat.length === 1999 && SillyTavern.getContext().chat[0].mes === 'Synthetic Fate history 1'")
    page.wait_for_function("document.querySelectorAll('#chat .director_fate_mark').length === 0")
    open_panel()
    tab('log')
    entry = log_entry(old_entry)
    assert entry.locator('.director_fate_log_status').inner_text() == '消息已改写'
    assert entry.locator('.director_fate_log_jump').is_disabled()
    hidden(old_entry['event'])
    result['checks']['fateDeletingPredecessorChangesLogDisablesJumpAndRemovesMark'] = True

    # Clearing history has its own confirmation, and leaves the transcript.
    page.locator('#director_fate_clear_log').click()
    confirmation = page.locator('dialog[open]').filter(has_text='清空本局命运日志？')
    confirmation.wait_for(state='visible')
    confirmation.locator('.popup-button-cancel').click()
    assert len(fate()['log']) == 1
    page.locator('#director_fate_clear_log').click()
    confirmation.locator('.popup-button-ok').click()
    page.wait_for_function("() => (SillyTavern.getContext().chatMetadata.director.fate.log ?? []).length === 0 && document.querySelectorAll('.director_fate_log_entry').length === 0")
    assert page.locator('.director_fate_log_entry').count() == 0
    assert page.locator('#director_fate_tab_log').inner_text() == '本局命运（0）'
    assert page.evaluate('SillyTavern.getContext().chat.length') == 1999
    result['checks']['fateLogClearConfirmsAndKeepsChatMessages'] = True
    close_panel()

    # A short native fixture keeps one valid mark while its last target is
    # deleted. This distinguishes missing from a shifted/changed anchor, then
    # proves clearing a log also removes a still-valid loaded message mark.
    short_entries = page.evaluate("""async ({sample, template, suffix}) => {
        const c = SillyTavern.getContext();
        const { messageFingerprint } = await import('/scripts/extensions/director/instruct.js');
        const file = 'FateLogMissing-' + suffix;
        const rows = [
            { name: 'Synthetic Tester', is_user: true, is_system: false, mes: 'A short Fate history.', extra: {} },
            { name: 'Director Synthetic', is_user: false, is_system: false, mes: 'A surviving Fate target.', extra: {} },
            { name: 'Director Synthetic', is_user: false, is_system: false, mes: 'A removed Fate target.', extra: {} },
        ];
        const entries = [2, 1].map(slotIndex => ({ ...template, id: 'fate-target-' + slotIndex + '-' + suffix,
            slotIndex, prevFingerprint: messageFingerprint(rows[slotIndex - 1]), generationId: null, replays: 0 }));
        const metadata = { integrity: file, director: { fate: { version: 1, log: entries } } };
        const response = await fetch('/api/chats/save', { method: 'POST', headers: c.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: sample.avatar, file_name: file, chat: [
                { user_name: 'Synthetic Tester', character_name: 'Director Synthetic', chat_metadata: metadata },
                ...rows,
            ] }) });
        if (!response.ok) throw new Error('Fate missing-target fixture failed');
        if (await c.openCharacterChat(file) === false) throw new Error('Fate missing-target chat did not open');
        return entries;
    }""", {'sample':sample, 'template':old_entry, 'suffix':uuid.uuid4().hex[:10]})
    page.wait_for_function('SillyTavern.getContext().chat.length === 3')
    for logged in short_entries:
        assert_mark(logged, logged['slotIndex'])
    page.evaluate('async () => { await window.__fateLabMain.deleteLastMessage(); }')
    page.wait_for_function("SillyTavern.getContext().chat.length === 2 && document.querySelectorAll('#chat .director_fate_mark').length === 1")
    missing, surviving = short_entries
    assert_mark(surviving, surviving['slotIndex'])
    assert mark(missing['slotIndex']).count() == 0
    open_panel()
    tab('log')
    assert log_entry(missing).locator('.director_fate_log_status').inner_text() == '消息已删除'
    assert log_entry(missing).locator('.director_fate_log_jump').is_disabled()
    assert log_entry(surviving).locator('.director_fate_log_status').count() == 0
    assert log_entry(surviving).locator('.director_fate_log_jump').is_enabled()
    hidden(missing['event'])
    result['checks']['fateDeletingTargetShowsMissingKeepsEntryAndDisablesJump'] = True
    page.locator('#director_fate_clear_log').click()
    confirmation = page.locator('dialog[open]').filter(has_text='清空本局命运日志？')
    confirmation.locator('.popup-button-cancel').click()
    assert len(fate()['log']) == 2
    assert_mark(surviving, surviving['slotIndex'])
    page.locator('#director_fate_clear_log').click()
    confirmation.locator('.popup-button-ok').click()
    page.wait_for_function("() => (SillyTavern.getContext().chatMetadata.director.fate.log ?? []).length === 0 && document.querySelectorAll('#chat .director_fate_mark').length === 0")
    assert page.evaluate('SillyTavern.getContext().chat.length') == 2
    close_panel()
    idle()
    page.evaluate('async () => { await SillyTavern.getContext().reloadCurrentChat(); }')
    assert not fate().get('log')
    assert page.locator('#chat .director_fate_mark').count() == 0
    result['checks']['fateClearLogImmediatelyRemovesValidMarksAndPersistsAfterReload'] = True
    print('Fate sealed draw, adoption, replay, failure/stop, groups, reveal ritual, history and message mark checks passed', flush=True)
