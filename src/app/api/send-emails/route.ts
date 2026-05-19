import { getCloudflareContext } from '@opennextjs/cloudflare';

interface PendingEmail {
    id: number;
    sender: string;
    subject: string | null;
    body: string;
    cc: string | null;
    parent_id: number | null;
    parent_message_id: string | null;
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

function toBase64Lines(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))));
    }
    const base64 = btoa(binary);
    return base64.match(/.{1,76}/g)?.join('\r\n') ?? base64;
}

function buildRaw(
    headerLines: string[],
    body: string,
    attachments: { filename: string; content_type: string; data: ArrayBuffer }[]
): string {
    if (attachments.length === 0) {
        return [
            ...headerLines,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            '',
            body,
        ].join('\r\n');
    }

    const boundary = `----=_Boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const lines: string[] = [
        ...headerLines,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        body,
    ];

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

export async function GET() {
    const { env } = await getCloudflareContext({ async: true });
    const row = await env.DB
        .prepare("SELECT COUNT(*) AS count FROM email WHERE sender IS NOT NULL AND sent_at IS NULL")
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
            const bodyNormalised = email.body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

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

            const raw = buildRaw(headerLines, bodyNormalised, attachmentData);
            await env.EMAIL_SENDER.send(new cfEmailMod.EmailMessage(from, email.contact_email, raw));

            if (email.cc) {
                const ccAddrs = email.cc.split(',').map((a: string) => a.trim()).filter(Boolean);
                for (const addr of ccAddrs) {
                    await env.EMAIL_SENDER.send(new cfEmailMod.EmailMessage(from, addr, raw));
                }
            }

            await env.DB
                .prepare('UPDATE email SET sent_at = ?, message_id = ? WHERE id = ?')
                .bind(sentAt, msgId, email.id)
                .run();

            sent++;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${email.contact_name}: ${msg}`);
            failed++;
        }
    }

    return Response.json({ ok: true, sent, failed, errors });
}
