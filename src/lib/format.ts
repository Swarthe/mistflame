// Pure helpers shared by the client components. Nothing here touches React
// or the DOM.

import type { Contact } from './types';

// Sidebar order: most recent activity first, contacts with no dated mail
// last, name as the tie-break. Mirrors the ORDER BY in the contacts query so
// a locally inserted contact lands where the next refetch would put it.
export function compareContacts(a: Contact, b: Contact): number {
    if (a.last_activity !== b.last_activity) {
        if (a.last_activity === null) return 1;
        if (b.last_activity === null) return -1;
        return a.last_activity < b.last_activity ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
}

// Deliberately duplicated from api/contacts/route.ts rather than imported:
// pulling a route module into the client bundle to share one regex is the
// worse trade.
export const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export function hexToRgba(hex: string, alpha: number): string {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function fuzzyMatch(query: string, target: string): boolean {
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) qi++;
    }
    return qi === q.length;
}

// An unparseable timestamp yields the raw string: new Date() does not throw
// on garbage, it returns an Invalid Date, so a try/catch would not help.
export function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatDateOnly(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { dateStyle: 'short' });
}

export function splitQuote(body: string): { main: string; quote: string | null } {
    const normalised = body.replace(/\r\n/g, '\n');
    // Reply quotes and forwarded blocks both collapse; earliest match wins.
    // -{4,} also catches Gmail-style inbound forward separators.
    let best: { start: number; quoteStart: number } | null = null;
    for (const re of [/\n\nOn .+? wrote:/, /(?:^|\n\n)-{4,} Forwarded message -{4,}/]) {
        const match = normalised.match(re);
        if (match?.index === undefined) continue;
        if (best !== null && match.index >= best.start) continue;
        best = {
            start: match.index,
            quoteStart: match.index + (match[0].startsWith('\n\n') ? 2 : 0),
        };
    }
    if (best === null) return { main: normalised.trimEnd(), quote: null };
    return {
        main: normalised.slice(0, best.start).trimEnd(),
        quote: normalised.slice(best.quoteStart).trimEnd(),
    };
}
