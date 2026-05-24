import PostalMime from 'postal-mime';

interface Env {
    DB: D1Database;
    ATTACHMENTS: R2Bucket;
}

export default {
    async email(message: ForwardableEmailMessage, env: Env) {
        const rawBuffer = await new Response(message.raw).arrayBuffer();
        const parsed = await new PostalMime().parse(rawBuffer);

        const fromEmail = message.from.toLowerCase();
        const msgId = parsed.messageId ? parsed.messageId.replace(/^<|>$/g, '').trim() : null;
        const inReplyTo = parsed.inReplyTo ? parsed.inReplyTo.replace(/^<|>$/g, '').trim() : null;
        const subject = parsed.subject ?? null;
        const body = parsed.text ?? parsed.html ?? '';

        let contact = await env.DB
            .prepare('SELECT id FROM contact WHERE LOWER(email) = ?')
            .bind(fromEmail)
            .first<{ id: number }>();

        if (!contact) {
            const contactName = parsed.from?.name?.trim() || fromEmail;
            await env.DB
                .prepare('INSERT OR IGNORE INTO contact (name, email) VALUES (?, ?)')
                .bind(contactName, fromEmail)
                .run();
            contact = await env.DB
                .prepare('SELECT id FROM contact WHERE LOWER(email) = ?')
                .bind(fromEmail)
                .first<{ id: number }>();
            if (!contact) return;
        }

        let parentId: number | null = null;

        // 1. Match by In-Reply-To (works after first reply backfills the rewritten ID)
        if (inReplyTo) {
            const parent = await env.DB
                .prepare('SELECT id FROM email WHERE message_id = ? AND contact_id = ?')
                .bind(inReplyTo, contact.id)
                .first<{ id: number }>();
            if (parent) parentId = parent.id;
        }

        // 2. Subject fallback: strip Re:/Fwd: prefixes and match against sent email subjects
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

        // Backfill the rewritten Message-ID so future In-Reply-To matches work
        if (parentId !== null && inReplyTo) {
            await env.DB
                .prepare('UPDATE email SET message_id = ? WHERE id = ? AND message_id != ?')
                .bind(inReplyTo, parentId, inReplyTo)
                .run();
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
    },
};
