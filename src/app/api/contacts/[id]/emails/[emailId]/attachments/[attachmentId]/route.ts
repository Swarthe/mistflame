import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string; emailId: string; attachmentId: string }> }
) {
    const { id, emailId, attachmentId } = await params;
    const contactId = parseInt(id, 10);
    const emailIdNum = parseInt(emailId, 10);
    const attachmentIdNum = parseInt(attachmentId, 10);
    if (isNaN(contactId) || isNaN(emailIdNum) || isNaN(attachmentIdNum)) {
        return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });
    }

    const { env } = await getCloudflareContext({ async: true });

    const row = await env.DB
        .prepare(`
            SELECT a.r2_key, a.file_name, a.content_type FROM attachment a
            JOIN email e ON e.id = a.email_id
            WHERE a.id = ? AND a.email_id = ? AND e.contact_id = ?
        `)
        .bind(attachmentIdNum, emailIdNum, contactId)
        .first<{ r2_key: string; file_name: string; content_type: string }>();

    if (!row) {
        return Response.json({ ok: false, error: 'Attachment not found.' }, { status: 404 });
    }

    const obj = await env.ATTACHMENTS.get(row.r2_key);
    if (!obj) {
        return Response.json({ ok: false, error: 'File not found in storage.' }, { status: 404 });
    }

    const safeName = encodeURIComponent(row.file_name);
    return new Response(obj.body, {
        headers: {
            'Content-Type': row.content_type,
            'Content-Disposition': `attachment; filename="${row.file_name}"; filename*=UTF-8''${safeName}`,
            'Content-Length': String(obj.size),
        },
    });
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string; emailId: string; attachmentId: string }> }
) {
    const { id, emailId, attachmentId } = await params;
    const contactId = parseInt(id, 10);
    const emailIdNum = parseInt(emailId, 10);
    const attachmentIdNum = parseInt(attachmentId, 10);
    if (isNaN(contactId) || isNaN(emailIdNum) || isNaN(attachmentIdNum)) {
        return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });
    }

    const { env } = await getCloudflareContext({ async: true });

    const row = await env.DB
        .prepare(`
            SELECT a.r2_key FROM attachment a
            JOIN email e ON e.id = a.email_id
            WHERE a.id = ? AND a.email_id = ? AND e.contact_id = ? AND e.sent_at IS NULL
        `)
        .bind(attachmentIdNum, emailIdNum, contactId)
        .first<{ r2_key: string }>();

    if (!row) {
        return Response.json({ ok: false, error: 'Attachment not found or email already sent.' }, { status: 404 });
    }

    await env.ATTACHMENTS.delete(row.r2_key);
    await env.DB
        .prepare('DELETE FROM attachment WHERE id = ?')
        .bind(attachmentIdNum)
        .run();

    return Response.json({ ok: true });
}
