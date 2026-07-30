import { getCloudflareContext } from '@opennextjs/cloudflare';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string; emailId: string }> }
) {
    const { id, emailId } = await params;
    const contactId = parseInt(id, 10);
    const emailIdNum = parseInt(emailId, 10);
    if (isNaN(contactId) || isNaN(emailIdNum)) {
        return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });
    }

    const { env } = await getCloudflareContext({ async: true });

    const email = await env.DB
        .prepare("SELECT id FROM email WHERE id = ? AND contact_id = ? AND sender IS NOT NULL AND sent_at IS NULL")
        .bind(emailIdNum, contactId)
        .first();

    if (!email) {
        return Response.json({ ok: false, error: 'Email not found or already sent.' }, { status: 404 });
    }

    const formData = await request.formData().catch(() => null);
    const file = formData?.get('file');

    if (!(file instanceof File)) {
        return Response.json({ ok: false, error: 'file is required.' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
        return Response.json({ ok: false, error: 'File too large (max 10 MB).' }, { status: 400 });
    }

    const r2Key = `${emailIdNum}/${crypto.randomUUID()}-${file.name}`;
    const contentType = file.type || 'application/octet-stream';

    await env.ATTACHMENTS.put(r2Key, await file.arrayBuffer(), {
        httpMetadata: { contentType },
    });

    const result = await env.DB
        .prepare('INSERT INTO attachment (email_id, file_name, content_type, r2_key, size) VALUES (?, ?, ?, ?, ?)')
        .bind(emailIdNum, file.name, contentType, r2Key, file.size)
        .run();

    return Response.json({
        ok: true,
        attachment: {
            id: result.meta.last_row_id,
            filename: file.name,
            content_type: contentType,
            size: file.size,
            // Uploads are always ordinary files; only the receiver writes inline
            // parts, which come from a cid: reference in an HTML body.
            content_id: null,
            inline: 0,
        },
    }, { status: 201 });
}
