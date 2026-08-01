import { getCloudflareContext } from '@opennextjs/cloudflare';

const MAX_QUERY_CHARS = 200;
const MAX_TERMS = 10;
const MAX_RESULTS = 50;
const MIN_QUERY_CHARS = 2;

/**
 * Snippet delimiters. Control characters, so they cannot occur in a body and
 * need no escaping; the client splits on them and renders the marked runs as
 * elements rather than being handed markup to inject.
 */
export const HIT_OPEN = '\u0002';
export const HIT_CLOSE = '\u0003';

/**
 * Turn user input into an FTS5 MATCH expression.
 *
 * Raw input cannot be passed through: `AND`, `*`, `^`, `:`, `-` and an unpaired
 * quote are all operators, so a search for `re: hello` or a lone `"` is a
 * syntax error rather than a search. Every term is therefore quoted, which
 * makes it a literal phrase, and the tokeniser still splits inside the quotes,
 * so `sam@example.com` becomes the phrase sam + example + com and matches.
 *
 * The last term gets a `*` for prefix matching, so results narrow as the user
 * is still typing the word.
 *
 * Returns null when nothing searchable is left, e.g. input of only punctuation.
 */
export function toMatchExpression(raw: string): string | null {
    const terms = raw
        .slice(0, MAX_QUERY_CHARS)
        .split(/\s+/)
        .map(term => term.trim())
        // A term the tokeniser would reduce to nothing (say "--") contributes
        // an empty phrase, which FTS5 rejects outright.
        .filter(term => /[\p{L}\p{N}]/u.test(term))
        .slice(0, MAX_TERMS);

    if (terms.length === 0) return null;

    return terms
        .map((term, i) => {
            const quoted = `"${term.replace(/"/g, '""')}"`;
            return i === terms.length - 1 ? `${quoted}*` : quoted;
        })
        .join(' ');
}

interface SearchRow {
    id: number;
    contact_id: number;
    contact_name: string;
    contact_email: string;
    sender: string | null;
    sent_at: string | null;
    subject: string | null;
    snippet: string;
}

export async function GET(request: Request) {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    if (q.trim().length < MIN_QUERY_CHARS) {
        return Response.json({ ok: true, results: [], truncated: false });
    }

    const match = toMatchExpression(q);
    if (match === null) {
        return Response.json({ ok: true, results: [], truncated: false });
    }

    const { env } = await getCloudflareContext({ async: true });

    try {
        const { results } = await env.DB
            .prepare(`
                SELECT e.id, e.contact_id, e.sender, e.sent_at, e.subject,
                       c.name AS contact_name, c.email AS contact_email,
                       snippet(email_fts, -1, ?, ?, '…', 12) AS snippet
                FROM email_fts
                JOIN email e ON e.id = email_fts.rowid
                JOIN contact c ON c.id = e.contact_id
                WHERE email_fts MATCH ?
                ORDER BY bm25(email_fts, 2.0, 1.0), e.sent_at DESC
                LIMIT ?
            `)
            .bind(HIT_OPEN, HIT_CLOSE, match, MAX_RESULTS + 1)
            .all<SearchRow>();

        // One row over the limit is fetched purely to tell "exactly 50 hits"
        // from "more than we are showing".
        const truncated = results.length > MAX_RESULTS;
        return Response.json({
            ok: true,
            results: truncated ? results.slice(0, MAX_RESULTS) : results,
            truncated,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // The index is a separate migration from the code that queries it, so a
        // deployment can legitimately be missing it. Say so rather than
        // returning a 500 that reads as "search is broken".
        if (/no such table: (main\.)?email_fts/i.test(message)) {
            return Response.json({
                ok: false,
                unavailable: true,
                error: 'Search index not installed.',
            }, { status: 503 });
        }
        return Response.json({ ok: false, error: message }, { status: 500 });
    }
}
