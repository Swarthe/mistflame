import { getCloudflareContext } from '@opennextjs/cloudflare';

// Defined identically in middleware.ts, auth/route.ts and config/route.ts; the
// duplication across execution contexts is deliberate (see CLAUDE.md).
const REMEMBER_COOKIE = '__remember';

// A session's presence row is refreshed at most every PRESENCE_REFRESH_S and
// counts as active for PRESENCE_WINDOW_S. The window must exceed refresh +
// poll interval (15 + 5 seconds), or a throttled write would let a live
// session flicker out of the count. Rows a day stale are swept out so the
// table stays one row per recently used session rather than growing forever.
const PRESENCE_REFRESH_S = 15;
const PRESENCE_WINDOW_S = 30;
const PRESENCE_EXPIRE_S = 86_400;

// The session token is a bearer credential, so D1 stores only its SHA-256:
// the presence table must not become a second copy of the KV session store.
async function tokenHash(request: Request): Promise<string | null> {
    const match = (request.headers.get('Cookie') ?? '')
        .match(new RegExp(`(?:^|;\\s*)${REMEMBER_COOKIE}=([^;]+)`));
    if (!match) return null;
    const digest = await crypto.subtle.digest(
        'SHA-256', new TextEncoder().encode(match[1]));
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * A counter bumped by trigger on every write to contact, tag, contact_tag,
 * email or attachment. The client polls this instead of the three list
 * endpoints, and only refetches those when the number has moved.
 *
 * Returns `revision: null` rather than an error if the row is missing, so a
 * deployment whose database predates migration 003 keeps working: the client
 * reads that as "unknown" and refetches on every poll, which is what it did
 * before this endpoint existed.
 *
 * The same poll doubles as a presence heartbeat: the caller's row in the
 * presence table is refreshed (throttled) and `activeOthers` reports how many
 * other sessions were seen inside the window. A database predating migration
 * 008, or any other failure, degrades to `activeOthers: null`, which the
 * client treats as "unknown" and shows no notice.
 */
export async function GET(request: Request) {
    const { env } = await getCloudflareContext({ async: true });
    const row = await env.DB
        .prepare("SELECT value FROM meta WHERE key = 'revision'")
        .first<{ value: number }>()
        .catch(() => null);

    let activeOthers: number | null = null;
    try {
        const hash = await tokenHash(request);
        if (hash !== null) {
            const now = Math.floor(Date.now() / 1000);
            const results = await env.DB.batch([
                env.DB.prepare(
                    `INSERT INTO presence (token_hash, last_seen)
                     VALUES (?1, ?2)
                     ON CONFLICT (token_hash) DO UPDATE SET last_seen = ?2
                     WHERE ?2 - last_seen >= ?3`
                ).bind(hash, now, PRESENCE_REFRESH_S),
                env.DB.prepare(
                    'DELETE FROM presence WHERE last_seen < ?1'
                ).bind(now - PRESENCE_EXPIRE_S),
                env.DB.prepare(
                    `SELECT COUNT(*) AS n FROM presence
                     WHERE last_seen >= ?1 AND token_hash <> ?2`
                ).bind(now - PRESENCE_WINDOW_S, hash),
            ]);
            const count = results[2].results[0] as { n: number } | undefined;
            activeOthers = count?.n ?? 0;
        }
    } catch {
        // Presence is optional; the revision answer still stands.
    }

    return Response.json({ ok: true, revision: row?.value ?? null, activeOthers });
}
