import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const contactId = parseInt(id, 10);
    if (isNaN(contactId)) return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });

    const { env } = await getCloudflareContext({ async: true });
    const { results: emails } = await env.DB
        .prepare('SELECT * FROM email WHERE contact_id = ? ORDER BY sent_at ASC NULLS LAST')
        .bind(contactId)
        .all<{ id: number }>();

    const { results: attachments } = await env.DB
        .prepare('SELECT id, email_id, file_name AS filename, content_type, size FROM attachment WHERE email_id IN (SELECT id FROM email WHERE contact_id = ?)')
        .bind(contactId)
        .all<{ id: number; email_id: number; filename: string; content_type: string; size: number }>();

    const attMap = new Map<number, { id: number; filename: string; content_type: string; size: number }[]>();
    for (const att of attachments) {
        const list = attMap.get(att.email_id) ?? [];
        list.push({ id: att.id, filename: att.filename, content_type: att.content_type, size: att.size });
        attMap.set(att.email_id, list);
    }

    const emailsWithAttachments = emails.map(e => ({ ...e, attachments: attMap.get(e.id) ?? [] }));
    return Response.json({ ok: true, emails: emailsWithAttachments });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const contactId = parseInt(id, 10);
    if (isNaN(contactId)) return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const sender = body?.sender === undefined ? undefined : (body.sender === null ? null : String(body.sender));
    const subject = body?.subject ?? null;
    const emailBody = body?.body;
    const cc = typeof body?.cc === 'string' && body.cc.trim() ? body.cc.trim() : null;
    const rawParentId = body?.parent_id;

    if (sender === undefined) {
        return Response.json({ ok: false, error: 'sender is required (null for contact, address string for mistflame).' }, { status: 400 });
    }
    if (typeof emailBody !== 'string' || !emailBody.trim()) {
        return Response.json({ ok: false, error: 'body is required.' }, { status: 400 });
    }

    const parent_id = rawParentId != null ? parseInt(String(rawParentId), 10) : null;
    if (parent_id !== null && isNaN(parent_id)) {
        return Response.json({ ok: false, error: 'Invalid parent_id.' }, { status: 400 });
    }

    try {
        const { env } = await getCloudflareContext({ async: true });

        if (sender !== null) {
            const validAddrs = (env.SEND_ADDRS ?? '').split(',').map((a: string) => a.trim()).filter(Boolean);
            if (!validAddrs.includes(sender)) {
                return Response.json({ ok: false, error: 'Invalid sender address.' }, { status: 400 });
            }
        }

        let thread_id: number;

        if (parent_id !== null) {
            const parentRow = await env.DB
                .prepare('SELECT thread_id FROM email WHERE id = ? AND contact_id = ?')
                .bind(parent_id, contactId)
                .first<{ thread_id: number }>();
            if (!parentRow) {
                return Response.json({ ok: false, error: 'Parent email not found.' }, { status: 404 });
            }
            thread_id = parentRow.thread_id;
        } else {
            const threadRow = await env.DB
                .prepare('SELECT COALESCE(MAX(thread_id), 0) + 1 AS next_thread FROM email WHERE contact_id = ?')
                .bind(contactId)
                .first<{ next_thread: number }>();
            thread_id = threadRow?.next_thread ?? 1;
        }

        const result = await env.DB
            .prepare('INSERT INTO email (contact_id, thread_id, parent_id, sender, subject, body, cc) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(contactId, thread_id, parent_id, sender, subject, emailBody.trim(), cc)
            .run();

        const emailId = result.meta.last_row_id;

        return Response.json({
            ok: true,
            email: {
                id: emailId,
                contact_id: contactId,
                thread_id,
                parent_id,
                sender,
                sent_at: null,
                subject,
                body: emailBody.trim(),
                cc,
            },
        }, { status: 201 });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ ok: false, error: message }, { status: 500 });
    }
}
