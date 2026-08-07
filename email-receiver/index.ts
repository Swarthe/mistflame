import PostalMime from 'postal-mime';
import { htmlToText, htmlToFragment } from '../src/lib/html-to-text.mjs';
import { encodeHeaderText, extractMessageIds, generateMessageId, rfc2822Date } from '../src/lib/mime';
import { isValidEmail } from '../src/lib/server/validation';

// Oversized HTML is dropped rather than truncated: a half-written fragment would
// render as broken markup. The plain-text body is still stored.
const MAX_BODY_HTML = 500_000;

interface Env {
    DB: D1Database;
    ATTACHMENTS: R2Bucket;
    EMAIL_SENDER: SendEmail;
    KV?: KVNamespace;
    NOTIFY_ADDRS?: string;
    NOTIFY_MAP?: string;
    RATE_LIMIT_MAX?: string;
    RATE_LIMIT_WINDOW_MINUTES?: string;
}

// One plain-text message, built the same way for the notification and the
// rate-warning emails. The subject is RFC 2047-encoded (contact names are
// routinely non-ASCII) and the body declares 8bit, since previews carry raw
// 8-bit text.
const buildPlainRaw = (from: string, to: string, subject: string, bodyLines: string[]) => [
    `From: <${from}>`,
    `To: <${to}>`,
    `Date: ${rfc2822Date(new Date())}`,
    `Message-ID: <${generateMessageId(from.split('@')[1] ?? 'localhost')}>`,
    `Subject: ${encodeHeaderText(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    ...bodyLines,
].join('\r\n');

// Bounds on the stored References chain: enough ids for any real thread while
// keeping the column, and the header rebuilt from it at send time, small.
const MAX_REF_IDS = 10;
const MAX_REFS_LENGTH = 2000;

// Bound on a stored address list (To or CC): a pathological header cannot
// bloat the row; trailing addresses are dropped once the joined string
// exceeds it.
const MAX_ADDR_LIST = 2000;

// NOTIFY_MAP routes notifications by receiving address: a JSON object mapping
// an inbound address (the envelope recipient, matched case-insensitively) to
// the list of addresses to notify. An address with no entry notifies all of
// NOTIFY_ADDRS, so the map only needs entries that narrow the default; an
// empty list mutes that address. A malformed map falls back to notifying
// everyone, with a warning line in the notification body, because a config
// typo must over-notify rather than silently drop notifications.
const resolveNotifyAddrs = (
    env: Env,
    recipient: string,
): { addrs: string[]; warning: string | null } => {
    const all = (env.NOTIFY_ADDRS ?? '').split(',').map(a => a.trim()).filter(Boolean);
    const raw = env.NOTIFY_MAP?.trim();
    if (!raw) return { addrs: all, warning: null };
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { addrs: all, warning: 'NOTIFY_MAP is not valid JSON; notifying all NOTIFY_ADDRS.' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { addrs: all, warning: 'NOTIFY_MAP is not a JSON object; notifying all NOTIFY_ADDRS.' };
    }
    const map: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
            return { addrs: all, warning: `NOTIFY_MAP entry for "${key}" is not a list of strings; notifying all NOTIFY_ADDRS.` };
        }
        map[key.trim().toLowerCase()] = value.map(a => a.trim()).filter(Boolean);
    }
    const entry = map[recipient];
    return entry !== undefined
        ? { addrs: entry, warning: null }
        : { addrs: all, warning: null };
};

const joinAddrs = (list?: { address?: string }[]) => {
    const addrs = (list ?? [])
        .map(a => a.address)
        .filter((a): a is string => !!a);
    while (addrs.length > 1 && addrs.join(', ').length > MAX_ADDR_LIST) {
        addrs.pop();
    }
    return addrs.join(', ') || null;
};

export default {
    async email(message: ForwardableEmailMessage, env: Env) {
        const rateMax = parseInt(env.RATE_LIMIT_MAX ?? '0', 10);
        if (rateMax > 0 && env.KV) {
            const windowMinutes = parseInt(env.RATE_LIMIT_WINDOW_MINUTES ?? '60', 10);
            const bucket = Math.floor(Date.now() / (windowMinutes * 60_000));
            const kvKey = `rate:inbound:${bucket}`;
            const ttl = windowMinutes * 2 * 60;
            const current = parseInt(await env.KV.get(kvKey) ?? '0', 10);
            if (current >= rateMax) {
                const warnKey = `rate:warned:${bucket}`;
                const alreadyWarned = await env.KV.get(warnKey);
                if (!alreadyWarned) {
                    await env.KV.put(warnKey, '1', { expirationTtl: ttl });
                    const notifyAddrs = (env.NOTIFY_ADDRS ?? '').split(',').map(a => a.trim()).filter(Boolean);
                    if (notifyAddrs.length > 0) {
                        const from = message.to.toLowerCase();
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const cfEmail = await import(('cloudflare' + ':email') as any);
                        for (const addr of notifyAddrs) {
                            const warnRaw = buildPlainRaw(from, addr, 'Inbound rate limit reached', [
                                'The inbound email rate limit has been reached. Further emails will be discarded until the next window.',
                                '',
                                `Limit: ${rateMax} emails per ${windowMinutes} minutes`,
                            ]);
                            try {
                                await env.EMAIL_SENDER.send(new cfEmail.EmailMessage(from, addr, warnRaw));
                            } catch { /* ignore */ }
                        }
                    }
                }
                return;
            }
            await env.KV.put(kvKey, String(current + 1), { expirationTtl: ttl });
        }

        const rawBuffer = await new Response(message.raw).arrayBuffer();
        const parsed = await new PostalMime().parse(rawBuffer);

        // Contact identity comes from the From: header, not the envelope
        // sender (message.from): bulk senders put a unique VERP bounce
        // address in the envelope, which used to create a contact per
        // sender, or per message for SES. Standard clients key on the
        // header too. The envelope remains as a fallback for a missing
        // or malformed header.
        const headerFrom = parsed.from?.address?.trim().toLowerCase() ?? '';
        const fromEmail = isValidEmail(headerFrom)
            ? headerFrom
            : message.from.toLowerCase();
        const msgId = parsed.messageId ? parsed.messageId.replace(/^<|>$/g, '').trim() : null;
        const rawInReplyTo = parsed.inReplyTo?.trim() ?? null;
        const inReplyTo = rawInReplyTo
            ? extractMessageIds(rawInReplyTo)[0] ?? rawInReplyTo
            : null;
        const subject = parsed.subject ?? null;

        // Reply-To is stored only when it names a different address than From;
        // equal to From it adds nothing, and the send path falls back anyway.
        const rawReplyTo = parsed.replyTo?.[0]?.address?.trim() ?? '';
        const replyTo = isValidEmail(rawReplyTo) && rawReplyTo.toLowerCase() !== fromEmail
            ? rawReplyTo
            : null;

        // The References chain, normalised and trimmed from the old end: a
        // reply we send extends it with the parent's own Message-ID, so only
        // the recent ids matter for threading.
        let refIds = extractMessageIds(parsed.references).slice(-MAX_REF_IDS);
        while (refIds.length && refIds.join(' ').length > MAX_REFS_LENGTH) {
            refIds = refIds.slice(1);
        }
        const referencesHdr = refIds.length
            ? refIds.map(id => `<${id}>`).join(' ')
            : null;

        // body is the canonical plain-text rendition and is always populated;
        // body_html holds the HTML alternative as a nestable fragment. When the
        // sender supplied no text/plain part, the text is derived from the HTML
        // rather than storing markup in body.
        let bodyHtml = htmlToFragment(parsed.html);
        if (bodyHtml !== null && bodyHtml.length > MAX_BODY_HTML) bodyHtml = null;
        const body = (parsed.text ?? '').trim() || htmlToText(parsed.html);

        let contact: { id: number; name: string } | null = null;
        let parentId: number | null = null;
        let fromAddr: string | null = null;

        // Bounce (DSN) handling: thread the notification onto the message that
        // bounced instead of filing it under a new mailer-daemon contact. The
        // DSN carries the original message's headers (as a message/rfc822 or
        // text/rfc822-headers part, which RFC 2046 forbids base64-encoding),
        // so the Message-ID we generated at send time appears in the raw
        // bytes; In-Reply-To and References cover DSNs that set those instead.
        // A bounce whose original cannot be found falls through to the normal
        // flow and behaves as before.
        const isBounce =
            (parsed.attachments ?? []).some(a => a.mimeType?.toLowerCase() === 'message/delivery-status')
            || /^(mailer-daemon|postmaster)@/i.test(fromEmail);
        if (isBounce) {
            const rawText = new TextDecoder('utf-8', { fatal: false }).decode(rawBuffer);
            const scanned = Array.from(
                rawText.matchAll(/Message-ID:\s*<([^<>\s]+)>/gi), m => m[1]);
            const candidates = [...new Set(
                [inReplyTo, ...extractMessageIds(parsed.references), ...scanned]
                    .filter((id): id is string => !!id && id !== msgId)
            )].slice(0, 20);
            if (candidates.length > 0) {
                const original = await env.DB
                    .prepare(`SELECT id, contact_id FROM email WHERE sender IS NOT NULL AND message_id IN (${candidates.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`)
                    .bind(...candidates)
                    .first<{ id: number; contact_id: number }>();
                if (original) {
                    contact = await env.DB
                        .prepare('SELECT id, name FROM contact WHERE id = ?')
                        .bind(original.contact_id)
                        .first<{ id: number; name: string }>();
                    if (contact) {
                        parentId = original.id;
                        fromAddr = fromEmail;
                    }
                }
            }
        }

        if (!contact) {
            contact = await env.DB
                .prepare('SELECT id, name FROM contact WHERE LOWER(email) = ?')
                .bind(fromEmail)
                .first<{ id: number; name: string }>();
        }

        if (!contact) {
            const contactName = parsed.from?.name?.trim() || fromEmail;
            await env.DB
                .prepare('INSERT OR IGNORE INTO contact (name, email) VALUES (?, ?)')
                .bind(contactName, fromEmail)
                .run();
            contact = await env.DB
                .prepare('SELECT id, name FROM contact WHERE LOWER(email) = ?')
                .bind(fromEmail)
                .first<{ id: number; name: string }>();
            if (!contact) return;
        }

        // 1. Match by In-Reply-To against stored message_id (set at send time)
        if (parentId === null && inReplyTo) {
            const parent = await env.DB
                .prepare('SELECT id FROM email WHERE message_id = ? AND contact_id = ?')
                .bind(inReplyTo, contact.id)
                .first<{ id: number }>();
            if (parent) parentId = parent.id;
        }

        // 2. References fallback: some clients omit In-Reply-To or point it at
        // a message that never passed through here, while References still
        // lists ids we stored. The most recent id in the chain that matches
        // one of ours wins, since References runs oldest to newest.
        if (parentId === null && refIds.length > 0) {
            const { results: matches } = await env.DB
                .prepare(`SELECT id, message_id FROM email WHERE contact_id = ? AND message_id IN (${refIds.map(() => '?').join(',')})`)
                .bind(contact.id, ...refIds)
                .all<{ id: number; message_id: string }>();
            for (let i = refIds.length - 1; i >= 0 && parentId === null; i--) {
                const hit = matches.find(m => m.message_id === refIds[i]);
                if (hit) parentId = hit.id;
            }
        }

        // 3. Subject fallback for contacts replying without In-Reply-To or with no match.
        // Match against both the bare normalised subject and the "Re: <normalised>" form,
        // since outbound reply subjects are stored with the "Re: " prefix already applied.
        // Only sent rows qualify: a contact cannot be replying to a message that has not
        // gone out, so an unsent draft that happens to share the subject must not become
        // the parent.
        if (parentId === null && subject) {
            const normalised = subject.replace(/^(Re:\s*|Fwd?:\s*)+/gi, '').trim();
            if (normalised) {
                const parent = await env.DB
                    .prepare("SELECT id FROM email WHERE contact_id = ? AND sender IS NOT NULL AND sent_at IS NOT NULL AND (subject = ? OR subject = 'Re: ' || ?) ORDER BY id DESC LIMIT 1")
                    .bind(contact.id, normalised, normalised)
                    .first<{ id: number }>();
                if (parent) parentId = parent.id;
            }
        }

        const recipient = message.to.toLowerCase();
        const cc = joinAddrs(parsed.cc);
        // The full parsed To: header list; the envelope address that routed
        // the message here stays in `recipient`. Co-recipients feed Reply All.
        const toAddrs = joinAddrs(parsed.to);

        const result = await env.DB
            .prepare('INSERT INTO email (contact_id, parent_id, sender, sent_at, subject, body, body_html, message_id, recipient, cc, to_addrs, reply_to, references_hdr, from_addr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(contact.id, parentId, null, new Date().toISOString(), subject, body.trim(), bodyHtml, msgId, recipient, cc, toAddrs, replyTo, referencesHdr, fromAddr)
            .run();

        const emailId = result.meta.last_row_id;

        for (const att of parsed.attachments ?? []) {
            if (!att.content) continue;
            const filename = att.filename ?? 'attachment';
            const contentType = att.mimeType ?? 'application/octet-stream';
            const contentId = att.contentId ? att.contentId.replace(/^<|>$/g, '') : null;
            // Only hide a related part from the attachment list once we know the
            // body actually references it; an unreferenced one would otherwise
            // vanish from the UI entirely.
            const isInline = !!(att.related && contentId && bodyHtml?.includes(contentId));
            const r2Key = `${emailId}/${crypto.randomUUID()}-${filename}`;
            const data = att.content instanceof Uint8Array ? att.content : new Uint8Array(att.content as ArrayBuffer);
            if (data.byteLength > 10 * 1024 * 1024) continue;
            await env.ATTACHMENTS.put(r2Key, data, {
                httpMetadata: { contentType },
            });
            await env.DB
                .prepare('INSERT INTO attachment (email_id, file_name, content_type, r2_key, size, content_id, inline) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .bind(emailId, filename, contentType, r2Key, data.byteLength, contentId, isInline ? 1 : 0)
                .run();
        }

        const { addrs: notifyAddrs, warning: notifyWarning } =
            resolveNotifyAddrs(env, recipient);
        if (notifyAddrs.length === 0) return;

        const safeSubject = (subject ?? '(no subject)').replace(/[\r\n]/g, ' ');
        const bodyText = body.trim();
        const preview = bodyText.length > 500 ? bodyText.slice(0, 500) + `\n\n[+${bodyText.length - 500} characters]` : bodyText;
        // A bounce is filed under the original recipient's contact, so name the
        // actual sender (the reporting MTA) rather than the contact.
        const displayFrom = fromAddr !== null
            ? (parsed.from?.name?.trim() ? `${parsed.from.name.trim()} <${fromEmail}>` : fromEmail)
            : contact.name !== fromEmail ? `${contact.name} <${fromEmail}>` : fromEmail;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cfEmail = await import(('cloudflare' + ':email') as any);
        const notifySubject = `New message from ${displayFrom.replace(/[\r\n]/g, '')}`;
        for (const addr of notifyAddrs) {
            const notifyRaw = buildPlainRaw(recipient, addr, notifySubject, [
                ...(notifyWarning ? [`[mistflame] ${notifyWarning}`, ''] : []),
                `From:    ${displayFrom}`,
                `To:      ${recipient}`,
                `Subject: ${safeSubject}`,
                '',
                '---',
                '',
                preview,
            ]);
            try {
                await env.EMAIL_SENDER.send(new cfEmail.EmailMessage(recipient, addr, notifyRaw));
            } catch { /* notification failure must not affect inbound processing */ }
        }
    },
};
