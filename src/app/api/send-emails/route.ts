import { getCloudflareContext } from '@opennextjs/cloudflare';
import { encodeHeaderText, extractMessageIds, generateMessageId, rfc2822Date } from '@/lib/mime';
import { renderMarkdown } from '@/lib/markdown';
import { isValidEmail, parseAddrList } from '@/lib/server/validation';

interface PendingEmail {
    id: number;
    sender: string;
    subject: string | null;
    body: string;
    body_format: string;
    cc: string | null;
    to_addrs: string | null;
    bcc: string | null;
    parent_id: number | null;
    parent_message_id: string | null;
    parent_body: string | null;
    parent_body_html: string | null;
    parent_sent_at: string | null;
    parent_reply_to: string | null;
    parent_references: string | null;
    contact_name: string;
    contact_email: string;
}

// The References header sent on a reply is the parent's chain plus the
// parent's own Message-ID, trimmed from the old end; threading only needs the
// recent ids, and an unbounded chain would eventually overrun header limits.
const MAX_REF_IDS = 10;

interface DbAttachment {
    id: number;
    email_id: number;
    filename: string;
    content_type: string;
    r2_key: string;
}

// A draft is pending once it is outgoing, unsent, and not a reply to a parent
// that has not itself been sent. Shared by the GET count and the send query,
// so the badge can never disagree with what a send would pick up. Requires
// `email e` with `LEFT JOIN email p ON p.id = e.parent_id` in scope.
const PENDING_WHERE = `
    WHERE e.sender IS NOT NULL AND e.sent_at IS NULL
      AND (e.parent_id IS NULL OR p.sent_at IS NOT NULL)
`;

/**
 * RFC 2045 token "/" token. Attachment content types come from the uploader's
 * browser via file.type, so anything that does not look like a media type is
 * replaced before it can reach a raw MIME header.
 */
const MIME_TYPE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

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
 * support; the text part stays readable in the raw message and declares 8bit,
 * since undeclared non-ASCII defaults to 7bit and may be mangled in transit.
 */
function alternativeLines(boundary: string, body: string, htmlBody: string): string[] {
    return [
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
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
                'Content-Transfer-Encoding: 8bit',
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
        lines.push(
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
            '',
            body,
        );
    } else {
        lines.push(...alternativeLines(altBoundary, body, htmlBody));
    }

    for (const att of attachments) {
        const safeName = att.filename.replace(/["\r\n]/g, '_');
        const safeType = MIME_TYPE.test(att.content_type)
            ? att.content_type
            : 'application/octet-stream';
        lines.push(
            `--${boundary}`,
            `Content-Type: ${safeType}; name="${safeName}"`,
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
 * The HTML rendition of a plain-text composition (or of a plain-text parent
 * quoted under a markdown reply): escaped text with line breaks. Markdown
 * compositions go through renderMarkdown instead.
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
        ` + PENDING_WHERE)
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

    const validAddrs = parseAddrList(env.SEND_ADDRS);
    const senderName = env.ORG_NAME || 'Mistflame';

    const baseQuery = `
        SELECT e.id, e.sender, e.subject, e.body, e.body_format,
               e.cc, e.to_addrs, e.bcc,
               e.parent_id,
               p.message_id AS parent_message_id,
               p.body AS parent_body, p.body_html AS parent_body_html,
               p.sent_at AS parent_sent_at,
               p.reply_to AS parent_reply_to,
               p.references_hdr AS parent_references,
               c.name AS contact_name, c.email AS contact_email
        FROM email e
        JOIN contact c ON e.contact_id = c.id
        LEFT JOIN email p ON p.id = e.parent_id
    ` + PENDING_WHERE;

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
        // Set once the row is claimed (sent_at written) and once the contact's
        // copy has actually gone out; the catch block uses them to decide
        // whether releasing the claim is safe.
        let claimed = false;
        let delivered = false;
        try {
            const fromDomain = from.split('@')[1] ?? 'example.com';
            const msgId = generateMessageId(fromDomain);

            // A reply goes to the parent's Reply-To when the contact's client
            // set one (shared mailboxes, "on behalf of" senders); it was
            // validated at ingest, but is re-checked so a row written by any
            // other means cannot smuggle header syntax into To:.
            const deliveryAddr = email.parent_reply_to && isValidEmail(email.parent_reply_to)
                ? email.parent_reply_to
                : email.contact_email;

            // One dedupe set spans To extras, CC and BCC: seeded with the
            // primary address and the contact, drained as each list is
            // walked, so an address gets exactly one copy however many
            // fields list it.
            const alreadySent = new Set([deliveryAddr.toLowerCase(), email.contact_email.toLowerCase()]);
            const takeNew = (list: string | null) =>
                (list ?? '').split(',').map((a: string) => a.trim()).filter(Boolean)
                    .filter((a: string) => {
                        const key = a.toLowerCase();
                        if (alreadySent.has(key)) return false;
                        alreadySent.add(key);
                        return true;
                    });
            const extraTo = takeNew(email.to_addrs);
            const fullTo = [deliveryAddr, ...extraTo].join(', ');

            // Claim the row before sending, so two requests handling the same
            // pending draft cannot both deliver it: the conditional UPDATE is
            // atomic, and whichever request matches zero rows backs off. A
            // failed send releases the claim below, so the retry behaviour is
            // unchanged; the residual risk is a crash between here and the
            // send, which leaves the row marked sent but undelivered. That is
            // the right way round to be wrong: with concurrent users, the
            // double send is the likelier and the worse failure. The claim
            // also snapshots the full delivered To list into to_addrs, so a
            // sent row records where the mail actually went even if the
            // contact's address is edited later; the release below restores
            // the draft's own extras.
            const claim = await env.DB
                .prepare('UPDATE email SET sent_at = ?, message_id = ?, to_addrs = ? WHERE id = ? AND sent_at IS NULL')
                .bind(sentAt, msgId, fullTo, email.id)
                .run();
            if (!claim.meta.changes) {
                continue;
            }
            claimed = true;

            const safeName = email.contact_name.replace(/[<>\\\r\n]/g, '');
            const safeSubject = (email.subject ?? '(no subject)').replace(/[\r\n]/g, ' ');
            const isMarkdown = email.body_format === 'markdown';
            const composedText = email.body.replace(/\r\n/g, '\n').trimEnd();
            // Our own words in the HTML rendition: rendered markdown, or
            // escaped text with <br> line breaks.
            const composedHtml = isMarkdown
                ? renderMarkdown(composedText)
                : `<div>${textToHtml(composedText)}</div>`;
            let bodyNormalised = email.body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
            let bodyForStorage: string | null = null;
            // A plain-text email gets an HTML rendition only when replying to
            // a message that had one, so a thread that started as plain text
            // stays plain text; a markdown email always carries one, since
            // the markup is the point. Its text/plain part is the markdown
            // source, which reads naturally as plain text.
            let htmlBody: string | null = isMarkdown ? composedHtml : null;
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

                if (email.parent_body_html !== null || isMarkdown) {
                    // The parent's own markup nested in a blockquote, so the
                    // recipient sees their message quoted as they wrote it
                    // rather than flattened to text; a plain-text parent under
                    // a markdown reply is quoted as escaped text instead. This
                    // is what a full mail client does.
                    const quotedHtml = email.parent_body_html !== null
                        ? quotableHtml(email.parent_body_html)
                        : `<div>${textToHtml(email.parent_body.replace(/\r\n/g, '\n').trimEnd())}</div>`;
                    htmlBody = [
                        composedHtml,
                        '<br>',
                        `<div>On ${escapeHtml(when)}, ${escapeHtml(email.contact_name)} wrote:</div>`,
                        '<blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">',
                        quotedHtml,
                        '</blockquote>',
                    ].join('\n');
                }
            }

            // CR/LF is stripped above; encodeHeaderText handles non-ASCII, which
            // would otherwise ride on undeclared 8-bit bytes in the headers.
            // Extra To addresses were validated at POST/PATCH; the strip is
            // defensive, matching the Cc line. BCC never gets a header.
            const headerLines = [
                `From: ${encodeHeaderText(senderName)} <${from}>`,
                `To: ${[`${encodeHeaderText(safeName)} <${deliveryAddr}>`, ...extraTo].join(', ').replace(/[\r\n]/g, ' ')}`,
                `Date: ${rfc2822Date(new Date())}`,
                `Message-ID: <${msgId}>`,
                `Subject: ${encodeHeaderText(safeSubject)}`,
            ];

            if (email.cc) {
                headerLines.push(`Cc: ${email.cc.replace(/[\r\n]/g, ' ')}`);
            }
            if (email.parent_message_id) {
                // The parent is an inbound row, so its message_id came off the
                // wire; strip anything that could break out of the <> block.
                const parentMsgId = email.parent_message_id.replace(/[<>\s]/g, '');
                headerLines.push(`In-Reply-To: <${parentMsgId}>`);
                // RFC 5322: a reply's References is the parent's References
                // followed by the parent's Message-ID. Folded one id per line,
                // which keeps every line well under the 998-character limit.
                const refIds = [...new Set([
                    ...extractMessageIds(email.parent_references),
                    parentMsgId,
                ])].slice(-MAX_REF_IDS);
                headerLines.push(`References: ${refIds.map(id => `<${id}>`).join('\r\n ')}`);
            }

            const dbAtts = attachmentsByEmail.get(email.id) ?? [];
            const attachmentData: { filename: string; content_type: string; data: ArrayBuffer }[] = [];
            for (const att of dbAtts) {
                const obj = await env.ATTACHMENTS.get(att.r2_key);
                if (!obj) {
                    // Sending without it would look complete to the recipient;
                    // failing here releases the claim and surfaces the error.
                    throw new Error(`attachment "${att.filename}" is missing from storage`);
                }
                attachmentData.push({ filename: att.filename, content_type: att.content_type, data: await obj.arrayBuffer() });
            }

            const raw = buildRaw(headerLines, bodyNormalised, htmlBody, attachmentData);
            await env.EMAIL_SENDER.send(new cfEmailMod.EmailMessage(from, deliveryAddr, raw));
            delivered = true;

            // The row was already marked sent by the claim above; only a reply
            // still needs its stored body rewritten with the quote appended.
            // The plain-text rendition is stored; the generated HTML
            // deliberately is not. Nothing needs it: our own messages display
            // as plain text, and a reply always parents an inbound email (the
            // + Reply button only appears on those), so the HTML a reply nests
            // is always the contact's, never ours. If this UPDATE fails the
            // row stays sent, with the composed body but without the quote; a
            // CC failure after this point likewise must not unsend the row,
            // or the next attempt would deliver the contact's copy twice.
            if (bodyForStorage !== null) {
                await env.DB
                    .prepare('UPDATE email SET body = ? WHERE id = ?')
                    .bind(bodyForStorage, email.id)
                    .run();
            }

            sent++;

            // Every further recipient gets the same raw bytes, one send per
            // address, drained through the shared dedupe set in order To,
            // CC, BCC (an address in both cc and bcc goes out once, as the
            // header-visible CC). Failures here are non-fatal: the contact's
            // copy is out, so the claim cannot be released.
            const copies = [
                ...extraTo.map((addr: string) => ({ kind: 'To', addr })),
                ...takeNew(email.cc).map((addr: string) => ({ kind: 'CC', addr })),
                ...takeNew(email.bcc).map((addr: string) => ({ kind: 'BCC', addr })),
            ];
            for (const { kind, addr } of copies) {
                try {
                    await env.EMAIL_SENDER.send(new cfEmailMod.EmailMessage(from, addr, raw));
                } catch (copyErr) {
                    const msg = copyErr instanceof Error ? copyErr.message : String(copyErr);
                    errors.push(`${email.contact_name}: ${kind} copy to ${addr} failed: ${msg}`);
                }
            }
        } catch (err) {
            // Release the claim only when the contact's copy never went out;
            // once delivered, the row must stay sent whatever failed after
            // (the body rewrite), or a retry would deliver it again. If the
            // release itself fails the row stays claimed, which errs on the
            // side of not sending twice.
            if (claimed && !delivered) {
                try {
                    // to_addrs goes back to the draft's own extras, undoing
                    // the full-list snapshot the claim wrote.
                    await env.DB
                        .prepare('UPDATE email SET sent_at = NULL, message_id = NULL, to_addrs = ? WHERE id = ?')
                        .bind(email.to_addrs, email.id)
                        .run();
                } catch {
                    // reported below either way
                }
            }
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${email.contact_name}: ${msg}`);
            failed++;
        }
    }

    return Response.json({ ok: true, sent, failed, errors });
}
