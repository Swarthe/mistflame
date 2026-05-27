import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string; emailId: string }> }
) {
    const { id, emailId } = await params;
    const contactId = parseInt(id, 10);
    const emailIdNum = parseInt(emailId, 10);
    if (isNaN(contactId) || isNaN(emailIdNum)) {
        return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const subject = body?.subject ?? null;
    const emailBody = body?.body;
    const cc = typeof body?.cc === 'string' && body.cc.trim() ? body.cc.trim() : null;
    const sender = typeof body?.sender === 'string' ? body.sender : null;

    if (typeof emailBody !== 'string' || !emailBody.trim()) {
        return Response.json({ ok: false, error: 'body is required.' }, { status: 400 });
    }
    if (emailBody.length > 100_000) {
        return Response.json({ ok: false, error: 'body too long.' }, { status: 400 });
    }
    if (typeof subject === 'string' && subject.length > 500) {
        return Response.json({ ok: false, error: 'subject too long.' }, { status: 400 });
    }
    if (!sender) {
        return Response.json({ ok: false, error: 'sender is required.' }, { status: 400 });
    }

    const { env } = await getCloudflareContext({ async: true });

    const validAddrs = (env.SEND_ADDRS ?? '').split(',').map((a: string) => a.trim()).filter(Boolean);
    if (!validAddrs.includes(sender)) {
        return Response.json({ ok: false, error: 'Invalid sender address.' }, { status: 400 });
    }

    const result = await env.DB
        .prepare('UPDATE email SET subject = ?, body = ?, cc = ?, sender = ? WHERE id = ? AND contact_id = ? AND sent_at IS NULL')
        .bind(subject, emailBody.trim(), cc, sender, emailIdNum, contactId)
        .run();

    if (result.meta.changes === 0) {
        return Response.json({ ok: false, error: 'Email not found or already sent.' }, { status: 404 });
    }

    return Response.json({ ok: true });
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string; emailId: string }> }
) {
    const { id, emailId } = await params;
    const contactId = parseInt(id, 10);
    const emailIdNum = parseInt(emailId, 10);
    if (isNaN(contactId) || isNaN(emailIdNum)) {
        return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });
    }

    const { env } = await getCloudflareContext({ async: true });

    const { results: toDelete } = await env.DB
        .prepare(`
            WITH RECURSIVE to_delete(id) AS (
                SELECT id FROM email WHERE id = ? AND contact_id = ?
                UNION ALL
                SELECT e.id FROM email e
                JOIN to_delete t ON e.parent_id = t.id
            )
            SELECT id FROM to_delete
        `)
        .bind(emailIdNum, contactId)
        .all<{ id: number }>();

    if (toDelete.length === 0) {
        return Response.json({ ok: false, error: 'Email not found.' }, { status: 404 });
    }

    const ids = toDelete.map(r => r.id);

    const { results: attachments } = await env.DB
        .prepare(`SELECT r2_key FROM attachment WHERE email_id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids)
        .all<{ r2_key: string }>();

    await Promise.all(attachments.map(att => env.ATTACHMENTS.delete(att.r2_key)));

    await env.DB
        .prepare(`DELETE FROM attachment WHERE email_id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids)
        .run();

    await env.DB
        .prepare(`DELETE FROM email WHERE id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids)
        .run();

    return Response.json({ ok: true, deleted: ids.length });
}
