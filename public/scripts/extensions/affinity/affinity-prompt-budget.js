/** Independent sidecar output allowance, capped and scaled to model context. */
export function affinityOutputTokenLimit(contextTokens) {
    if (!Number.isFinite(contextTokens) || contextTokens <= 0) throw new RangeError('Invalid relationship model context');
    return Math.min(2048, Math.max(128, Math.floor(contextTokens / 4)));
}

/** Fit a sidecar's evidence view without changing the chat or stored ledger. */
export async function fitAffinityPrompt(render, { refs, state }, { maxTokens, countTokens, signal, getIdentity } = {}) {
    const assertConfiguration = configurationGuard(getIdentity);
    const limit = () => {
        signal?.throwIfAborted();
        assertConfiguration();
        const value = Math.floor(typeof maxTokens === 'function' ? maxTokens() : maxTokens);
        if (!Number.isFinite(value) || value <= 0) throw new RangeError('Invalid relationship prompt budget');
        return value;
    };
    const measure = async (evidence, memory) => {
        signal?.throwIfAborted();
        assertConfiguration();
        const prompt = render(evidence, memory);
        const tokens = await abortable(() => countTokens(prompt), signal);
        signal?.throwIfAborted();
        assertConfiguration();
        if (!Number.isFinite(tokens) || tokens < 0 || (prompt && tokens === 0)) throw new RangeError('Invalid relationship token count');
        return { prompt, tokens };
    };
    let selected = [...refs];
    let memory = { ...state, events: [...state.events], archives: [...state.archives] };
    let measured = await measure(selected, memory);
    if (measured.tokens <= limit()) return { prompt: measured.prompt, refs: selected };

    // Prefer unresolved anchors in the request view. Removing context here does
    // not retire or resolve anything in the persisted relationship history.
    const all = [...memory.archives, ...memory.events];
    const resolved = new Set(all.filter(event => event.kind === 'outcome'
        && event.status === 'completed' && event.outcomeKnown === true && event.confidence === 'high').map(event => event.anchorId));
    const priority = [...all.filter(event => event.kind === 'promise' && !resolved.has(event.id)),
        ...all.filter(event => event.kind !== 'promise' || resolved.has(event.id)).reverse()];
    let retained = priority.length;
    const empty = evidence => evidence.map(ref => ({ ...ref, text: '' }));
    let base = await measure(empty(selected), memory);
    while (base.tokens >= limit() && retained > 0) {
        retained = Math.floor(retained / 2);
        memory = { ...state, events: priority.slice(0, retained), archives: [] };
        base = await measure(empty(selected), memory);
    }
    // New receipts are the actual batch, not a latest-only queue. Only optional
    // old context may be omitted when even its empty reference labels do not fit.
    const required = new Set(selected.filter(ref => ref.receipt > state.cursor).map(ref => ref.slot));
    let optional = selected.filter(ref => !required.has(ref.slot));
    while (base.tokens >= limit() && optional.length) {
        optional = optional.slice(0, Math.floor(optional.length / 2));
        const keep = new Set([...required, ...optional.map(ref => ref.slot)]);
        selected = refs.filter(ref => keep.has(ref.slot));
        base = await measure(empty(selected), memory);
    }
    if (!selected.length || base.tokens >= limit()) throw new RangeError('Relationship evidence headers exceed the prompt budget');

    // Check every candidate with the active tokenizer. Character count is only
    // the search coordinate and is never accepted as a token estimate.
    let lower = 1;
    let upper = Math.max(...selected.map(ref => ref.text.length));
    let best = null;
    while (lower <= upper) {
        const size = Math.floor((lower + upper) / 2);
        const shown = selected.map(ref => ({ ...ref, text: excerpt(ref.text, size) }));
        measured = await measure(shown, memory);
        if (measured.tokens <= limit()) {
            best = { prompt: measured.prompt, refs: selected, tokens: measured.tokens };
            lower = size + 1;
        } else upper = size - 1;
    }
    if (!best || best.tokens > limit()) throw new RangeError('Relationship evidence does not fit the prompt budget');
    return { prompt: best.prompt, refs: best.refs };
}

/** Split major checks without truncating their quoted evidence or merging calls. */
export async function fitAffinityVerificationPrompts(render, candidates, { maxTokens, countTokens, signal, getIdentity } = {}) {
    const assertConfiguration = configurationGuard(getIdentity);
    const queued = [];
    let pending = [];
    const limit = () => {
        signal?.throwIfAborted();
        assertConfiguration();
        const budget = typeof maxTokens === 'function' ? maxTokens() : maxTokens;
        if (!Number.isFinite(budget) || budget <= 0) throw new RangeError('Invalid relationship verification budget');
        return budget;
    };
    const measure = async text => {
        signal?.throwIfAborted();
        assertConfiguration();
        const tokens = await abortable(() => countTokens(text), signal);
        signal?.throwIfAborted();
        if (!Number.isFinite(tokens) || tokens <= 0) throw new RangeError('Invalid relationship verification token count');
        return { text, tokens, fits: tokens <= limit() };
    };
    const fits = values => measure(render(values));
    for (const candidate of candidates) {
        const combined = await fits([...pending, candidate]);
        if (combined.fits) { pending.push(candidate); continue; }
        if (pending.length) queued.push(pending);
        pending = [];
        const single = await fits([candidate]);
        if (single.fits) pending = [candidate];
        // A candidate that cannot fit even alone remains unverified at zero.
    }
    if (pending.length) queued.push(pending);

    const batches = [];
    const add = (values, measured) => batches.push({
        candidates: values, prompt: measured.text, tokens: measured.tokens,
        // A previous verifier call may have awaited I/O while settings changed.
        // Recount the actual next prompt with the live tokenizer at dispatch.
        validate: async () => (await measure(measured.text)).fits,
    });
    for (const values of queued) {
        const measured = await fits(values);
        if (measured.fits) add(values, measured);
        else if (values.length > 1) {
            for (const candidate of values) {
                const single = await fits([candidate]);
                if (single.fits) add([candidate], single);
            }
        }
    }
    // Tokenization of a later group can lower the budget for earlier groups.
    // Never return an already known oversized prompt; callers recheck at send.
    return batches.filter(batch => batch.tokens <= limit()).map(({ tokens: _tokens, ...batch }) => batch);
}

function configurationGuard(getIdentity) {
    const identity = getIdentity?.();
    return () => {
        if (getIdentity && getIdentity() !== identity) throw new RangeError('Relationship model configuration changed during tokenization');
    };
}

async function abortable(run, signal) {
    if (!signal) return run();
    signal.throwIfAborted();
    let cancel;
    const aborted = new Promise((_, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
    });
    const work = Promise.resolve().then(() => { signal.throwIfAborted(); return run(); });
    try { return await Promise.race([work, aborted]); }
    finally { signal.removeEventListener('abort', cancel); }
}

function excerpt(text, maximum) {
    if (text.length <= maximum) return text;
    const headLength = Math.max(1, Math.floor(maximum * 0.8));
    const tailLength = maximum - headLength;
    const head = text.slice(0, headLength).replace(/[\uD800-\uDBFF]$/u, '');
    const tail = tailLength ? text.slice(-tailLength).replace(/^[\uDC00-\uDFFF]/u, '') : '';
    return head + (tail ? '\n[…]\n' + tail : '');
}
