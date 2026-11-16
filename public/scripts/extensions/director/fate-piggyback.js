import { CATEGORIES, RARITIES } from './fate-decks.js';

/** Piggyback mode appends one private JSON block to a normal story reply, so a
 * round of fate costs one provider call instead of two. The block is stripped
 * before the reply is saved or left visible. */
export const PIGGYBACK_MARKER = '[[DIRECTOR_FATE_OFFER]]';
// Pregenerated events are written at this strength; a pick at another strength
// falls back to its own quiet draw so the event always matches the choice.
export const PIGGYBACK_STRENGTH = 'medium';
const MAX_BLOCK_LENGTH = 16000;
const MAX_EVENT_LENGTH = 400;
const STRENGTH_LINE = 'a meaningful but manageable turn';
const categoryById = new Map(CATEGORIES.map(category => [category.id, category]));

const validEvent = value => typeof value === 'string' && value.trim().length > 0
    && Array.from(value).length <= MAX_EVENT_LENGTH && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);

/** cards: the locally rolled faces ({category,title,rarity}) the model must write events for. */
export function buildPiggybackInstruction(cards) {
    const lines = [
        '【系统附加任务，非角色扮演】完成上面的故事回复后，另起一行，先原样输出标记 ' + PIGGYBACK_MARKER + '，再紧跟一个JSON对象。',
        '该对象恰好含一个键 events：一个恰好3项的数组，按顺序为下面三张牌各写一个突发事件。每项恰好含 category、title、event 三个键，category 和 title 必须与对应牌完全一致。',
        'event 用故事语言简述一个具体的突发事件，最多400字，保持角色自主性和已有事实，不要续写剧情、不要写对话、不要给助手下指令。',
        'JSON之外不要输出任何解释。故事正文中不得提及此任务或标记。',
    ];
    cards.forEach((card, index) => {
        const category = categoryById.get(card.category);
        const parts = [`第${index + 1}张: category="${card.category}", title="${card.title}"。主题: ${category?.theme ?? card.category}。强度: ${STRENGTH_LINE}。`];
        const rarityLine = RARITIES[card.rarity]?.line;
        if (rarityLine) parts.push(rarityLine);
        lines.push(parts.join(' '));
    });
    return lines.join('\n');
}

/** Index of the marker that starts the appended block, or -1. */
export function piggybackBlockStart(text) {
    if (typeof text !== 'string') return -1;
    return text.indexOf(PIGGYBACK_MARKER);
}

/** Everything from the marker onward is private; the story keeps only the prefix. */
export function stripPiggyback(text) {
    const start = piggybackBlockStart(text);
    if (start < 0) return text;
    return text.slice(0, start).replace(/\s+$/, '');
}

function visitResponseText(value, replace, path = '', reasoning = false) {
    if (!value || typeof value !== 'object') return;
    reasoning ||= value.thought === true || value.type === 'thinking';
    if (Array.isArray(value)) {
        value.forEach((item, index) => visitResponseText(item, replace, (/\.(?:content|parts)$/.test(path) ? path : `${path}.${item?.index ?? index}`), reasoning));
        return;
    }
    for (const key of Object.keys(value)) {
        if (['tool_calls', 'function_call', 'logprobs', 'usage', 'inlineData', 'images'].includes(key)) continue;
        const thought = reasoning || /reasoning|thinking/.test(key);
        if (typeof value[key] === 'string' && ['content', 'text', 'output', 'token', 'completion', 'response', 'reasoning', 'reasoning_content', 'thinking', 'tool_plan'].includes(key)) {
            value[key] = replace(value[key], `${path}.${key}:${thought}`, thought, value, key);
        } else visitResponseText(value[key], replace, `${path}.${key}`, thought);
    }
}

export async function filterPiggybackResponse(response, capture, stream = response.headers.get('Content-Type')?.includes('text/event-stream')) {
    const headers = new Headers(response.headers);
    headers.delete('Content-Length');
    headers.delete('Content-Encoding');
    const options = { status: response.status, statusText: response.statusText, headers };
    const channels = new Map();
    let currentFrame = null;
    const finish = () => {
        for (const state of channels.values()) {
            if (state.private !== null && !state.reasoning) capture(state.private);
            else if (state.pending) state.restorePending();
        }
        channels.clear();
    };
    const replace = (text, channel, reasoning, owner, key) => {
        let state = channels.get(channel);
        if (!state) channels.set(channel, state = { pending: '', private: null, reasoning });
        if (state.private !== null) {
            state.private = (state.private + text).slice(0, MAX_BLOCK_LENGTH + 1);
            return '';
        }
        const combined = state.pending + text;
        const start = piggybackBlockStart(combined);
        if (start >= 0) {
            state.private = combined.slice(start, start + MAX_BLOCK_LENGTH + 1);
            state.pending = '';
            return combined.slice(0, start).trimEnd();
        }
        // Withhold only a possible marker prefix, never the rest of the story.
        let held = Math.min(PIGGYBACK_MARKER.length - 1, combined.length);
        while (held && !PIGGYBACK_MARKER.startsWith(combined.slice(-held))) held--;
        state.pending = held ? combined.slice(-held) : '';
        state.frame = currentFrame;
        state.restorePending = () => { owner[key] += state.pending; };
        return held ? combined.slice(0, -held) : combined;
    };
    if (!stream) {
        const data = await response.json();
        visitResponseText(data, replace);
        finish();
        return new Response(JSON.stringify(data), options);
    }
    let buffer = '';
    let queued = [];
    const drain = () => {
        const blocked = new Set([...channels.values()].filter(state => state.pending).map(state => state.frame));
        const ready = queued.filter(frame => !blocked.has(frame));
        queued = queued.filter(frame => blocked.has(frame));
        return ready.map(frame => frame.render()).join('');
    };
    const processFrame = frame => {
        const lines = frame.split(/\r?\n/);
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data === '[DONE]') { finish(); return drain() + frame + '\n\n'; }
        if (!data) queued.push({ render: () => frame + '\n\n' });
        else {
            const value = JSON.parse(data);
            currentFrame = {};
            visitResponseText(value, replace);
            // Hold a possible marker prefix until it either completes or becomes
            // ordinary text. Keep the original frame so EOF can restore it exactly.
            currentFrame.render = () => lines.filter(line => !line.startsWith('data:'))
                .concat('data: ' + JSON.stringify(value)).join('\n') + '\n\n';
            queued.push(currentFrame);
        }
        return drain();
    };
    const body = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream({
        transform(chunk, controller) {
            buffer += chunk;
            let separator;
            while ((separator = /\r?\n\r?\n/.exec(buffer))) {
                const output = processFrame(buffer.slice(0, separator.index));
                if (output) controller.enqueue(output);
                buffer = buffer.slice(separator.index + separator[0].length);
            }
        },
        flush(controller) {
            if (buffer.trim()) controller.enqueue(processFrame(buffer));
            finish();
            const output = drain();
            if (output) controller.enqueue(output);
        },
    })).pipeThrough(new TextEncoderStream());
    return new Response(body, options);
}

function firstObject(raw) {
    const start = raw.indexOf('{');
    if (start < 0) throw new Error();
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < raw.length; index++) {
        const character = raw[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') quoted = false;
        } else if (character === '"') quoted = true;
        else if (character === '{') depth++;
        else if (character === '}' && --depth === 0) return JSON.parse(raw.slice(start, index + 1));
    }
    throw new Error();
}

/**
 * Validate the appended block against the rolled faces. Returns three event
 * strings in card order, or null when the model deviated; callers then keep the
 * faces and fall back to the normal per-pick draw.
 */
export function parsePiggybackEvents(raw, cards) {
    if (typeof raw !== 'string' || !Array.isArray(cards) || cards.length !== 3) return null;
    const start = piggybackBlockStart(raw);
    if (start < 0) return null;
    // Budget only the private block; a long story prefix must not reject it.
    if (raw.length - start > MAX_BLOCK_LENGTH) return null;
    let value;
    try {
        value = firstObject(raw.slice(start + PIGGYBACK_MARKER.length));
    } catch {
        return null;
    }
    if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || !Array.isArray(value.events) || value.events.length !== 3) return null;
    const events = [];
    for (let index = 0; index < 3; index++) {
        const item = value.events[index];
        const card = cards[index];
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        if (Object.keys(item).length !== 3 || item.category !== card.category || item.title !== card.title || !validEvent(item.event)) return null;
        events.push(item.event.trim());
    }
    return events;
}