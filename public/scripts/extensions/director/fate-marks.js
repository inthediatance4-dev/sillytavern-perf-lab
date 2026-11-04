/**
 * Paint only loaded message headers. The controller validates at most 50 log
 * anchors; the cached slot map keeps ordinary message renders independent of
 * chat length and never reads or changes a message body.
 * getEntries(slotIndex) limits status checks to one slot; getEntries() reads the full log.
 */

// Wordless emblems. Emoji wax-seals render differently on each phone, so the
// chat mark and the log timeline share these SVG silhouettes: round ink seal,
// faceted gem, star-crowned seal. The full rarity name stays in the tooltip.
const SVG_NS = 'http://www.w3.org/2000/svg';
const rarityMarks = {
    common: { silhouette: 'seal', name: '寻常' },
    rare: { silhouette: 'gem', name: '稀有' },
    legendary: { silhouette: 'crown', name: '传说' },
};

function assignAttrs(node, attrs) {
    for (const [key, value] of Object.entries(attrs)) {
        node.setAttribute(key, String(value));
        if (key === 'class') {
            for (const name of String(value).split(/\s+/)) if (name) node.classList.add(name);
        } else if (key.startsWith('data-')) {
            const prop = key.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
            node.dataset[prop] = String(value);
        }
    }
    return node;
}

function element(tag, attrs) {
    return assignAttrs(document.createElement(tag), attrs);
}

function svgElement(tag, attrs) {
    return assignAttrs(document.createElementNS(SVG_NS, tag), attrs);
}

function part(tag, partName, geometry, paint, attrs) {
    return svgElement(tag, {
        ...attrs,
        class: `director_fate_emblem_part ${paint}`,
        'data-part': partName,
        'data-geometry': geometry,
    });
}

function geometryOf(points) {
    return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

// Upward five-point star, bounding box centered in the 32 viewBox. The seal
// sits on the star's own center so the top point reads as a crown.
function crownPoints() {
    const outer = 13.4;
    const inner = 5.7;
    const cx = 16;
    const cy = 16 + outer * 0.0955;
    const points = [];
    for (let step = 0; step < 10; step++) {
        const radius = step % 2 === 0 ? outer : inner;
        const angle = -Math.PI / 2 + step * Math.PI / 5;
        points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
    return points;
}

function appendSeal(svg) {
    const nib = 'M16 9.4C19.6 9.4 21.1 13.6 21.1 16.6C21.1 20.2 16 23.8 16 23.8C16 23.8 10.9 20.2 10.9 16.6C10.9 13.6 12.4 9.4 16 9.4Z';
    svg.append(
        part('circle', 'disc', 'circle:16,16,13.1', 'director_fate_emblem_plate', { cx: '16', cy: '16', r: '13.1' }),
        svgElement('circle', { class: 'director_fate_emblem_gloss', cx: '12.3', cy: '12.2', r: '4.4' }),
        svgElement('circle', { class: 'director_fate_emblem_edge', cx: '16', cy: '16', r: '13.1', 'stroke-width': '1.5' }),
        svgElement('circle', { class: 'director_fate_emblem_edge', cx: '16', cy: '16', r: '8.7', 'stroke-width': '0.9' }),
        part('path', 'nib', nib, 'director_fate_emblem_cut', { d: nib }),
        svgElement('path', { class: 'director_fate_emblem_wax', d: 'M15.15 13.1H16.85V20.4H15.15Z' }),
    );
}

function appendGem(svg) {
    const gem = geometryOf([[16, 1.8], [30.3, 16], [16, 30.2], [1.7, 16]]);
    const facet = geometryOf([[16, 1.8], [16, 16], [1.7, 16]]);
    svg.append(
        svgElement('polygon', { class: 'director_fate_emblem_rim', points: gem, 'stroke-width': '2.4' }),
        part('polygon', 'gem', gem, 'director_fate_emblem_plate', { points: gem }),
        part('polygon', 'facet', facet, 'director_fate_emblem_facet', { points: facet }),
        svgElement('polygon', { class: 'director_fate_emblem_facet_soft', points: geometryOf([[16, 1.8], [30.3, 16], [16, 16]]) }),
        svgElement('polygon', { class: 'director_fate_emblem_shade', points: geometryOf([[1.7, 16], [16, 16], [16, 30.2]]) }),
        svgElement('polygon', { class: 'director_fate_emblem_shade', points: geometryOf([[16, 16], [30.3, 16], [16, 30.2]]), opacity: '0.72' }),
        svgElement('polygon', { class: 'director_fate_emblem_edge', points: geometryOf([[16, 8.6], [22.6, 16], [16, 23.4], [9.4, 16]]), 'stroke-width': '0.9' }),
        svgElement('polygon', { class: 'director_fate_emblem_cut', points: geometryOf([[16, 13.2], [18.4, 16], [16, 18.8], [13.6, 16]]) }),
        svgElement('polygon', { class: 'director_fate_emblem_edge', points: gem, 'stroke-width': '1.15' }),
    );
}

function appendCrown(svg) {
    const points = crownPoints();
    const crown = geometryOf(points);
    const [cx, cy] = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map(value => value / points.length);
    svg.append(
        svgElement('polygon', { class: 'director_fate_emblem_rim', points: crown, 'stroke-width': '3.2' }),
        part('polygon', 'crown', crown, 'director_fate_emblem_plate', { points: crown }),
        svgElement('polygon', { class: 'director_fate_emblem_edge', points: crown, 'stroke-width': '0.9' }),
        part('circle', 'seal', `circle:${cx.toFixed(2)},${cy.toFixed(2)},4.3`, 'director_fate_emblem_wax', { cx: cx.toFixed(2), cy: cy.toFixed(2), r: '4.3' }),
        svgElement('circle', { class: 'director_fate_emblem_edge', cx: cx.toFixed(2), cy: cy.toFixed(2), r: '3.05', 'stroke-width': '0.7' }),
        svgElement('circle', { class: 'director_fate_emblem_cut', cx: cx.toFixed(2), cy: cy.toFixed(2), r: '1.15' }),
    );
    return crown;
}

/**
 * Inline SVG emblem for one rarity. Shared by the chat header and the log rail.
 * @param {string} rarity
 * @returns {HTMLElement}
 */
export function createFateEmblem(rarity) {
    const face = rarityMarks[rarity] ?? rarityMarks.common;
    const emblem = element('span', {
        class: 'director_fate_mark_emblem',
        'data-silhouette': face.silhouette,
        'aria-hidden': 'true',
    });
    const svg = svgElement('svg', {
        class: 'director_fate_mark_glyph',
        viewBox: '0 0 32 32',
        'aria-hidden': 'true',
        focusable: 'false',
    });
    let crown = null;
    if (face.silhouette === 'gem') appendGem(svg);
    else if (face.silhouette === 'crown') crown = appendCrown(svg);
    else appendSeal(svg);
    emblem.append(svg);
    if (crown) {
        const sheen = element('span', { class: 'director_fate_mark_sheen', 'aria-hidden': 'true' });
        const clip = crown.split(' ').map(pair => {
            const [x, y] = pair.split(',').map(Number);
            return `${(x / 32 * 100).toFixed(2)}% ${(y / 32 * 100).toFixed(2)}%`;
        }).join(',');
        sheen.setAttribute('style', `clip-path:polygon(${clip})`);
        emblem.append(sheen);
    }
    return emblem;
}

function paintFace(mark, entry) {
    const face = rarityMarks[entry.rarity] ?? rarityMarks.common;
    let emblem = mark.querySelector('.director_fate_mark_emblem');
    if (emblem?.dataset.silhouette !== face.silhouette) {
        emblem?.remove();
        mark.querySelector('.director_fate_mark_shape')?.remove();
        mark.querySelector('.director_fate_mark_label')?.remove();
        emblem = createFateEmblem(entry.rarity);
        mark.append(emblem);
    }
    mark.dataset.rarity = entry.rarity;
    const caption = `命运牌：〈${entry.title}〉，${face.name}`;
    mark.setAttribute('aria-label', caption);
    mark.setAttribute('title', caption);
}

export function createFateMarks({ getContext, getEntries, onOpen }) {
    let dirty = true;
    let metadata;
    let chatId;
    let slots = new Map();
    const checkedSlots = new Set();
    const entryIds = new WeakMap();
    const pulsed = new Set();

    function invalidate() {
        dirty = true;
        slots.clear();
        checkedSlots.clear();
    }

    function entriesBySlot(index) {
        const context = getContext();
        if (metadata !== context.chatMetadata || chatId !== context.chatId) {
            metadata = context.chatMetadata;
            chatId = context.chatId;
            invalidate();
            pulsed.clear();
        }
        if (dirty) {
            if (index !== undefined && checkedSlots.has(index)) return slots;
            if (index === undefined) slots = new Map();
            for (const entry of getEntries(index)) {
                // Logs are newest first. If replays share a slot, its newest
                // surviving fate owns the single header mark.
                if ((index === undefined || entry.slotIndex === index) && entry.status === 'ok'
                    && !slots.has(entry.slotIndex)) slots.set(entry.slotIndex, entry);
            }
            if (index === undefined) {
                dirty = false;
                checkedSlots.clear();
            } else checkedSlots.add(index);
        }
        return slots;
    }

    // after-hours.css sets animation and transition to none under body.reduced-motion
    // and prefers-reduced-motion. Those rules do not emit animationend, so the
    // fresh class must be omitted or removed without waiting for that event.
    function motionReduced(mark) {
        if (document.body?.classList.contains('reduced-motion') || mark.closest('.director_fate_nomotion')) return true;
        if (typeof globalThis.matchMedia !== 'function') return false;
        return Boolean(globalThis.matchMedia('(prefers-reduced-motion: reduce)')?.matches);
    }

    function paintOne(mesId) {
        const index = Number(mesId);
        if (!Number.isInteger(index) || index < 0) return null;
        const entry = entriesBySlot(index).get(index);
        const mes = document.querySelector(`#chat .mes[mesid="${index}"]`);
        const header = mes?.querySelector('.ch_name');
        if (!header || header.closest('.mes_text')) return null;
        let mark = header.querySelector('.director_fate_mark');
        if (!entry) {
            mark?.remove();
            return null;
        }
        const name = header.querySelector('.name_text');
        if (!name) return null;
        if (!mark) {
            mark = document.createElement('button');
            mark.type = 'button';
            mark.className = 'director_fate_mark';
            mark.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                onOpen(entryIds.get(mark));
            });
            const finishPulse = event => {
                if (event.target === mark) mark.classList.remove('is_fresh');
            };
            mark.addEventListener('animationend', finishPulse);
            mark.addEventListener('animationcancel', finishPulse);
            name.after(mark);
        }
        entryIds.set(mark, entry.id);
        paintFace(mark, entry);
        if (motionReduced(mark)) mark.classList.remove('is_fresh');
        return mark;
    }

    function paintAll() {
        const entries = entriesBySlot();
        // Limit removal to headers too: a similarly named element in formatted
        // message content must never make this painter change .mes_text.
        for (const mark of document.querySelectorAll('#chat .ch_name .director_fate_mark')) {
            if (mark.closest('.mes_text')) continue;
            const index = Number(mark.closest('.mes')?.getAttribute('mesid'));
            if (!entries.has(index)) mark.remove();
        }
        for (const index of entries.keys()) paintOne(index);
    }

    function pulse(entryId) {
        const entries = entriesBySlot();
        if (pulsed.has(entryId)) return;
        const entry = [...entries.values()].find(value => value.id === entryId);
        if (!entry) return;
        const mark = paintOne(entry.slotIndex);
        if (!mark) return;
        pulsed.add(entryId);
        if (motionReduced(mark)) return;
        mark.classList.add('is_fresh');
    }

    return { paintOne, paintAll, invalidate, pulse };
}
