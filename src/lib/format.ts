// Pure helpers shared by the client components. Nothing here touches React
// or the DOM.

// Deliberately duplicated from api/contacts/route.ts rather than imported:
// pulling a route module into the client bundle to share one regex is the
// worse trade.
export const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export const validateCc = (cc: string): string | null => {
    if (!cc.trim()) return null;
    const invalid = cc.split(',').map(a => a.trim()).filter(a => a && !isValidEmail(a));
    return invalid.length > 0 ? `Invalid: ${invalid.join(', ')}` : null;
};

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

export function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
        return iso;
    }
}

export function splitQuote(body: string): { main: string; quote: string | null } {
    const normalised = body.replace(/\r\n/g, '\n');
    const match = normalised.match(/\n\nOn .+? wrote:/);
    if (!match || match.index === undefined) return { main: normalised.trimEnd(), quote: null };
    return {
        main: normalised.slice(0, match.index).trimEnd(),
        quote: normalised.slice(match.index + 2).trimEnd(),
    };
}
