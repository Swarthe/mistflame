import { getCloudflareContext } from '@opennextjs/cloudflare';
import { parseAddrList, parseDraftFields } from '@/lib/server/validation';

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
    // Same contract as the POST handler, enforced by sharing the parser.
    const parsed = parseDraftFields(body);
    if (!parsed.ok) {
        return Response.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    const { sender, subject, body: emailBody, bodyFormat, cc, toAddrs, bcc } = parsed.fields;

    const { env } = await getCloudflareContext({ async: true });

    const validAddrs = parseAddrList(env.SEND_ADDRS);
    if (!validAddrs.includes(sender)) {
        return Response.json({ ok: false, error: 'Invalid sender address.' }, { status: 400 });
    }

    const result = await env.DB
        .prepare('UPDATE email SET subject = ?, body = ?, body_format = ?, cc = ?, to_addrs = ?, bcc = ?, sender = ? WHERE id = ? AND contact_id = ? AND sent_at IS NULL')
        .bind(subject, emailBody, bodyFormat, cc, toAddrs, bcc, sender, emailIdNum, contactId)
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

    // One transaction, so a failure between the two cannot leave attachment
    // rows pointing at deleted emails. The R2 deletes stay best-effort.
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM attachment WHERE email_id IN (${ids.map(() => '?').join(',')})`).bind(...ids),
        env.DB.prepare(`DELETE FROM email WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids),
    ]);

    return Response.json({ ok: true, deleted: ids.length });
}
