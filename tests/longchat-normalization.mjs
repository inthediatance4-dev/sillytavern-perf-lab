// Input is a plain DOM tree so this also runs in browser-free Node tests.
export function normalizeSnapshot(node) {
    const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    if (typeof node === 'string') return escape(node);
    if (node.comment !== undefined) return `<!--${node.comment}-->`;
    const randomId = /^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|select2-.*-\w{4})$/i;
    const attributes = node.attributes.filter(([name, value]) => {
        if (['timer', 'timestamp', 'data-timestamp', 'data-generation-started', 'data-generation-finished'].includes(name)) return false;
        if (['id', 'for', 'aria-describedby', 'aria-labelledby'].includes(name) && randomId.test(value)) return false;
        return true;
    }).map(([name, value]) => [name, value]);
    // Message dates and generation timing tooltips have locale/clock-dependent text.
    const timestamp = attributes.some(([name, value]) => name === 'class' && value.split(/\s+/).some(x => ['timestamp', 'mes_timer'].includes(x)));
    if (timestamp) {
        for (const attr of attributes) if (attr[0] === 'title') attr[1] = '<timestamp>';
    }
    const attrs = attributes.sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ` ${name}="${escape(value)}"`).join('');
    const voidTag = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(node.tag);
    return `<${node.tag}${attrs}>` + (voidTag ? '' : (timestamp ? '&lt;timestamp>' : node.children.map(normalizeSnapshot).join('')) + `</${node.tag}>`);
}
