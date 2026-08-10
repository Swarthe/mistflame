import type { EmailRecord } from '@/lib/types';

export function ReplyPreview({ email, contactName, orgName }: { email: EmailRecord; contactName: string; orgName: string }) {
    const sender = email.sender !== null ? orgName : contactName;
    const preview = email.body.length > 80 ? email.body.slice(0, 80) + '…' : email.body;
    return (
        <div className="border-l-2 border-white/25 pl-2 mb-1 min-w-0">
            <span className="block truncate text-xs text-white/55 leading-snug">
                ↩ {sender}{email.subject ? ` — ${email.subject}` : ''} • {preview}
            </span>
        </div>
    );
}
