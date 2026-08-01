import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * A counter bumped by trigger on every write to contact, tag, contact_tag,
 * email or attachment. The client polls this instead of the three list
 * endpoints, and only refetches those when the number has moved.
 *
 * Returns `revision: null` rather than an error if the row is missing, so a
 * deployment whose database predates migration 003 keeps working: the client
 * reads that as "unknown" and refetches on every poll, which is what it did
 * before this endpoint existed.
 */
export async function GET() {
    const { env } = await getCloudflareContext({ async: true });
    const row = await env.DB
        .prepare("SELECT value FROM meta WHERE key = 'revision'")
        .first<{ value: number }>()
        .catch(() => null);
    return Response.json({ ok: true, revision: row?.value ?? null });
}
