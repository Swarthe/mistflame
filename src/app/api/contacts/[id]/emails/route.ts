import { getCloudflareContext } from '@opennextjs/cloudflare';
import { isValidEmail } from '@/app/api/contacts/route';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const contactId = parseInt(id, 10);
    if (isNaN(contactId)) return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });

    const { env } = await getCloudflareContext({ async: true });
    const { results: emails } = await env.DB
        .prepare(`
            WITH RECURSIVE ancestry AS (
                SELECT id, id AS root_id FROM email WHERE parent_id IS NULL AND contact_id = ?
                UNION ALL
                SELECT e.id, a.root_id FROM email e JOIN ancestry a ON e.parent_id = a.id
            ),
            ranked AS (
                SELECT id, DENSE_RANK() OVER (ORDER BY root_id) AS thread_id FROM ancestry
            )
            SELECT e.id, e.contact_id, e.parent_id, e.sender, e.sent_at, e.subject,
                   e.body, e.body_html, e.message_id, e.recipient, e.reply_to,
                   e.from_addr, e.cc, e.to_addrs, e.bcc, r.thread_id
            FROM email e JOIN ranked r ON e.id = r.id
            -- A batch send stamps every row with the same sent_at, so the id
            -- tie-break keeps same-second messages in a stable order.
            ORDER BY e.sent_at ASC NULLS LAST, e.id ASC
        `)
        .bind(contactId)
        .all<{ id: number; thread_id: number }>();

    const { results: attachments } = await env.DB
        .prepare('SELECT id, email_id, file_name AS filename, content_type, size, content_id, inline FROM attachment WHERE email_id IN (SELECT id FROM email WHERE contact_id = ?)')
        .bind(contactId)
        .all<{ id: number; email_id: number; filename: string; content_type: string; size: number; content_id: string | null; inline: number }>();

    const attMap = new Map<number, { id: number; filename: string; content_type: string; size: number; content_id: string | null; inline: number }[]>();
    for (const att of attachments) {
        const list = attMap.get(att.email_id) ?? [];
        list.push({ id: att.id, filename: att.filename, content_type: att.content_type, size: att.size, content_id: att.content_id, inline: att.inline });
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
    const sender = typeof body?.sender === 'string' ? body.sender : null;
    // Anything other than a string (a JSON number, say) would otherwise be
    // bound into the row as-is.
    const subject = typeof body?.subject === 'string' ? body.subject : null;
    const emailBody = body?.body;
    const cc = typeof body?.cc === 'string' && body.cc.trim() ? body.cc.trim() : null;
    const toAddrs = typeof body?.to_addrs === 'string' && body.to_addrs.trim() ? body.to_addrs.trim() : null;
    const bcc = typeof body?.bcc === 'string' && body.bcc.trim() ? body.bcc.trim() : null;
    const rawParentId = body?.parent_id;

    if (!sender) {
        return Response.json({ ok: false, error: 'sender is required.' }, { status: 400 });
    }
    if (typeof emailBody !== 'string' || !emailBody.trim()) {
        return Response.json({ ok: false, error: 'body is required.' }, { status: 400 });
    }
    if (emailBody.length > 100_000) {
        return Response.json({ ok: false, error: 'body too long.' }, { status: 400 });
    }
    if (subject !== null && subject.length > 500) {
        return Response.json({ ok: false, error: 'subject too long.' }, { status: 400 });
    }
    // Validated here rather than only in the client, because an invalid
    // address surfaces at send time, where its EmailMessage would fail after
    // the contact's copy has already been delivered.
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

    const parent_id = rawParentId != null ? parseInt(String(rawParentId), 10) : null;
    if (parent_id !== null && isNaN(parent_id)) {
        return Response.json({ ok: false, error: 'Invalid parent_id.' }, { status: 400 });
    }

    try {
        const { env } = await getCloudflareContext({ async: true });

        const validAddrs = (env.SEND_ADDRS ?? '').split(',').map((a: string) => a.trim()).filter(Boolean);
        if (!validAddrs.includes(sender)) {
            return Response.json({ ok: false, error: 'Invalid sender address.' }, { status: 400 });
        }

        if (parent_id !== null) {
            const exists = await env.DB
                .prepare('SELECT 1 FROM email WHERE id = ? AND contact_id = ?')
                .bind(parent_id, contactId)
                .first();
            if (!exists) {
                return Response.json({ ok: false, error: 'Parent email not found.' }, { status: 404 });
            }
        }

        const result = await env.DB
            .prepare('INSERT INTO email (contact_id, parent_id, sender, subject, body, cc, to_addrs, bcc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(contactId, parent_id, sender, subject, emailBody.trim(), cc, toAddrs, bcc)
            .run();

        const emailId = result.meta.last_row_id;

        const threadRow = await env.DB
            .prepare(`
                WITH RECURSIVE ancestry AS (
                    SELECT id, id AS root_id FROM email WHERE parent_id IS NULL AND contact_id = ?
                    UNION ALL
                    SELECT e.id, a.root_id FROM email e JOIN ancestry a ON e.parent_id = a.id
                ),
                ranked AS (
                    SELECT id, DENSE_RANK() OVER (ORDER BY root_id) AS thread_id FROM ancestry
                )
                SELECT thread_id FROM ranked WHERE id = ?
            `)
            .bind(contactId, emailId)
            .first<{ thread_id: number }>();

        return Response.json({
            ok: true,
            email: {
                id: emailId,
                contact_id: contactId,
                thread_id: threadRow?.thread_id ?? 1,
                parent_id,
                sender,
                sent_at: null,
                subject,
                body: emailBody.trim(),
                // Composed drafts are plain text; an HTML alternative is only
                // generated at send time when the parent has one.
                body_html: null,
                recipient: null,
                reply_to: null,
                from_addr: null,
                cc,
                to_addrs: toAddrs,
                bcc,
            },
        }, { status: 201 });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ ok: false, error: message }, { status: 500 });
    }
}
