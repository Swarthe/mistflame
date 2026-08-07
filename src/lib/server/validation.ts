// Server-side request validation shared by the API route handlers, so route
// modules export nothing beyond their HTTP methods.
//
// isValidEmail is also defined in src/lib/format.ts for client-side use; the
// duplication across execution contexts is deliberate (see CLAUDE.md).

export const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** A comma-separated address list from config, split and tidied. */
export const parseAddrList = (raw: string | undefined) =>
    (raw ?? '').split(',').map(a => a.trim()).filter(Boolean);

/** The draft fields shared by the email POST and PATCH handlers. */
export interface DraftFields {
    sender: string;
    subject: string | null;
    /** Trimmed, ready to bind. */
    body: string;
    bodyFormat: 'text' | 'markdown';
    cc: string | null;
    toAddrs: string | null;
    bcc: string | null;
}

export type DraftParse =
    | { ok: true; fields: DraftFields }
    | { ok: false; error: string };

/**
 * Parse and validate a draft email request body. One implementation for POST
 * and PATCH, which share this contract exactly; the sender-in-SEND_ADDRS
 * check stays in the handlers, since it needs the env.
 */
export function parseDraftFields(body: Record<string, unknown> | null): DraftParse {
    const sender = typeof body?.sender === 'string' ? body.sender : null;
    // Anything other than a string (a JSON number, say) would otherwise be
    // bound into the row as-is.
    const subject = typeof body?.subject === 'string' ? body.subject : null;
    const emailBody = body?.body;
    const cc = typeof body?.cc === 'string' && body.cc.trim() ? body.cc.trim() : null;
    const toAddrs = typeof body?.to_addrs === 'string' && body.to_addrs.trim() ? body.to_addrs.trim() : null;
    const bcc = typeof body?.bcc === 'string' && body.bcc.trim() ? body.bcc.trim() : null;
    // Optional; anything but the two known values is rejected rather than
    // defaulted, so a typo cannot silently store a markdown draft as text.
    const rawFormat = body?.body_format ?? 'text';
    const bodyFormat = rawFormat === 'markdown' ? 'markdown'
        : rawFormat === 'text' ? 'text' : null;

    if (!sender) {
        return { ok: false, error: 'sender is required.' };
    }
    if (bodyFormat === null) {
        return { ok: false, error: 'Invalid body_format.' };
    }
    if (typeof emailBody !== 'string' || !emailBody.trim()) {
        return { ok: false, error: 'body is required.' };
    }
    if (emailBody.length > 100_000) {
        return { ok: false, error: 'body too long.' };
    }
    if (subject !== null && subject.length > 500) {
        return { ok: false, error: 'subject too long.' };
    }
    // Validated at composition rather than only in the client, because an
    // invalid address would otherwise surface at send time, where its
    // EmailMessage fails after the contact's copy has been delivered.
    const hasInvalidAddr = (list: string) =>
        list.split(',').map(a => a.trim()).filter(Boolean).some(a => !isValidEmail(a));
    if (cc && hasInvalidAddr(cc)) {
        return { ok: false, error: 'Invalid CC address.' };
    }
    if (toAddrs && hasInvalidAddr(toAddrs)) {
        return { ok: false, error: 'Invalid To address.' };
    }
    if (bcc && hasInvalidAddr(bcc)) {
        return { ok: false, error: 'Invalid BCC address.' };
    }

    return {
        ok: true,
        fields: { sender, subject, body: emailBody.trim(), bodyFormat, cc, toAddrs, bcc },
    };
}
