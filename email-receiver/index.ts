import PostalMime from 'postal-mime';

interface Env {
    DB: D1Database;
    ATTACHMENTS: R2Bucket;
    EMAIL_SENDER: SendEmail;
    KV?: KVNamespace;
    NOTIFY_ADDRS?: string;
    RATE_LIMIT_MAX?: string;
    RATE_LIMIT_WINDOW_MINUTES?: string;
}

const generateMessageId = (domain: string) =>
    `${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}`;

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
                        const fromDomain = from.split('@')[1] ?? 'localhost';
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const cfEmail = await import(('cloudflare' + ':email') as any);
                        for (const addr of notifyAddrs) {
                            const warnRaw = [
                                `From: <${from}>`,
                                `To: <${addr}>`,
                                `Message-ID: <${generateMessageId(fromDomain)}>`,
                                'Subject: Inbound rate limit reached',
                                'MIME-Version: 1.0',
                                'Content-Type: text/plain; charset=UTF-8',
                                '',
                                `The inbound email rate limit has been reached. Further emails will be discarded until the next window.`,
                                '',
                                `Limit: ${rateMax} emails per ${windowMinutes} minutes`,
                            ].join('\r\n');
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

        const fromEmail = message.from.toLowerCase();
        const msgId = parsed.messageId ? parsed.messageId.replace(/^<|>$/g, '').trim() : null;
        const inReplyTo = parsed.inReplyTo ? parsed.inReplyTo.replace(/^<|>$/g, '').trim() : null;
        const subject = parsed.subject ?? null;
        const body = parsed.text ?? parsed.html ?? '';

        let contact = await env.DB
            .prepare('SELECT id, name FROM contact WHERE LOWER(email) = ?')
            .bind(fromEmail)
            .first<{ id: number; name: string }>();

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

        let parentId: number | null = null;

        // 1. Match by In-Reply-To against stored message_id (set at send time)
        if (inReplyTo) {
            const parent = await env.DB
                .prepare('SELECT id FROM email WHERE message_id = ? AND contact_id = ?')
                .bind(inReplyTo, contact.id)
                .first<{ id: number }>();
            if (parent) parentId = parent.id;
        }

        // 2. Subject fallback for contacts replying without In-Reply-To or with no match
        if (parentId === null && subject) {
            const normalised = subject.replace(/^(Re:\s*|Fwd?:\s*)+/gi, '').trim();
            if (normalised) {
                const parent = await env.DB
                    .prepare('SELECT id FROM email WHERE contact_id = ? AND sender IS NOT NULL AND subject = ? ORDER BY id DESC LIMIT 1')
                    .bind(contact.id, normalised)
                    .first<{ id: number }>();
                if (parent) parentId = parent.id;
            }
        }

        const recipient = message.to.toLowerCase();
        const cc = parsed.cc?.map(a => a.address).filter((a): a is string => !!a).join(', ') || null;

        const result = await env.DB
            .prepare('INSERT INTO email (contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient, cc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(contact.id, parentId, null, new Date().toISOString(), subject, body.trim(), msgId, recipient, cc)
            .run();

        const emailId = result.meta.last_row_id;

        for (const att of parsed.attachments ?? []) {
            if (!att.content || att.related) continue;
            const filename = att.filename ?? 'attachment';
            const contentType = att.mimeType ?? 'application/octet-stream';
            const r2Key = `${emailId}/${crypto.randomUUID()}-${filename}`;
            const data = att.content instanceof Uint8Array ? att.content : new Uint8Array(att.content as ArrayBuffer);
            await env.ATTACHMENTS.put(r2Key, data, {
                httpMetadata: { contentType },
            });
            await env.DB
                .prepare('INSERT INTO attachment (email_id, file_name, content_type, r2_key, size) VALUES (?, ?, ?, ?, ?)')
                .bind(emailId, filename, contentType, r2Key, data.byteLength)
                .run();
        }

        const notifyAddrs = (env.NOTIFY_ADDRS ?? '').split(',').map(a => a.trim()).filter(Boolean);
        if (notifyAddrs.length === 0) return;

        const safeSubject = (subject ?? '(no subject)').replace(/[\r\n]/g, ' ');
        const bodyText = body.trim();
        const preview = bodyText.length > 500 ? bodyText.slice(0, 500) + `\n\n[+${bodyText.length - 500} characters]` : bodyText;
        const displayFrom = contact.name !== fromEmail ? `${contact.name} <${fromEmail}>` : fromEmail;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cfEmail = await import(('cloudflare' + ':email') as any);
        const notifySubject = `New message from ${displayFrom.replace(/[\r\n]/g, '')}`;
        const notifyDomain = recipient.split('@')[1] ?? 'localhost';
        for (const addr of notifyAddrs) {
            const notifyRaw = [
                `From: <${recipient}>`,
                `To: <${addr}>`,
                `Message-ID: <${generateMessageId(notifyDomain)}>`,
                `Subject: ${notifySubject}`,
                'MIME-Version: 1.0',
                'Content-Type: text/plain; charset=UTF-8',
                '',
                `From:    ${displayFrom}`,
                `To:      ${recipient}`,
                `Subject: ${safeSubject}`,
                '',
                '---',
                '',
                preview,
            ].join('\r\n');
            try {
                await env.EMAIL_SENDER.send(new cfEmail.EmailMessage(recipient, addr, notifyRaw));
            } catch { /* notification failure must not affect inbound processing */ }
        }
    },
};
