import { getCloudflareContext } from '@opennextjs/cloudflare';

// Forwarding creates a fresh draft thread under the target contact ([id] in
// the URL), with the source message baked into the body as a plain-text
// block. Unlike replies, whose quote is appended at send time, the block is
// built here at creation time: the source lives under a different contact,
// so parent_id cannot reference it, and the user edits around the forwarded
// content like in any mail client.

interface SourceEmail {
    sender: string | null;
    sent_at: string | null;
    subject: string | null;
    body: string;
    cc: string | null;
    to_addrs: string | null;
    recipient: string | null;
    from_addr: string | null;
    src_name: string;
    src_email: string;
}

interface SourceAttachment {
    file_name: string;
    content_type: string;
    r2_key: string;
    size: number;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const contactId = parseInt(id, 10);
    if (isNaN(contactId)) return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const sourceId = body?.source_id != null ? parseInt(String(body.source_id), 10) : null;
    const sender = typeof body?.sender === 'string' ? body.sender : null;

    if (sourceId === null || isNaN(sourceId)) {
        return Response.json({ ok: false, error: 'Invalid source_id.' }, { status: 400 });
    }
    if (!sender) {
        return Response.json({ ok: false, error: 'sender is required.' }, { status: 400 });
    }

    try {
        const { env } = await getCloudflareContext({ async: true });

        const validAddrs = (env.SEND_ADDRS ?? '').split(',').map((a: string) => a.trim()).filter(Boolean);
        if (!validAddrs.includes(sender)) {
            return Response.json({ ok: false, error: 'Invalid sender address.' }, { status: 400 });
        }

        const target = await env.DB
            .prepare('SELECT 1 FROM contact WHERE id = ?')
            .bind(contactId)
            .first();
        if (!target) {
            return Response.json({ ok: false, error: 'Contact not found.' }, { status: 404 });
        }

        const source = await env.DB
            .prepare(`
                SELECT e.sender, e.sent_at, e.subject, e.body, e.cc, e.to_addrs,
                       e.recipient, e.from_addr,
                       c.name AS src_name, c.email AS src_email
                FROM email e JOIN contact c ON c.id = e.contact_id
                WHERE e.id = ?
            `)
            .bind(sourceId)
            .first<SourceEmail>();
        if (!source) {
            return Response.json({ ok: false, error: 'Source email not found.' }, { status: 404 });
        }
        if (source.sent_at === null) {
            return Response.json({ ok: false, error: 'Drafts cannot be forwarded.' }, { status: 400 });
        }

        // Mirror the client's "Re:" handling: collapse existing prefixes so a
        // twice-forwarded message does not become "Fwd: Fwd: ...".
        const subject = source.subject === null
            ? null
            : ('Fwd: ' + source.subject.replace(/^((Fwd|Fw):\s*)+/i, '')).slice(0, 500);

        const senderName = env.ORG_NAME || 'Mistflame';
        // Outbound sources were sent by us; inbound ones by the contact,
        // except bounces, where from_addr holds the reporting MTA (no
        // display name is known for it).
        const fromLine = source.sender !== null
            ? `${senderName} <${source.sender}>`
            : source.from_addr ?? `${source.src_name} <${source.src_email}>`;
        const dateLine = new Date(source.sent_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
        const toLine = source.to_addrs
            ?? (source.sender !== null ? source.src_email : source.recipient ?? '');

        const header = [
            '---------- Forwarded message ----------',
            `From: ${fromLine}`,
            `Date: ${dateLine}`,
            `Subject: ${source.subject ?? '(no subject)'}`,
            `To: ${toLine}`,
            ...(source.cc ? [`Cc: ${source.cc}`] : []),
        ].join('\n');
        let draftBody = `${header}\n\n${source.body}`;
        if (draftBody.length > 100_000) {
            draftBody = draftBody.slice(0, 99_970) + '\n\n[message truncated]';
        }

        const result = await env.DB
            .prepare('INSERT INTO email (contact_id, parent_id, sender, subject, body) VALUES (?, NULL, ?, ?, ?)')
            .bind(contactId, sender, subject, draftBody)
            .run();
        const emailId = result.meta.last_row_id;

        // Copy the source's ordinary attachments. Inline (cid:) parts are
        // skipped: the forwarded body is plain text, so they would surface
        // as meaningless files. Objects are copied to fresh keys, never
        // shared: the delete cascades remove R2 objects by key.
        const { results: sourceAtts } = await env.DB
            .prepare('SELECT file_name, content_type, r2_key, size FROM attachment WHERE email_id = ? AND inline = 0')
            .bind(sourceId)
            .all<SourceAttachment>();

        let copied = 0;
        let failed = 0;
        for (const att of sourceAtts) {
            const obj = await env.ATTACHMENTS.get(att.r2_key);
            if (!obj) {
                failed++;
                continue;
            }
            const r2Key = `${emailId}/${crypto.randomUUID()}-${att.file_name}`;
            await env.ATTACHMENTS.put(r2Key, await obj.arrayBuffer(), {
                httpMetadata: { contentType: att.content_type },
            });
            await env.DB
                .prepare('INSERT INTO attachment (email_id, file_name, content_type, r2_key, size) VALUES (?, ?, ?, ?, ?)')
                .bind(emailId, att.file_name, att.content_type, r2Key, att.size)
                .run();
            copied++;
        }

        return Response.json({
            ok: true,
            email_id: emailId,
            attachments_copied: copied,
            attachments_failed: failed,
        }, { status: 201 });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ ok: false, error: message }, { status: 500 });
    }
}
