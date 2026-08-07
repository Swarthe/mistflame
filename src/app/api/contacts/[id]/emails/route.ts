import { getCloudflareContext } from '@opennextjs/cloudflare';
import { parseAddrList, parseDraftFields } from '@/lib/server/validation';

// Thread numbering is computed, not stored: each email walks up parent_id to
// its root, and threads are numbered by root in DENSE_RANK order. Takes the
// contact id as its one bound parameter.
const THREAD_CTE = `
    WITH RECURSIVE ancestry AS (
        SELECT id, id AS root_id FROM email WHERE parent_id IS NULL AND contact_id = ?
        UNION ALL
        SELECT e.id, a.root_id FROM email e JOIN ancestry a ON e.parent_id = a.id
    ),
    ranked AS (
        SELECT id, DENSE_RANK() OVER (ORDER BY root_id) AS thread_id FROM ancestry
    )
`;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const contactId = parseInt(id, 10);
    if (isNaN(contactId)) return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });

    const { env } = await getCloudflareContext({ async: true });
    const { results: emails } = await env.DB
        .prepare(THREAD_CTE + `
            SELECT e.id, e.contact_id, e.parent_id, e.sender, e.sent_at, e.subject,
                   e.body, e.body_html, e.body_format, e.message_id, e.recipient,
                   e.reply_to, e.from_addr, e.cc, e.to_addrs, e.bcc, r.thread_id
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
    const parsed = parseDraftFields(body);
    if (!parsed.ok) {
        return Response.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    const { sender, subject, body: emailBody, bodyFormat, cc, toAddrs, bcc } = parsed.fields;

    const rawParentId = body?.parent_id;
    const parent_id = rawParentId != null ? parseInt(String(rawParentId), 10) : null;
    if (parent_id !== null && isNaN(parent_id)) {
        return Response.json({ ok: false, error: 'Invalid parent_id.' }, { status: 400 });
    }

    try {
        const { env } = await getCloudflareContext({ async: true });

        const validAddrs = parseAddrList(env.SEND_ADDRS);
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
            .prepare('INSERT INTO email (contact_id, parent_id, sender, subject, body, body_format, cc, to_addrs, bcc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(contactId, parent_id, sender, subject, emailBody, bodyFormat, cc, toAddrs, bcc)
            .run();

        const emailId = result.meta.last_row_id;

        const threadRow = await env.DB
            .prepare(THREAD_CTE + 'SELECT thread_id FROM ranked WHERE id = ?')
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
                body: emailBody,
                // A composed draft stores no HTML even in markdown format: the
                // rendition is generated at send time and for display, so
                // body_html stays receiver-only.
                body_html: null,
                body_format: bodyFormat,
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
