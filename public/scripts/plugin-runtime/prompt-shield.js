const FRAME = /\uE040(stprivate[1-9]\d*x[a-zA-Z0-9-]+)\uE041[\s\S]*?\uE042\1\uE043/g;
function visit(value, replace, seen = new WeakSet()) {
    if (typeof value === 'string') return replace(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const key of Object.keys(value)) value[key] = visit(value[key], replace, seen);
    return value;
}

/** Opaque reservations keep private events out of native WI scans. Padding is
 * measured with the active tokenizer, rather than using a short underbudget token. */
export function createPromptShield({ uuid, count }) {
    const frames = new Map();
    let serial = 0;
    async function seal(requestChat) {
        for (let index = 0; index < requestChat.length; index++) {
            const message = requestChat[index];
            if ((!message.extra?.directorFatePrompt && !message.extra?.affinityPrompt) || typeof message.mes !== 'string') continue;
            if (frames.has(message.mes)) continue;
            const raw = message.mes;
            const tag = `stprivate${++serial}x${uuid().replace(/[^a-zA-Z0-9-]/g, '')}`;
            const frame = length => `\uE040${tag}\uE041${'\uE044'.repeat(length)}\uE042${tag}\uE043`;
            const measured = await count(raw);
            if (!Number.isFinite(measured) || measured <= 0) throw new Error('Private prompt tokenizer unavailable.');
            const required = measured + 8;
            let low = 0;
            let high = Math.max(1, Math.ceil(required));
            while (await count(frame(high)) < required) {
                high *= 2;
                if (high > 65536) throw new Error('Private prompt reservation too large.');
            }
            while (low < high) {
                const middle = Math.floor((low + high) / 2);
                if (await count(frame(middle)) >= required) high = middle;
                else low = middle + 1;
            }
            const reserved = frame(high);
            if (await count(reserved) < required) throw new Error('Private prompt reservation failed.');
            frames.set(reserved, raw);
            requestChat[index] = { ...message, mes: reserved };
            if (frames.size > 128) frames.delete(frames.keys().next().value);
        }
    }
    return { seal, restore(data) {
        const used = new Set();
        visit(data, value => value.replace(FRAME, frame => {
            const raw = frames.get(frame) ?? '';
            used.add(frame);
            return raw;
        }));
        for (const frame of used) frames.delete(frame);
    } };
}
