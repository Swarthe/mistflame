// @ts-check
//
// HTML to plain text, plus the ingest-side fragment strip.
//
// Plain ESM rather than TypeScript so that both the email receiver worker
// (via wrangler's esbuild) and scripts/backfill-html-bodies.mjs (via bare node)
// can import the same implementation. Live ingest and the one-off backfill must
// derive identical text for a given HTML body, otherwise migrated rows read
// differently from newly received ones.
//
// htmlToText output is only ever rendered as escaped text, never injected as
// HTML, so this is not a security boundary; sanitisation happens separately in
// src/lib/email-html.ts.

/** Elements dropped along with everything inside them. */
const DROP_WITH_CONTENT = 'script|style|head|title|noscript|template|svg';

/** Block-level elements that force a line break. */
const BLOCK = new Set([
    'address', 'article', 'aside', 'blockquote', 'center', 'div', 'dd', 'dl',
    'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
    'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p',
    'pre', 'section', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
]);

/** Elements that get a blank line around them rather than a single break. */
const PARAGRAPH = new Set(['p', 'div', 'table', 'blockquote', 'pre']);

/**
 * Prefix a quoted section with the "> " convention, collapsing the blank-line
 * runs the markup left behind first so the quote does not turn into a column of
 * bare ">" characters.
 * @param {string} inner
 * @returns {string}
 */
function quoteLines(inner) {
    const collapsed = inner
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!collapsed) return '';
    return collapsed.split('\n').map(l => `> ${l}`.trimEnd()).join('\n');
}

const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ensp: ' ', emsp: ' ', thinsp: ' ', shy: '', zwnj: '', zwj: '',
    ndash: '–', mdash: '—', hellip: '…', middot: '·',
    bull: '•', lsquo: '‘', rsquo: '’', sbquo: '‚',
    ldquo: '“', rdquo: '”', bdquo: '„', dagger: '†',
    prime: '′', laquo: '«', raquo: '»', copy: '©',
    reg: '®', trade: '™', deg: '°', plusmn: '±',
    frac12: '½', times: '×', divide: '÷', euro: '€',
    pound: '£', yen: '¥', cent: '¢', sect: '§',
    para: '¶', dollar: '$', aelig: 'æ', oslash: 'ø',
    aring: 'å', AElig: 'Æ', Oslash: 'Ø', Aring: 'Å',
};

/**
 * Decode the HTML entities that turn up in real mail. Unknown named entities
 * are left as written rather than mangled.
 * @param {string} s
 * @returns {string}
 */
export function decodeEntities(s) {
    return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
        (whole, name) => {
            if (name[0] === '#') {
                const code = name[1] === 'x' || name[1] === 'X'
                    ? parseInt(name.slice(2), 16)
                    : parseInt(name.slice(1), 10);
                if (!isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
                try {
                    return String.fromCodePoint(code);
                } catch {
                    return whole;
                }
            }
            const hit = /** @type {Record<string, string>} */ (ENTITIES)[name];
            return hit !== undefined ? hit : whole;
        });
}

/**
 * Strip the document wrapper so what remains can be nested inside another
 * document: doctype, comments, <html>/<body> tags, and anything whose content
 * must not survive (<script>, <head>, ...). <style> blocks are moved inline and
 * kept, so a future CSS-scoping render can use them; the current renderer drops
 * them at sanitisation time.
 * @param {string | null | undefined} html
 * @returns {string | null} the fragment, or null if nothing usable remains
 */
export function htmlToFragment(html) {
    if (!html) return null;
    let s = String(html).replace(/\r\n/g, '\n');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<!DOCTYPE[^>]*>/gi, '');
    s = s.replace(/<\?xml[^>]*\?>/gi, '');
    // Pull <style> out of <head> before the head is discarded.
    /** @type {string[]} */
    const styles = [];
    s = s.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_whole, css) => {
        styles.push(String(css));
        return '';
    });
    s = s.replace(
        new RegExp(`<(${DROP_WITH_CONTENT})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, 'gi'),
        '');
    // An unclosed script or head would otherwise leak its source as text.
    s = s.replace(new RegExp(`<(${DROP_WITH_CONTENT})\\b[\\s\\S]*$`, 'i'), '');
    s = s.replace(/<\/?(?:html|body)\b[^>]*>/gi, '');
    s = s.replace(/<(?:meta|link|base)\b[^>]*>/gi, '');
    s = s.trim();
    if (!s) return null;
    const css = styles.join('\n').trim();
    return css ? `<style>${css}</style>\n${s}` : s;
}

/**
 * Render HTML as readable plain text. Quoted sections keep the "> " convention
 * used by the plain-text path, so splitQuote in page.tsx can still collapse
 * them when only the text rendition is shown.
 * @param {string | null | undefined} html
 * @returns {string}
 */
export function htmlToText(html) {
    if (!html) return '';
    let s = String(html).replace(/\r\n/g, '\n');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(
        new RegExp(`<(${DROP_WITH_CONTENT})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, 'gi'),
        '');
    s = s.replace(new RegExp(`<(${DROP_WITH_CONTENT})\\b[\\s\\S]*$`, 'i'), '');
    // The tag walker below only recognises <name ...>, so declarations and
    // Outlook's conditional markers would otherwise survive as body text.
    s = s.replace(/<![^>]*>/g, '');
    s = s.replace(/<\?[\s\S]*?\?>/g, '');

    /** @type {string[]} */
    const out = [];
    /** @type {number[]} */
    const quoteStack = [];
    /** @type {{ href: string, at: number }[]} */
    const linkStack = [];
    let preDepth = 0;
    let sawPre = false;

    const tagRe = /<(\/?)([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/g;
    let last = 0;
    let m;

    const pushText = (/** @type {string} */ raw) => {
        if (!raw) return;
        let text = decodeEntities(raw);
        if (preDepth === 0) text = text.replace(/\s+/g, ' ');
        if (text) out.push(text);
    };

    while ((m = tagRe.exec(s)) !== null) {
        pushText(s.slice(last, m.index));
        last = m.index + m[0].length;

        const closing = m[1] === '/';
        const tag = m[2].toLowerCase();
        const attrs = m[3] ?? '';

        if (tag === 'br') {
            out.push('\n');
            continue;
        }
        if (tag === 'hr') {
            out.push('\n---\n');
            continue;
        }
        if (tag === 'img' && !closing) {
            const alt = /\balt\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
            const label = alt ? (alt[2] ?? alt[3] ?? alt[4] ?? '') : '';
            if (label.trim()) out.push(`[${decodeEntities(label).trim()}]`);
            continue;
        }
        if (tag === 'pre') {
            preDepth += closing ? -1 : 1;
            if (preDepth < 0) preDepth = 0;
            sawPre = true;
        }
        if (tag === 'li') {
            // The next item's opening tag supplies the break, so closing one
            // must not add a second and space the list out.
            if (!closing) out.push('\n- ');
            continue;
        }
        if (tag === 'td' || tag === 'th') {
            if (closing) out.push(' ');
            continue;
        }
        if (tag === 'a') {
            if (closing) {
                const open = linkStack.pop();
                if (open) {
                    const text = out.slice(open.at).join('').trim();
                    const url = decodeEntities(open.href).trim();
                    const bare = url.replace(/^mailto:/i, '');
                    if (url && text && text !== url && text !== bare
                        && !text.includes(bare)) {
                        out.push(` <${url}>`);
                    } else if (url && !text) {
                        out.push(bare);
                    }
                }
            } else {
                const href =
                    /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
                const url = href ? (href[2] ?? href[3] ?? href[4] ?? '') : '';
                linkStack.push({
                    href: /^(https?:|mailto:)/i.test(url.trim()) ? url : '',
                    at: out.length,
                });
            }
            continue;
        }
        if (tag === 'blockquote') {
            if (closing) {
                const start = quoteStack.pop();
                if (start !== undefined) {
                    const quoted = quoteLines(out.splice(start).join(''));
                    out.push(`\n${quoted}\n`);
                }
            } else {
                out.push('\n');
                quoteStack.push(out.length);
            }
            continue;
        }
        if (BLOCK.has(tag)) {
            out.push(PARAGRAPH.has(tag) ? '\n\n' : '\n');
        }
    }
    pushText(s.slice(last));

    // Any blockquote left open at end of input still needs its prefix.
    while (quoteStack.length > 0) {
        const start = /** @type {number} */ (quoteStack.pop());
        const quoted = quoteLines(out.splice(start).join(''));
        if (quoted) out.push(`\n${quoted}`);
    }

    let text = out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    // Indentation only carries meaning inside <pre>; elsewhere it is layout
    // whitespace left over from the markup.
    if (!sawPre) text = text.replace(/^[ \t]+/gm, '');
    return text.trim();
}
