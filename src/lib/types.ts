// Client-side shapes of the API's JSON responses. The route handlers define
// their own row types; these describe what the UI receives and holds.

export interface AppConfig {
    orgName: string;
    sendAddrs: string[];
}

export interface Tag {
    id: number;
    name: string;
    color: string;
}

export interface Contact {
    id: number;
    name: string;
    email: string;
    description: string | null;
    tags: Tag[];
    awaiting_reply: number;
}

export interface Attachment {
    id: number;
    filename: string;
    content_type: string;
    size: number;
    content_id: string | null;
    /** 1 = embedded in body_html via cid:, so not listed as a file. */
    inline: number;
}

export type BodyFormat = 'text' | 'markdown';

export interface EmailRecord {
    id: number;
    contact_id: number;
    thread_id: number;
    parent_id: number | null;
    sender: string | null;
    sent_at: string | null;
    subject: string | null;
    body: string;
    /** HTML alternative; null means body is the only rendition. */
    body_html: string | null;
    /** 'markdown' means body holds markdown source (outgoing rows only);
     *  inbound rows are always 'text'. */
    body_format: BodyFormat;
    recipient: string | null;
    /** Reply-To address of inbound mail when it differs from From; the
     *  send path delivers replies there instead of the contact. */
    reply_to: string | null;
    /** Actual From address when the row was not written by the contact
     *  themselves (bounces threaded onto the message that failed). */
    from_addr: string | null;
    cc: string | null;
    /** Inbound: the parsed To: header list. Draft: extra To addresses
     *  beyond the contact. Sent: the full delivered To list. */
    to_addrs: string | null;
    /** Outgoing only; delivered as separate copies, never in headers. */
    bcc: string | null;
    attachments: Attachment[];
}

export interface SearchResult {
    id: number;
    contact_id: number;
    contact_name: string;
    contact_email: string;
    sender: string | null;
    sent_at: string | null;
    subject: string | null;
    /** Body extract with matched terms wrapped in HIT_OPEN/HIT_CLOSE. */
    snippet: string;
}
