import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function GET() {
    const { env } = await getCloudflareContext({ async: true });
    const { results } = await env.DB
        .prepare('SELECT id, name, color FROM tag ORDER BY name')
        .all<{ id: number; name: string; color: string }>();
    return Response.json({ ok: true, tags: results });
}
