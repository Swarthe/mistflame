// Sanitisation and rewriting for inbound HTML email bodies.
//
// Client-only: it needs a DOM to parse and rewrite. page.tsx loads DOMPurify
// with a dynamic import inside an effect, so nothing here runs during the
// prerender of that 'use client' page.
//
// This IS the security boundary for HTML bodies. The output goes straight into
// dangerouslySetInnerHTML, so every change here needs weighing against that.

import type { DOMPurify, Config } from 'dompurify';

/**
 * src/env.d.ts pulls in @cloudflare/workers-types, whose HTMLRewriter `Element`
 * merges with the DOM one and wins on `append`. That breaks assignability to the
 * DOM's ParentNode and ChildNode, so this module avoids both and works in terms
 * of concrete container types instead.
 */
type Container = DocumentFragment | HTMLElement;

export interface CidAttachment {
    id: number;
    content_id: string | null;
    inline: number;
}

export interface SanitiseOptions {
    contactId: number;
    emailId: number;
    attachments: CidAttachment[];
    /** When false, remote images are replaced by placeholders. */
    loadImages: boolean;
}

export interface SanitisedEmail {
    /** The message itself. */
    main: string;
    /** Trailing quoted history, or null when the email has none. */
    quote: string | null;
    /** Remote images withheld in the message body. */
    blockedImages: number;
    /**
     * Remote images withheld inside the quoted history. Counted separately
     * because the quote is only in the document while it is expanded, and the
     * "Load images" button should not offer to load what is not on screen.
     */
    blockedImagesInQuote: number;
}

/** 1x1 transparent GIF; the CSP already permits data: images. */
const PLACEHOLDER_SRC = 'data:image/gif;base64,'
    + 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * <style> is kept, along with class and id: the output is rendered inside an
 * isolated iframe (see buildEmailDocument), so a rule like `body { display: none }`
 * can only affect the email's own document, and the email's selectors need its
 * class and id attributes to match anything.
 *
 * `base` stays forbidden because the document sets its own `<base target>`, and
 * `link` because a stylesheet reference is a remote fetch we do not want.
 */
const SANITISE_CONFIG: Config = {
    FORBID_TAGS: [
        'link', 'base', 'meta', 'title', 'form', 'input', 'button',
        'select', 'textarea', 'iframe', 'object', 'embed', 'svg', 'math',
    ],
    FORBID_ATTR: ['srcset', 'ping', 'formaction', 'background'],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
};

/**
 * Styles for the frame document itself. Short by design: inside the iframe the
 * browser's own defaults apply, so headings, lists and tables need no restoring,
 * which is what the injected-HTML approach had to spend a stylesheet on.
 */
const FRAME_STYLES = `
html{overflow-y:hidden}
body{margin:0;padding:12px 14px;background:#fff;color:#18181b;overflow-x:auto;
overflow-wrap:break-word;
font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
img,table,pre{max-width:100%}
img{height:auto}
a[href]{color:#1d4ed8}
img.mf-img-blocked{min-width:28px;min-height:28px;border:1px dashed #a1a1aa;
background-color:#f4f4f5;
background-image:repeating-linear-gradient(45deg,#e4e4e7 0,#e4e4e7 6px,
#f4f4f5 6px,#f4f4f5 12px)}
#mf-quote{border-top:1px solid #e4e4e7;margin-top:14px;padding-top:10px}
`;

/**
 * Elements that mark the start of quoted history, in the order clients emit
 * them. The first match in document order wins, so an attribution line such as
 * Gmail's .gmail_attr or Thunderbird's .moz-cite-prefix is collapsed together
 * with the quote it introduces.
 */
const QUOTE_SELECTOR = [
    '.gmail_quote_container',
    '.gmail_quote',
    '.moz-cite-prefix',
    '#divRplyFwdMsg',
    '#appendonsend',
    'div.OutlookMessageHeader',
    'hr#stopSpelling',
    'blockquote',
].join(',');

/** Per-call state the DOMPurify hooks read; sanitise() is never re-entrant. */
interface HookContext {
    cidMap: Map<string, number>;
    urlPrefix: string;
    loadImages: boolean;
}

let activeContext: HookContext | null = null;
const hookedInstances = new WeakSet<object>();

function scrubStyle(style: string): string {
    return style
        // Remote CSS images are not proxied, so they stay blocked in both modes.
        .replace(/url\s*\([^)]*\)/gi, 'none')
        .replace(/expression\s*\(/gi, 'blocked(')
        // position:fixed would escape the email container entirely. Offsets left
        // behind are inert once nothing can be positioned.
        .replace(/(^|;)\s*position\s*:[^;]*/gi, '$1')
        .replace(/;\s*(?=;)/g, '')
        .replace(/^\s*;\s*/, '')
        .trim();
}

function rewriteImage(img: Element, ctx: HookContext): void {
    const src = (img.getAttribute('src') ?? '').trim();
    if (!src) return;

    if (/^cid:/i.test(src)) {
        const cid = decodeURIComponent(src.slice(4)).replace(/^<|>$/g, '');
        const attachmentId = ctx.cidMap.get(cid);
        if (attachmentId === undefined) {
            // Nothing to point at: emails received before inline parts were
            // stored, or a cid the sender never attached.
            img.remove();
            return;
        }
        img.setAttribute('src', `${ctx.urlPrefix}/${attachmentId}?inline=1`);
        return;
    }

    if (/^data:image\//i.test(src)) return;

    if (!/^https?:\/\//i.test(src)) {
        img.remove();
        return;
    }

    // A declared 1x1 is a tracking pixel with nothing to show. Dropping it means
    // "Load images" never fires it, and the count reflects only real images.
    const width = parseInt(img.getAttribute('width') ?? '', 10);
    const height = parseInt(img.getAttribute('height') ?? '', 10);
    if (width > 0 && width <= 4 && height > 0 && height <= 4) {
        img.remove();
        return;
    }

    if (ctx.loadImages) {
        img.setAttribute('src', `/api/img?u=${encodeURIComponent(src)}`);
        return;
    }

    // The marker class is what the counts are derived from after the quote split,
    // so that each half is counted where it actually ends up.
    img.setAttribute('src', PLACEHOLDER_SRC);
    img.setAttribute('data-remote-src', src);
    img.setAttribute('class', 'mf-img-blocked');
    img.setAttribute('title', src);
}

function installHooks(purify: DOMPurify): void {
    if (hookedInstances.has(purify)) return;
    hookedInstances.add(purify);
    purify.addHook('afterSanitizeAttributes', el => {
        const ctx = activeContext;
        if (!ctx) return;

        const style = el.getAttribute('style');
        if (style) {
            const scrubbed = scrubStyle(style);
            if (scrubbed) el.setAttribute('style', scrubbed);
            else el.removeAttribute('style');
        }

        const tag = el.tagName.toLowerCase();
        if (tag === 'img') {
            rewriteImage(el, ctx);
        } else if (tag === 'a' && el.hasAttribute('href')) {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer nofollow');
        } else if (tag === 'style') {
            // The inherited CSP would refuse a remote stylesheet anyway; dropping
            // @import keeps the request from being attempted at all.
            el.textContent = (el.textContent ?? '').replace(/@import[^;]*;?/gi, '');
        }
    });
}

/**
 * Find where quoted history begins. Returns the element that starts the quote,
 * or null. Clients often wrap the whole body in a single div, so a lone element
 * child is descended into before giving up.
 */
function findQuoteStart(root: Container): HTMLElement | null {
    let scope: Container = root;
    for (let depth = 0; depth < 4; depth++) {
        const children = Array.from(scope.children) as HTMLElement[];
        const hit = children.find(child => child.matches(QUOTE_SELECTOR));
        if (hit) return hit;
        const substantial = children.filter(child => !isEmptyWrapper(child));
        if (substantial.length !== 1) return null;
        scope = substantial[0];
    }
    return null;
}

function isEmptyWrapper(el: HTMLElement): boolean {
    return el.children.length === 0 && (el.textContent ?? '').trim() === '';
}

function countBlockedImages(root: Container): number {
    return root.querySelectorAll('img.mf-img-blocked').length;
}

function serialise(nodes: Node[]): string {
    const holder = document.createElement('div');
    for (const node of nodes) holder.appendChild(node);
    return holder.innerHTML;
}

/**
 * Sanitise an HTML email body and split off its quoted history.
 *
 * @param purify a DOMPurify instance bound to the current window
 * @param html the stored body_html fragment
 */
export function sanitiseEmailHtml(
    purify: DOMPurify,
    html: string,
    opts: SanitiseOptions
): SanitisedEmail {
    installHooks(purify);

    const cidMap = new Map<string, number>();
    for (const att of opts.attachments) {
        if (att.content_id) cidMap.set(att.content_id, att.id);
    }

    const ctx: HookContext = {
        cidMap,
        urlPrefix: `/api/contacts/${opts.contactId}/emails/${opts.emailId}/attachments`,
        loadImages: opts.loadImages,
    };

    activeContext = ctx;
    let fragment: DocumentFragment;
    try {
        // Wrapped in a div on purpose. The HTML parser hoists a *leading* <style>
        // into <head>, and DOMPurify returns body content only, so an email whose
        // fragment begins with a style block (which is where htmlToFragment puts
        // the ones it lifts out of the head) would silently lose it. A wrapper
        // element keeps everything in the body where it can be sanitised and
        // returned; findQuoteStart already descends through a single wrapper.
        fragment = purify.sanitize(
            `<div>${html}</div>`, SANITISE_CONFIG) as unknown as DocumentFragment;
    } finally {
        activeContext = null;
    }

    // The quote and everything after it, taken from wherever it sits: clients
    // often wrap the body in one div with the quote as its last child.
    const quoteNodes: Node[] = [];
    let cursor: Node | null = findQuoteStart(fragment);
    while (cursor) {
        quoteNodes.push(cursor);
        cursor = cursor.nextSibling;
    }

    const quoteHolder = document.createElement('div');
    for (const node of quoteNodes) quoteHolder.appendChild(node);

    // Counted before serialising, while both halves are still live nodes.
    const blockedImages = countBlockedImages(fragment);
    const blockedImagesInQuote = countBlockedImages(quoteHolder);

    const main = serialise(Array.from(fragment.childNodes));
    const quote = quoteHolder.innerHTML.trim();

    return {
        main,
        quote: quote || null,
        blockedImages,
        blockedImagesInQuote,
    };
}

/**
 * Assemble the document for the message iframe.
 *
 * The quoted history is included or omitted rather than hidden, because nothing
 * inside the frame can run script to toggle it: the frame is sandboxed without
 * allow-scripts. Changing this string re-navigates the frame, which is cheap and
 * keeps the toggle declarative.
 *
 * `<base target="_blank">` sends link clicks to a new tab, which the sandbox
 * permits via allow-popups; `base` is forbidden to the email itself so it cannot
 * retarget its own relative URLs.
 */
export function buildEmailDocument(email: SanitisedEmail, showQuote: boolean): string {
    const quote = showQuote && email.quote !== null
        ? `<div id="mf-quote">${email.quote}</div>`
        : '';
    return '<!DOCTYPE html><html><head><meta charset="utf-8">'
        + '<base target="_blank">'
        + `<style>${FRAME_STYLES}</style></head>`
        + `<body>${email.main}${quote}</body></html>`;
}
