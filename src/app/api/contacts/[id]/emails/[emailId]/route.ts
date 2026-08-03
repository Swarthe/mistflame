import { getCloudflareContext } from '@opennextjs/cloudflare';
import { isValidEmail } from '@/app/api/contacts/route';

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
    // Anything other than a string (a JSON number, say) would otherwise be
    // bound into the row as-is.
    const subject = typeof body?.subject === 'string' ? body.subject : null;
    const emailBody = body?.body;
    const cc = typeof body?.cc === 'string' && body.cc.trim() ? body.cc.trim() : null;
    const toAddrs = typeof body?.to_addrs === 'string' && body.to_addrs.trim() ? body.to_addrs.trim() : null;
    const bcc = typeof body?.bcc === 'string' && body.bcc.trim() ? body.bcc.trim() : null;
    const sender = typeof body?.sender === 'string' ? body.sender : null;

    if (typeof emailBody !== 'string' || !emailBody.trim()) {
        return Response.json({ ok: false, error: 'body is required.' }, { status: 400 });
    }
    if (emailBody.length > 100_000) {
        return Response.json({ ok: false, error: 'body too long.' }, { status: 400 });
    }
    if (subject !== null && subject.length > 500) {
        return Response.json({ ok: false, error: 'subject too long.' }, { status: 400 });
    }
    if (!sender) {
        return Response.json({ ok: false, error: 'sender is required.' }, { status: 400 });
    }
    // Same reasoning as the POST handler: an invalid address would only
    // fail at send time, after the contact's copy has been delivered.
    const hasInvalidAddr = (list: string) =>
        list.split(',').map(a => a.trim()).filter(Boolean).some(a => !isValidEmail(a));
    if (cc && hasInvalidAddr(cc)) {
        return Response.json({ ok: false, error: 'Invalid CC address.' }, { status: 400 });
    }
    if (toAddrs && hasInvalidAddr(toAddrs)) {
        return Response.json({ ok: false, error: 'Invalid To address.' }, { status: 400 });
    }
    if (bcc && hasInvalidAddr(bcc)) {
        return Response.json({ ok: false, error: 'Invalid BCC address.' }, { status: 400 });
    }

    const { env } = await getCloudflareContext({ async: true });

    const validAddrs = (env.SEND_ADDRS ?? '').split(',').map((a: string) => a.trim()).filter(Boolean);
    if (!validAddrs.includes(sender)) {
        return Response.json({ ok: false, error: 'Invalid sender address.' }, { status: 400 });
    }

    const result = await env.DB
        .prepare('UPDATE email SET subject = ?, body = ?, cc = ?, to_addrs = ?, bcc = ?, sender = ? WHERE id = ? AND contact_id = ? AND sent_at IS NULL')
        .bind(subject, emailBody.trim(), cc, toAddrs, bcc, sender, emailIdNum, contactId)
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
