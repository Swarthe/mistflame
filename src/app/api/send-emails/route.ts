import { getCloudflareContext } from '@opennextjs/cloudflare';

interface PendingEmail {
    id: number;
    sender: string;
    subject: string | null;
    body: string;
    cc: string | null;
    parent_id: number | null;
    parent_message_id: string | null;
    parent_body: string | null;
    parent_body_html: string | null;
    parent_sent_at: string | null;
    contact_name: string;
    contact_email: string;
}

interface DbAttachment {
    id: number;
    email_id: number;
    filename: string;
    content_type: string;
    r2_key: string;
}

const generateMessageId = (domain: string) =>
    `${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}`;

function toBase64Lines(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))));
    }
    const base64 = btoa(binary);
    return base64.match(/.{1,76}/g)?.join('\r\n') ?? base64;
}

/**
 * The text and HTML renditions of the same message. Base64 for the HTML part so
 * that non-ASCII content survives regardless of the receiving server's 8BITMIME
 * support; the text part keeps the encoding it has always used.
 */
function alternativeLines(boundary: string, body: string, htmlBody: string): string[] {
    return [
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        body,
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        toBase64Lines(new TextEncoder().encode(htmlBody)),
        `--${boundary}--`,
    ];
}

function buildRaw(
    headerLines: string[],
    body: string,
    htmlBody: string | null,
    attachments: { filename: string; content_type: string; data: ArrayBuffer }[]
): string {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const altBoundary = `----=_Alt_${unique}`;

    if (attachments.length === 0) {
        if (htmlBody === null) {
            return [
                ...headerLines,
                'MIME-Version: 1.0',
                'Content-Type: text/plain; charset=UTF-8',
                '',
                body,
            ].join('\r\n');
        }
        return [
            ...headerLines,
            'MIME-Version: 1.0',
            ...alternativeLines(altBoundary, body, htmlBody),
        ].join('\r\n');
    }

    const boundary = `----=_Boundary_${unique}`;
    const lines: string[] = [
        ...headerLines,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
    ];

    // With an HTML alternative the message body becomes a nested
    // multipart/alternative as the first part of the multipart/mixed.
    if (htmlBody === null) {
        lines.push('Content-Type: text/plain; charset=UTF-8', '', body);
    } else {
        lines.push(...alternativeLines(altBoundary, body, htmlBody));
    }

    for (const att of attachments) {
        const safeName = att.filename.replace(/["\r\n]/g, '_');
        lines.push(
            `--${boundary}`,
            `Content-Type: ${att.content_type}; name="${safeName}"`,
            `Content-Disposition: attachment; filename="${safeName}"`,
            'Content-Transfer-Encoding: base64',
            '',
            toBase64Lines(att.data),
        );
    }

    lines.push(`--${boundary}--`);
    return lines.join('\r\n');
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * The composed reply itself is always plain text: the composer is a textarea, so
 * the HTML rendition of our own words is just escaped text with line breaks. Only
 * the quoted history below it carries real markup.
 */
function textToHtml(text: string): string {
    return escapeHtml(text.replace(/\r\n/g, '\n')).split('\n').join('<br>\n');
}

/**
 * Prepare a stored fragment for nesting inside an outgoing reply.
 *
 * body_html keeps <style> blocks so the message frame can apply them, but a
 * quoted one would apply to the whole outgoing message in the recipient's client:
 * the sender's `body { display: none }` would hide our reply along with the
 * quote. <script> cannot reach body_html through htmlToFragment, and is stripped
 * here too so a fragment written by any other means cannot pass one on.
 *
 * cid: images are dropped because their Content-ID belongs to the message we
 * received, not the one we are sending: left in, every one is a guaranteed broken
 * image in the recipient's client. A full mail client re-attaches the inline
 * parts as multipart/related when quoting; doing that here would mean pulling
 * each part back out of R2 and nesting another multipart level, which is not
 * worth it to show someone their own logo inside their own quoted message.
 */
function quotableHtml(fragment: string): string {
    return fragment
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<img\b[^>]*\bsrc\s*=\s*(["'])\s*cid:[^"']*\1[^>]*>/gi, '')
        .trim();
}

export async function GET() {
    const { env } = await getCloudflareContext({ async: true });
    const row = await env.DB
        .prepare(`
            SELECT COUNT(*) AS count FROM email e
            LEFT JOIN email p ON p.id = e.parent_id
            WHERE e.sender IS NOT NULL AND e.sent_at IS NULL
              AND (e.parent_id IS NULL OR p.sent_at IS NOT NULL)
        `)
        .first<{ count: number }>();
    return Response.json({ ok: true, count: row?.count ?? 0 });
}

export async function POST(request: Request) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const emailId = body?.email_id != null ? parseInt(String(body.email_id), 10) : null;

    if (emailId !== null && isNaN(emailId)) {
        return Response.json({ ok: false, error: 'Invalid email_id.' }, { status: 400 });
    }

    const { env } = await getCloudflareContext({ async: true });

    const validAddrs = (env.SEND_ADDRS ?? '').split(',').map((a: string) => a.trim()).filter(Boolean);
    const senderName = env.ORG_NAME || 'Mistflame';

    const baseQuery = `
        SELECT e.id, e.sender, e.subject, e.body, e.cc, e.parent_id,
               p.message_id AS parent_message_id,
               p.body AS parent_body, p.body_html AS parent_body_html,
               p.sent_at AS parent_sent_at,
               c.name AS contact_name, c.email AS contact_email
        FROM email e
        JOIN contact c ON e.contact_id = c.id
        LEFT JOIN email p ON p.id = e.parent_id
        WHERE e.sender IS NOT NULL AND e.sent_at IS NULL
          AND (e.parent_id IS NULL OR p.sent_at IS NOT NULL)
    `;

    const { results: emails } = emailId !== null
        ? await env.DB.prepare(baseQuery + ' AND e.id = ?').bind(emailId).all<PendingEmail>()
        : await env.DB.prepare(baseQuery).all<PendingEmail>();

    if (emails.length === 0) {
        return Response.json({ ok: true, sent: 0, failed: 0, errors: [] });
    }

    const pendingIds = emails.map(e => e.id);
    const { results: allAttachments } = await env.DB
        .prepare(`SELECT id, email_id, file_name AS filename, content_type, r2_key FROM attachment WHERE email_id IN (${pendingIds.map(() => '?').join(',')})`)
        .bind(...pendingIds)
        .all<DbAttachment>();

    const attachmentsByEmail = new Map<number, DbAttachment[]>();
    for (const att of allAttachments) {
        const list = attachmentsByEmail.get(att.email_id) ?? [];
        list.push(att);
        attachmentsByEmail.set(att.email_id, list);
    }

    const cfEmailMod = await import(('cloudflare' + ':email') as unknown as string);
    const sentAt = new Date().toISOString();
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const email of emails) {
        const from = email.sender;
        if (!validAddrs.includes(from)) {
            errors.push(`${email.contact_name}: sender address ${from} is no longer valid`);
            failed++;
            continue;
        }
        try {
            const fromDomain = from.split('@')[1] ?? 'example.com';
            const msgId = generateMessageId(fromDomain);
            const safeName = email.contact_name.replace(/[<>\\\r\n]/g, '');
            const safeSubject = (email.subject ?? '(no subject)').replace(/[\r\n]/g, ' ');
            let bodyNormalised = email.body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
            let bodyForStorage: string | null = null;
            // Only a reply to a message that had HTML gets an HTML rendition; a
            // thread that started as plain text stays plain text throughout.
            let htmlBody: string | null = null;
            if (email.parent_body !== null) {
                const when = email.parent_sent_at
                    ? new Date(email.parent_sent_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                    : 'earlier';
                const quotedLines = email.parent_body
                    .replace(/\r\n/g, '\n')
                    .split('\n')
                    .map(line => `> ${line}`)
                    .join('\n');
                const quoteBlock = `\n\nOn ${when}, ${email.contact_name} wrote:\n${quotedLines}`;
                bodyNormalised += quoteBlock.replace(/\n/g, '\r\n');
                bodyForStorage = email.body.replace(/\r\n/g, '\n').trimEnd() + quoteBlock;

                if (email.parent_body_html !== null) {
                    // Our own words as plain escaped text, then the parent's own
                    // markup nested in a blockquote, so the recipient sees their
                    // message quoted as they wrote it rather than flattened to
                    // text. This is what a full mail client does.
                    htmlBody = [
                        `<div>${textToHtml(email.body.replace(/\r\n/g, '\n').trimEnd())}</div>`,
                        '<br>',
                        `<div>On ${escapeHtml(when)}, ${escapeHtml(email.contact_name)} wrote:</div>`,
                        '<blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">',
                        quotableHtml(email.parent_body_html),
                        '</blockquote>',
                    ].join('\n');
                }
            }

            const headerLines = [
                `From: ${senderName} <${from}>`,
                `To: ${safeName} <${email.contact_email}>`,
                `Message-ID: <${msgId}>`,
                `Subject: ${safeSubject}`,
            ];

            if (email.cc) {
                headerLines.push(`Cc: ${email.cc.replace(/[\r\n]/g, ' ')}`);
            }
            if (email.parent_message_id) {
                headerLines.push(`In-Reply-To: <${email.parent_message_id}>`);
                headerLines.push(`References: <${email.parent_message_id}>`);
            }

            const dbAtts = attachmentsByEmail.get(email.id) ?? [];
            const attachmentData: { filename: string; content_type: string; data: ArrayBuffer }[] = [];
            for (const att of dbAtts) {
                const obj = await env.ATTACHMENTS.get(att.r2_key);
                if (obj) {
                    attachmentData.push({ filename: att.filename, content_type: att.content_type, data: await obj.arrayBuffer() });
                }
            }

            const raw = buildRaw(headerLines, bodyNormalised, htmlBody, attachmentData);
            await env.EMAIL_SENDER.send(new cfEmailMod.EmailMessage(from, email.contact_email, raw));

            if (email.cc) {
                const ccAddrs = email.cc.split(',').map((a: string) => a.trim()).filter(Boolean);
                for (const addr of ccAddrs) {
                    await env.EMAIL_SENDER.send(new cfEmailMod.EmailMessage(from, addr, raw));
                }
            }

            if (bodyForStorage !== null) {
                // The plain-text rendition with the quote appended is stored; the
                // generated HTML deliberately is not. Nothing needs it: our own
                // messages display as plain text, and a reply always parents an
                // inbound email (the + Reply button only appears on those), so the
                // HTML a reply nests is always the contact's, never ours.
                //
                // Not storing it also keeps this UPDATE small. It runs *after* the
                // send, so a row that had grown too large to write would leave the
                // message unmarked and resend it on the next attempt.
                await env.DB
                    .prepare('UPDATE email SET sent_at = ?, message_id = ?, body = ? WHERE id = ?')
                    .bind(sentAt, msgId, bodyForStorage, email.id)
                    .run();
            } else {
                await env.DB
                    .prepare('UPDATE email SET sent_at = ?, message_id = ? WHERE id = ?')
                    .bind(sentAt, msgId, email.id)
                    .run();
            }

            sent++;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${email.contact_name}: ${msg}`);
            failed++;
        }
    }

    return Response.json({ ok: true, sent, failed, errors });
}
