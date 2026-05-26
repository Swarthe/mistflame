'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppConfig {
    orgName: string;
    sendAddrs: string[];
}

interface Tag {
    id: number;
    name: string;
    color: string;
}

interface Contact {
    id: number;
    name: string;
    email: string;
    description: string | null;
    tags: Tag[];
    awaiting_reply: number;
}

interface Attachment {
    id: number;
    filename: string;
    content_type: string;
    size: number;
}

interface EmailRecord {
    id: number;
    contact_id: number;
    thread_id: number;
    parent_id: number | null;
    sender: string | null;
    sent_at: string | null;
    subject: string | null;
    body: string;
    recipient: string | null;
    cc: string | null;
    attachments: Attachment[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputCls = 'w-full bg-white/[0.07] border border-white/15 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-white/40 placeholder:text-white/40 font-sans';

const validateCc = (cc: string): string | null => {
    if (!cc.trim()) return null;
    const invalid = cc.split(',').map(a => a.trim()).filter(a => a && !isValidEmail(a));
    return invalid.length > 0 ? `Invalid: ${invalid.join(', ')}` : null;
};
const btnPrimary = 'text-sm font-bold px-4 py-2 bg-white/80 text-black hover:bg-[#ffd54f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer font-sans';
const btnGhost = 'text-sm px-4 py-2 border border-white/20 text-white/75 hover:text-white hover:border-white/40 transition-colors cursor-pointer font-sans';
const btnDanger = 'text-xs leading-none text-red-400/60 hover:text-red-400 transition-colors cursor-pointer';

function hexToRgba(hex: string, alpha: number): string {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function fuzzyMatch(query: string, target: string): boolean {
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) qi++;
    }
    return qi === q.length;
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
        return iso;
    }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TagChip({ tag, onRemove }: { tag: { name: string; color: string }; onRemove?: () => void }) {
    return (
        <span
            className="text-xs px-2 py-0.5 font-medium font-sans flex items-center gap-1"
            style={{
                color: tag.color,
                backgroundColor: hexToRgba(tag.color, 0.10),
                border: `1px solid ${hexToRgba(tag.color, 0.20)}`,
            }}
        >
            {tag.name}
            {onRemove && (
                <button onClick={onRemove} className="leading-none opacity-50 hover:opacity-100 cursor-pointer ml-0.5">✕</button>
            )}
        </span>
    );
}

function ContactForm({ value, onChange, onSave, onCancel, saving, saveError }: {
    value: Partial<Contact>;
    onChange: (v: Partial<Contact>) => void;
    onSave: () => void;
    onCancel: () => void;
    saving?: boolean;
    saveError?: string | null;
}) {
    const [emailError, setEmailError] = useState<string | null>(null);
    const [tagInput, setTagInput] = useState('');
    const [tagColor, setTagColor] = useState('#888888');
    const [allTags, setAllTags] = useState<Tag[]>([]);

    useEffect(() => {
        fetch('/api/tags').then(r => r.json()).then((d: unknown) => setAllTags(((d as { tags?: Tag[] }).tags) ?? []));
    }, []);

    const currentTags = value.tags ?? [];
    const matchedTag = allTags.find(t => t.name.toLowerCase() === tagInput.trim().toLowerCase());
    const effectiveColor = matchedTag ? matchedTag.color : tagColor;

    const addTag = () => {
        const name = tagInput.trim();
        if (!name) return;
        if (currentTags.some(t => t.name.toLowerCase() === name.toLowerCase())) return;
        onChange({ ...value, tags: [...currentTags, { id: matchedTag?.id ?? 0, name, color: effectiveColor }] });
        setTagInput('');
        setTagColor('#888888');
    };

    const field = (key: keyof Contact) => ({
        value: (value[key] as string) ?? '',
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onChange({ ...value, [key]: e.target.value || null }),
    });

    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input className={inputCls} placeholder="Name *" {...field('name')} />
                <div className="flex flex-col gap-1">
                    <input
                        className={`${inputCls}${emailError ? ' border-red-400/60' : ''}`}
                        placeholder="Email *"
                        type="email"
                        {...field('email')}
                        onFocus={() => setEmailError(null)}
                        onBlur={() => setEmailError(value.email && !isValidEmail(value.email) ? 'Invalid email address' : null)}
                    />
                    {emailError && <p className="text-xs text-red-400 font-sans">{emailError}</p>}
                </div>
            </div>
            <textarea
                className={`${inputCls} resize-y min-h-[60px]`}
                placeholder="Description"
                rows={3}
                value={value.description ?? ''}
                onChange={e => onChange({ ...value, description: e.target.value || null })}
            />
            <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                    <input
                        className={inputCls}
                        placeholder="Add tag…"
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    />
                    <input
                        type="color"
                        value={effectiveColor}
                        onChange={e => setTagColor(e.target.value)}
                        disabled={!!matchedTag}
                        title={matchedTag ? 'Color set by existing tag' : 'Pick color'}
                        className="shrink-0 border border-white/15 bg-white/[0.07] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        style={{ width: 42, height: 42, padding: 3 }}
                    />
                    <button type="button" onClick={addTag} className={btnGhost}>Add</button>
                </div>
                {currentTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {currentTags.map(t => (
                            <TagChip key={t.name} tag={t} onRemove={() => onChange({ ...value, tags: currentTags.filter(x => x.name !== t.name) })} />
                        ))}
                    </div>
                )}
            </div>
            {saveError && <p className="text-xs text-red-400 font-sans">{saveError}</p>}
            <div className="flex gap-2">
                <button className={btnPrimary} onClick={onSave} disabled={saving || !value.name?.trim() || !isValidEmail(value.email ?? '')}>
                    {saving ? 'Saving…' : 'Save'}
                </button>
                <button className={btnGhost} onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}

function ReplyPreview({ email, contactName, senderName }: { email: EmailRecord; contactName: string; senderName: string }) {
    const sender = email.sender !== null ? senderName : contactName;
    const preview = email.body.length > 80 ? email.body.slice(0, 80) + '…' : email.body;
    return (
        <div className="border-l-2 border-white/25 pl-2 mb-1">
            <span className="text-xs text-white/55 font-sans leading-snug">
                ↩ {sender}{email.subject ? ` — ${email.subject}` : ''} • {preview}
            </span>
        </div>
    );
}

function AttachmentChip({ att, href, onDelete }: {
    att: Attachment;
    href: string;
    onDelete?: () => void;
}) {
    return (
        <div className="flex items-center gap-1.5 text-xs text-white/60 bg-white/5 border border-white/10 px-2 py-1 font-sans">
            <a href={href} download={att.filename} className="hover:text-white/90 transition-colors">
                {att.filename}
            </a>
            <span className="text-white/35">{formatSize(att.size)}</span>
            {onDelete && (
                <button onClick={onDelete} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer ml-0.5 leading-none">✕</button>
            )}
        </div>
    );
}

function EmailCard({ email, contactName, parentEmail, senderName, sendAddrs, threadSender, senderEditable, onReply, onDelete, onEdit, onSend, onAttachmentUpload, onAttachmentDelete, onEditingChange }: {
    email: EmailRecord;
    contactName: string;
    parentEmail?: EmailRecord | null;
    senderName: string;
    sendAddrs: string[];
    threadSender: string | null;
    senderEditable: boolean;
    onReply: () => void;
    onDelete: () => void;
    onEdit: (sender: string | null, subject: string, body: string, cc: string) => Promise<void>;
    onSend: () => Promise<void>;
    onAttachmentUpload: (file: File) => Promise<void>;
    onAttachmentDelete: (attachmentId: number) => Promise<void>;
    onEditingChange: (editing: boolean) => void;
}) {
    const isUs = email.sender !== null;
    const [editing, setEditing] = useState(false);
    useEffect(() => { onEditingChange(editing); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
    const [editSenderAddr, setEditSenderAddr] = useState(email.sender ?? sendAddrs[0] ?? '');
    const [editSubject, setEditSubject] = useState(email.subject ?? '');
    const [editBody, setEditBody] = useState(email.body);
    const [editCc, setEditCc] = useState(email.cc ?? '');
    const [editCcError, setEditCcError] = useState<string | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        setUploadError(null);
        setUploading(true);
        try {
            await onAttachmentUpload(file);
        } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const senderLocked = isUs && !senderEditable;
    const editSender = senderLocked ? threadSender : (editSenderAddr || null);

    const saveEdit = async () => {
        setEditSaving(true);
        try {
            await onEdit(editSender, editSubject, editBody, editCc);
            setEditing(false);
        } finally {
            setEditSaving(false);
        }
    };

    const cancelEdit = () => {
        setEditing(false);
        setEditSenderAddr(email.sender ?? sendAddrs[0] ?? '');
        setEditSubject(email.subject ?? '');
        setEditBody(email.body);
        setEditCc(email.cc ?? '');
        setEditCcError(null);
    };

    const handleSend = async () => {
        setSending(true);
        try {
            await onSend();
        } finally {
            setSending(false);
        }
    };

    const displayIsUs = isUs;
    const cardCls = `flex flex-col gap-2 p-4 border ${displayIsUs ? 'ml-8 border-[#ffd54f]/30 bg-[#ffd54f]/[0.08]' : 'mr-8 border-white/20'}`;

    if (editing) {
        return (
            <div className={`${cardCls} gap-3`}>
                <div className="flex flex-col gap-1">
                    <div className="flex gap-2 items-center">
                        {senderLocked ? (
                            <div className="w-48 shrink-0 text-sm font-sans text-white/35 border border-white/10 bg-white/[0.04] px-3 py-2.5">{threadSender}</div>
                        ) : (
                            <select className="w-48 shrink-0 bg-white/[0.07] border border-white/15 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-white/40 font-sans" value={editSenderAddr} onChange={e => setEditSenderAddr(e.target.value)}>
                                {sendAddrs.map(addr => <option key={addr} value={addr} style={{ color: 'white' }}>{addr}</option>)}
                            </select>
                        )}
                        <div className="flex-[1_1_160px] min-w-0 overflow-hidden">
                            <input
                                className={inputCls}
                                placeholder="CC (comma-separated)"
                                value={editCc}
                                onChange={e => { setEditCc(e.target.value); if (editCcError) setEditCcError(validateCc(e.target.value)); }}
                                onBlur={e => setEditCcError(validateCc(e.target.value))}
                            />
                        </div>
                    </div>
                    {editCcError && <p className="text-xs text-red-400 font-sans">{editCcError}</p>}
                </div>
                <input
                    className={inputCls}
                    placeholder="Subject"
                    value={editSubject}
                    onChange={e => setEditSubject(e.target.value)}
                />
                <textarea
                    className={`${inputCls} resize-y min-h-[120px]`}
                    rows={6}
                    value={editBody}
                    onChange={e => setEditBody(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                    {email.attachments.map(att => (
                        <AttachmentChip
                            key={att.id}
                            att={att}
                            href={`/api/contacts/${email.contact_id}/emails/${email.id}/attachments/${att.id}`}
                            onDelete={() => onAttachmentDelete(att.id)}
                        />
                    ))}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="text-xs text-white/65 hover:text-white underline underline-offset-2 decoration-white/30 hover:decoration-white/60 transition-colors cursor-pointer font-sans disabled:opacity-40"
                    >
                        {uploading ? 'Uploading…' : 'Attach'}
                    </button>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
                    {uploadError && <span className="text-xs text-red-400 font-sans">{uploadError}</span>}
                </div>
                <div className="flex gap-2">
                    <button className={btnPrimary} onClick={saveEdit} disabled={editSaving || !editBody.trim() || !!editCcError}>
                        {editSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button className={btnGhost} onClick={cancelEdit}>Cancel</button>
                </div>
            </div>
        );
    }

    return (
        <div className={cardCls}>
            {parentEmail && <ReplyPreview email={parentEmail} contactName={contactName} senderName={senderName} />}
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm font-semibold text-white font-sans shrink-0">{isUs ? senderName : contactName}</span>
                    {isUs && email.sender && <span className="text-xs text-white/35 font-sans truncate">{email.sender}</span>}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                    {!isUs && email.recipient && (
                        <span className="text-xs text-white/35 font-sans">→ {email.recipient.split('@')[0]}</span>
                    )}
                    {email.sent_at !== null ? (
                        <span className="text-xs text-white/60 font-sans">{formatDate(email.sent_at)}</span>
                    ) : isUs ? (
                        <button className="text-xs text-[#ffd54f]/60 hover:text-[#ffd54f] border border-[#ffd54f]/25 hover:border-[#ffd54f]/55 px-2 py-0.5 transition-colors cursor-pointer font-sans disabled:opacity-40" onClick={handleSend} disabled={sending || !!(parentEmail && parentEmail.sent_at === null)}>{sending ? 'Sending…' : 'Send'}</button>
                    ) : null}
                    {email.sent_at === null && (
                        <button className="text-xs text-white/65 hover:text-white underline underline-offset-2 decoration-white/30 hover:decoration-white/60 transition-colors cursor-pointer font-sans" onClick={() => setEditing(true)}>Edit</button>
                    )}
                    {!isUs && <button className="text-xs text-[#ffd54f]/70 hover:text-[#ffd54f] transition-colors cursor-pointer font-sans" onClick={onReply}>+ Reply</button>}
                    <button className={btnDanger} onClick={onDelete} title="Delete email">✕</button>
                </div>
            </div>
            {email.cc && (
                <div className="text-xs text-white/40 font-sans">CC: {email.cc}</div>
            )}
            {email.subject && !email.parent_id && (
                <div className="text-xs text-white/45 font-sans">{email.subject}</div>
            )}
            <p className="text-sm text-white/85 whitespace-pre-wrap leading-relaxed font-sans">{email.body}</p>
            {email.attachments.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    {email.attachments.map(att => (
                        <AttachmentChip
                            key={att.id}
                            att={att}
                            href={`/api/contacts/${email.contact_id}/emails/${email.id}/attachments/${att.id}`}
                            onDelete={email.sent_at === null && isUs ? () => onAttachmentDelete(att.id) : undefined}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function NewEmailCard({ replyTo, contactName, senderName, sendAddrs, threadSender, saving, onSave, onCancel }: {
    replyTo: EmailRecord | null;
    contactName: string;
    senderName: string;
    sendAddrs: string[];
    threadSender: string | null;
    saving: boolean;
    onSave: (sender: string | null, subject: string, body: string, cc: string, files: File[]) => void;
    onCancel: () => void;
}) {
    // When replying, lock the sender to the address that received the inbound email.
    const effectiveThreadSender = threadSender ?? (replyTo?.sender === null ? replyTo.recipient : null) ?? null;
    const replyAsSender = effectiveThreadSender ?? sendAddrs[0] ?? '';
    const initialSubject = replyTo?.subject ? `Re: ${replyTo.subject.replace(/^(Re:\s*)+/i, '')}` : '';
    const [senderAddr, setSenderAddr] = useState(replyAsSender);
    const [subject, setSubject] = useState(initialSubject);
    const [cc, setCc] = useState(replyTo?.cc ?? '');
    const [ccError, setCcError] = useState<string | null>(null);
    const [body, setBody] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addrLocked = effectiveThreadSender !== null;
    const effectiveAddr = addrLocked ? effectiveThreadSender! : senderAddr;
    const sender = effectiveAddr || null;
    const cardCls = 'flex flex-col gap-3 p-4 border ml-8 border-[#ffd54f]/30 bg-[#ffd54f]/[0.08]';

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        setPendingFiles(prev => [...prev, file]);
    };

    return (
        <div className={cardCls}>
            {replyTo && <ReplyPreview email={replyTo} contactName={contactName} senderName={senderName} />}
            <div className="flex flex-col gap-1">
                <div className="flex gap-2 items-center">
                    {addrLocked ? (
                        <span className="w-48 shrink-0 text-sm font-sans text-white/35 flex items-center border border-white/10 bg-white/[0.04] px-3 py-2.5">{effectiveThreadSender}</span>
                    ) : (
                        <select className="w-48 shrink-0 bg-white/[0.07] border border-white/15 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-white/40 font-sans" value={senderAddr} onChange={e => setSenderAddr(e.target.value)}>
                            {sendAddrs.map(addr => <option key={addr} value={addr} style={{ color: 'white' }}>{addr}</option>)}
                        </select>
                    )}
                    <div className="flex-[1_1_160px] min-w-0 overflow-hidden">
                        <input
                            className={inputCls}
                            placeholder="CC (comma-separated)"
                            value={cc}
                            onChange={e => { setCc(e.target.value); if (ccError) setCcError(validateCc(e.target.value)); }}
                            onBlur={e => setCcError(validateCc(e.target.value))}
                        />
                    </div>
                </div>
                {ccError && <p className="text-xs text-red-400 font-sans">{ccError}</p>}
            </div>
            <input className={inputCls} placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} />
            <textarea
                className={`${inputCls} resize-y min-h-[120px]`}
                rows={6}
                placeholder="Email body *"
                value={body}
                onChange={e => setBody(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
                {pendingFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 text-xs text-white/60 bg-white/5 border border-white/10 px-2 py-1 font-sans">
                        <span>{file.name}</span>
                        <span className="text-white/35">{formatSize(file.size)}</span>
                        <button onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer ml-0.5 leading-none">✕</button>
                    </div>
                ))}
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-white/65 hover:text-white underline underline-offset-2 decoration-white/30 hover:decoration-white/60 transition-colors cursor-pointer font-sans"
                >
                    Attach
                </button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
            </div>
            <div className="flex gap-2">
                <button className={btnPrimary} onClick={() => onSave(sender, subject, body, cc, pendingFiles)} disabled={saving || !body.trim() || !!ccError}>
                    {saving ? 'Saving…' : 'Add Email'}
                </button>
                <button className={btnGhost} onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function OutreachPage() {
    const router = useRouter();
    const apiFetch = (...args: Parameters<typeof fetch>): Promise<Response> =>
        fetch(...args).then(res => { if (res.status === 401) router.push('/login'); return res; });

    const [config, setConfig] = useState<AppConfig | null>(null);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(() => {
        if (typeof window === 'undefined') return null;
        const stored = localStorage.getItem('mf_contact');
        return stored ? parseInt(stored, 10) : null;
    });
    const [emails, setEmails] = useState<EmailRecord[]>([]);
    const [loadingContacts, setLoadingContacts] = useState(true);
    const [contactsError, setContactsError] = useState(false);
    const [loadingEmails, setLoadingEmails] = useState(false);
    const [saving, setSaving] = useState(false);
    const [apiError, setApiError] = useState<string | null>(null);

    const [addingContact, setAddingContact] = useState(false);
    const [addContactForm, setAddContactForm] = useState<Partial<Contact>>({});
    const [editContact, setEditContact] = useState<Partial<Contact> | null>(null);
    const [contactSaveError, setContactSaveError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterAwaiting, setFilterAwaiting] = useState(false);

    const [addingEmail, setAddingEmail] = useState(false);
    const [replyToEmail, setReplyToEmail] = useState<EmailRecord | null>(null);
    const [editingEmailId, setEditingEmailId] = useState<number | null>(null);

    const [showSendModal, setShowSendModal] = useState(false);
    const [sendingEmails, setSendingEmails] = useState(false);
    const [pendingCount, setPendingCount] = useState<number | null>(null);
    const [sendResult, setSendResult] = useState<{ sent: number; failed: number; errors: string[] } | null>(null);

    const selectedContact = contacts.find(c => c.id === selectedId) ?? null;
    const senderName = config?.orgName || 'Mistflame';
    const sendAddrs = config?.sendAddrs ?? [];
    const searchTrimmed = searchQuery.trim();
    const filteredContacts = contacts.filter(c => {
        if (filterAwaiting && !c.awaiting_reply) return false;
        if (!searchTrimmed) return true;
        return (
            fuzzyMatch(searchTrimmed, c.name) ||
            fuzzyMatch(searchTrimmed, c.email) ||
            c.tags.some(t => fuzzyMatch(searchTrimmed, t.name))
        );
    });

    const fetchContacts = () => {
        setLoadingContacts(true);
        setContactsError(false);
        apiFetch('/api/contacts')
            .then(r => r.ok ? r.json() : Promise.reject())
            .then((data: unknown) => { setContacts(((data as { contacts?: Contact[] }).contacts) ?? []); setContactsError(false); })
            .catch(() => setContactsError(true))
            .finally(() => setLoadingContacts(false));
    };

    useEffect(() => {
        apiFetch('/api/config')
            .then(r => r.json())
            .then((data: unknown) => {
                const cfg = data as AppConfig;
                setConfig(cfg);
            })
            .catch(() => {});
        fetchContacts();
        apiFetch('/api/send-emails')
            .then(r => r.ok ? r.json() : Promise.reject())
            .then((data: unknown) => setPendingCount((data as { count?: number }).count ?? 0))
            .catch(() => setPendingCount(0));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (selectedId === null) { setEmails([]); return; }
        setEmails([]);
        setLoadingEmails(true);
        apiFetch(`/api/contacts/${selectedId}/emails`)
            .then(r => r.ok ? r.json() : Promise.reject())
            .then((data: unknown) => setEmails(((data as { emails?: EmailRecord[] }).emails) ?? []))
            .catch(() => {})
            .finally(() => setLoadingEmails(false));
    }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (selectedId === null) return;
        const poll = () => {
            if (document.visibilityState !== 'visible') return;
            apiFetch(`/api/contacts/${selectedId}/emails`)
                .then(r => r.ok ? r.json() : Promise.reject())
                .then((data: unknown) => setEmails(((data as { emails?: EmailRecord[] }).emails) ?? []))
                .catch(() => {});
            refreshContacts();
            apiFetch('/api/send-emails')
                .then(r => r.ok ? r.json() : Promise.reject())
                .then((data: unknown) => setPendingCount((data as { count?: number }).count ?? 0))
                .catch(() => {});
        };
        const interval = setInterval(poll, 10_000);
        document.addEventListener('visibilitychange', poll);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', poll);
        };
    }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (selectedId === null) localStorage.removeItem('mf_contact');
        else localStorage.setItem('mf_contact', String(selectedId));
    }, [selectedId]);

    const selectContact = (id: number) => {
        if (addingContact && (addContactForm.name || addContactForm.email || addContactForm.description)) {
            if (!confirm('Discard new contact?')) return;
        } else if (editContact) {
            if (!confirm('Discard unsaved changes?')) return;
        } else if (addingEmail || replyToEmail) {
            if (!confirm('Discard unsaved email?')) return;
        } else if (editingEmailId !== null) {
            if (!confirm('Discard unsaved email edits?')) return;
        }
        setSelectedId(id);
        setAddingContact(false);
        setAddContactForm({});
        setEditContact(null);
        setContactSaveError(null);
        setAddingEmail(false);
        setReplyToEmail(null);
        setEditingEmailId(null);
        setApiError(null);
    };

    const logout = async () => {
        await fetch('/api/auth', { method: 'DELETE' });
        router.push('/login');
    };

    const refreshContacts = () => {
        apiFetch('/api/contacts')
            .then(r => r.ok ? r.json() : Promise.reject())
            .then((data: unknown) => setContacts(((data as { contacts?: Contact[] }).contacts) ?? []))
            .catch(() => {}); // background refresh after mutation — keep existing contacts on error
    };

    const refreshPendingCount = () => {
        apiFetch('/api/send-emails')
            .then(r => r.ok ? r.json() : Promise.reject())
            .then((data: unknown) => setPendingCount((data as { count?: number }).count ?? 0))
            .catch(() => {});
    };

    const openSendModal = () => {
        setShowSendModal(true);
        setSendResult(null);
        refreshPendingCount();
    };

    const sendEmails = async () => {
        setSendingEmails(true);
        try {
            const res = await apiFetch('/api/send-emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = (await res.json()) as { sent?: number; failed?: number; errors?: string[] };
            setSendResult({ sent: data.sent ?? 0, failed: data.failed ?? 0, errors: data.errors ?? [] });
            refreshPendingCount();
            refreshContacts();
        } catch {
            setSendResult({ sent: 0, failed: 0, errors: ['Network error — could not reach the server.'] });
        } finally {
            setSendingEmails(false);
        }
    };

    const addContact = async () => {
        setSaving(true);
        setContactSaveError(null);
        try {
            const res = await apiFetch('/api/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(addContactForm),
            });
            const data = (await res.json()) as { contact?: Contact; error?: string };
            if (res.ok && data.contact) {
                setContacts(prev => [...prev, data.contact!].sort((a, b) => a.name.localeCompare(b.name)));
                setAddContactForm({});
                setAddingContact(false);
                setSelectedId(data.contact.id);
            } else {
                setContactSaveError(data.error ?? 'Failed to save contact.');
            }
        } finally { setSaving(false); }
    };

    const saveContact = async () => {
        if (!editContact?.id) return;
        setSaving(true);
        setContactSaveError(null);
        try {
            const res = await apiFetch(`/api/contacts/${editContact.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editContact),
            });
            const data = (await res.json()) as { ok: boolean; error?: string };
            if (res.ok) {
                setEditContact(null);
                setContactSaveError(null);
                refreshContacts();
            } else {
                setContactSaveError(data.error ?? 'Failed to save contact.');
            }
        } finally { setSaving(false); }
    };

    const deleteContact = async (id: number) => {
        if (!confirm('Delete this contact and all their emails?')) return;
        const res = await apiFetch(`/api/contacts/${id}`, { method: 'DELETE' });
        if (res.ok) {
            setContacts(prev => prev.filter(c => c.id !== id));
            if (selectedId === id) setSelectedId(null);
        }
    };

    const startAddEmail = () => {
        if (addingEmail && !confirm('Discard unsaved email?')) return;
        setReplyToEmail(null);
        setAddingEmail(true);
    };

    const startReply = (email: EmailRecord) => {
        if (addingEmail && !confirm('Discard unsaved email?')) return;
        setReplyToEmail(email);
        setAddingEmail(true);
    };

    const addEmail = async (sender: string | null, subject: string, body: string, cc: string, files: File[]) => {
        if (!selectedId) return;
        setSaving(true);
        setApiError(null);
        try {
            const payload = {
                sender,
                subject: subject.trim() || null,
                body,
                cc: cc.trim() || null,
                parent_id: replyToEmail?.id ?? null,
            };
            const res = await apiFetch(`/api/contacts/${selectedId}/emails`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = (await res.json()) as { email?: Omit<EmailRecord, 'attachments'>; error?: string };
            if (res.ok && data.email) {
                const emailId = data.email.id;
                const uploadedAttachments: Attachment[] = [];
                for (const file of files) {
                    const formData = new FormData();
                    formData.append('file', file);
                    const attRes = await apiFetch(`/api/contacts/${selectedId}/emails/${emailId}/attachments`, {
                        method: 'POST',
                        body: formData,
                    });
                    const attData = (await attRes.json()) as { attachment?: Attachment };
                    if (attRes.ok && attData.attachment) uploadedAttachments.push(attData.attachment);
                }
                setEmails(prev => [...prev, { ...data.email!, attachments: uploadedAttachments }]);
                setAddingEmail(false);
                setReplyToEmail(null);
                refreshPendingCount();
                refreshContacts();
                const failedUploads = files.length - uploadedAttachments.length;
                if (failedUploads > 0) {
                    setApiError(`Email saved, but ${failedUploads} attachment${failedUploads > 1 ? 's' : ''} failed to upload.`);
                }
            } else {
                setApiError(data.error ?? `Server error (${res.status})`);
            }
        } catch {
            setApiError('Network error — could not reach the server.');
        } finally { setSaving(false); }
    };

    const uploadAttachment = async (emailId: number, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await apiFetch(`/api/contacts/${selectedId}/emails/${emailId}/attachments`, {
            method: 'POST',
            body: formData,
        });
        const data = (await res.json()) as { attachment?: Attachment; error?: string };
        if (res.ok && data.attachment) {
            setEmails(prev => prev.map(e => e.id === emailId ? { ...e, attachments: [...e.attachments, data.attachment!] } : e));
        } else {
            throw new Error(data.error ?? 'Upload failed');
        }
    };

    const deleteAttachment = async (emailId: number, attachmentId: number) => {
        const res = await apiFetch(`/api/contacts/${selectedId}/emails/${emailId}/attachments/${attachmentId}`, {
            method: 'DELETE',
        });
        if (res.ok) {
            setEmails(prev => prev.map(e => e.id === emailId ? { ...e, attachments: e.attachments.filter(a => a.id !== attachmentId) } : e));
        }
    };

    const sendSingleEmail = async (emailId: number) => {
        const res = await apiFetch('/api/send-emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email_id: emailId }),
        });
        if (res.ok) {
            refreshPendingCount();
            if (selectedId !== null) {
                apiFetch(`/api/contacts/${selectedId}/emails`)
                    .then(r => r.ok ? r.json() : Promise.reject())
                    .then((data: unknown) => setEmails(((data as { emails?: EmailRecord[] }).emails) ?? []))
                    .catch(() => {});
            }
            refreshContacts();
        } else {
            const data = (await res.json()) as { error?: string };
            throw new Error(data.error ?? 'Failed to send');
        }
    };

    const editEmail = async (emailId: number, sender: string | null, subject: string, body: string, cc: string) => {
        const res = await apiFetch(`/api/contacts/${selectedId}/emails/${emailId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender, subject: subject.trim() || null, body, cc: cc.trim() || null }),
        });
        if (res.ok) {
            setEmails(prev => {
                const updated = prev.map(e => e.id === emailId ? { ...e, sender, subject: subject.trim() || null, body, cc: cc.trim() || null } : e);
                const awaiting = updated.some(e => {
                    const threadEmails = updated.filter(x => x.thread_id === e.thread_id);
                    const last = threadEmails.reduce((a, b) => b.id > a.id ? b : a);
                    return last.id === e.id && e.sender === null;
                });
                if (selectedId !== null) {
                    setContacts(prev => prev.map(c => c.id === selectedId ? { ...c, awaiting_reply: awaiting ? 1 : 0 } : c));
                }
                return updated;
            });
        } else {
            const data = (await res.json()) as { error?: string };
            throw new Error(data.error ?? 'Failed to save');
        }
    };

    const deleteEmail = async (id: number) => {
        if (!confirm('Delete this email and all its replies?')) return;
        const res = await apiFetch(`/api/contacts/${selectedId}/emails/${id}`, { method: 'DELETE' });
        if (res.ok) {
            const data = (await res.json()) as { deleted?: number };
            if ((data.deleted ?? 1) > 1) {
                if (selectedId !== null) {
                    apiFetch(`/api/contacts/${selectedId}/emails`)
                        .then(r => r.ok ? r.json() : Promise.reject())
                        .then((d: unknown) => setEmails(((d as { emails?: EmailRecord[] }).emails) ?? []))
                        .catch(() => {});
                }
            } else {
                setEmails(prev => prev.filter(e => e.id !== id));
            }
            refreshPendingCount();
            refreshContacts();
        }
    };

    const emailById = useMemo(() => new Map(emails.map(e => [e.id, e])), [emails]);

    const threadGroups = useMemo(() => {
        const groups = new Map<number, EmailRecord[]>();
        for (const email of emails) {
            if (!groups.has(email.thread_id)) groups.set(email.thread_id, []);
            groups.get(email.thread_id)!.push(email);
        }
        return Array.from(groups.entries())
            .sort((a, b) => (a[1][0].sent_at ?? '9999').localeCompare(b[1][0].sent_at ?? '9999'));
    }, [emails]);

    const nextThreadId = useMemo(() => threadGroups.length + 1, [threadGroups]);

    const composeRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (addingEmail) {
            composeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [addingEmail, replyToEmail]);

    return (
        <div className="h-screen bg-black text-white font-sans flex flex-col overflow-hidden">
            {/* Header */}
            <header className="flex-shrink-0 border-b border-white/25 px-6 py-4 flex items-center justify-between">
                <h1 className="font-heading-bold text-xl tracking-wide">
                    <span className="text-[#ffd54f]">Mistflame</span>
                    {config?.orgName && <><span className="text-white/30 mx-1.5">—</span><span className="text-white">{config.orgName}</span></>}
                </h1>
                <div className="flex items-center gap-3">
                    <button onClick={openSendModal} disabled={pendingCount === 0} className={`text-sm border px-4 py-1.5 transition-colors font-sans ${pendingCount === 0 ? 'text-[#ffd54f]/30 border-[#ffd54f]/10 cursor-not-allowed' : 'text-[#ffd54f]/70 hover:text-[#ffd54f] border-[#ffd54f]/25 hover:border-[#ffd54f]/55 cursor-pointer'}`}>
                        Send emails{pendingCount ? ` (${pendingCount})` : ''}
                    </button>
                    <button onClick={logout} className="text-sm text-white/55 hover:text-white/85 border border-white/20 hover:border-white/40 px-4 py-1.5 transition-colors cursor-pointer font-sans">
                        Log out
                    </button>
                </div>
            </header>

            <div className="flex flex-1 min-h-0">
                {/* Sidebar */}
                <aside className="w-72 flex-shrink-0 border-r border-white/20 flex flex-col min-h-0">
                    <div className="flex-shrink-0 flex items-center gap-2 px-4 h-11 border-b border-white/20">
                        <span className="text-xs text-white/65 uppercase tracking-wider font-sans">Contacts</span>
                        {!loadingContacts && contacts.length > 0 && (
                            <div className="flex items-center gap-1 text-xs text-white/40 font-sans">
                                <span className="text-white/30">—</span>
                                <span>{contacts.length}</span>
                                {contacts.filter(c => c.awaiting_reply).length > 0 && (
                                    <span className="flex items-center">
                                        ({' '}<span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />{' '}{contacts.filter(c => c.awaiting_reply).length}{' '})
                                    </span>
                                )}
                            </div>
                        )}
                        <span className="flex-1" />
                        <button
                            onClick={() => {
                            if (addingContact && (addContactForm.name || addContactForm.email || addContactForm.description) && !confirm('Discard new contact?')) return;
                            if (editContact && !confirm('Discard unsaved changes?')) return;
                            if ((addingEmail || replyToEmail) && !confirm('Discard unsaved email?')) return;
                            if (editingEmailId !== null && !confirm('Discard unsaved email edits?')) return;
                            setAddingContact(true);
                            setSelectedId(null);
                            setEditContact(null);
                            setAddContactForm({});
                            setContactSaveError(null);
                            setAddingEmail(false);
                            setReplyToEmail(null);
                            setEditingEmailId(null);
                            setApiError(null);
                        }}
                            className="text-sm text-[#ffd54f]/60 hover:text-[#ffd54f] transition-colors cursor-pointer font-sans"
                        >
                            + New
                        </button>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2 px-4 h-11 border-b border-white/20">
                        <svg className="text-white/35 shrink-0" width="13" height="13" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.5"/>
                            <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                        <input
                            className="flex-1 bg-transparent text-white text-xs font-sans focus:outline-none placeholder:text-white/30"
                            placeholder="Search contacts…"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="text-white/35 hover:text-white/70 transition-colors cursor-pointer font-sans text-xs"
                            >
                                ✕
                            </button>
                        )}
                        <button
                            onClick={() => setFilterAwaiting(v => !v)}
                            title="Show only contacts awaiting reply"
                            className={`flex items-center justify-center w-6 h-6 border transition-colors cursor-pointer ${filterAwaiting ? 'border-[#ffd54f]/50 text-[#ffd54f]' : 'border-white/15 text-white/35 hover:text-white/60 hover:border-white/30'}`}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {loadingContacts && (
                            <p className="text-sm text-white/55 text-center py-8 font-sans">Loading…</p>
                        )}
                        {!loadingContacts && contactsError && (
                            <div className="text-center py-8 flex flex-col items-center gap-3">
                                <p className="text-sm text-white/55 font-sans">Failed to load contacts</p>
                                <button onClick={fetchContacts} className="text-xs font-sans text-white/50 hover:text-white/80 transition-colors">Retry</button>
                            </div>
                        )}
                        {!loadingContacts && !contactsError && contacts.length === 0 && (
                            <p className="text-sm text-white/55 text-center py-8 font-sans">No contacts yet</p>
                        )}
                        {!loadingContacts && contacts.length > 0 && filteredContacts.length === 0 && (
                            <p className="text-sm text-white/55 text-center py-8 font-sans">No matches</p>
                        )}
                        {filteredContacts.map(c => (
                            <button
                                key={c.id}
                                onClick={() => selectContact(c.id)}
                                className={`w-full text-left px-4 py-3.5 border-b border-white/10 transition-colors hover:bg-white/[0.07] cursor-pointer ${selectedId === c.id ? 'bg-white/[0.08] border-l-2 border-l-[#ffd54f] pl-[14px]' : ''}`}
                            >
                                <div className="flex items-center gap-2">
                                    <div className="text-sm font-semibold text-white truncate font-sans">{c.name}</div>
                                    {!!c.awaiting_reply && <span className="w-1.5 h-1.5 rounded-full bg-[#ffd54f] shrink-0" />}
                                </div>
                                <div className="text-xs text-white/60 truncate mt-0.5 font-sans">{c.email}</div>
                                {c.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {c.tags.map(t => <TagChip key={t.id} tag={t} />)}
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>
                </aside>

                {/* Main area */}
                <main className="flex-1 overflow-y-auto p-6 min-w-0">
                    {addingContact && (
                        <section className="mb-8">
                            <h2 className="font-heading-bold text-lg tracking-wide text-white mb-4">New Contact</h2>
                            <ContactForm
                                value={addContactForm}
                                onChange={v => { setAddContactForm(v); setContactSaveError(null); }}
                                onSave={addContact}
                                onCancel={() => { setAddingContact(false); setAddContactForm({}); setContactSaveError(null); }}
                                saving={saving}
                                saveError={contactSaveError}
                            />
                        </section>
                    )}

                    {selectedContact && !addingContact && (
                        <>
                            <section className="mb-6 pb-6 border-b border-white/20">
                                {editContact ? (
                                    <>
                                        <h2 className="font-heading-bold text-lg tracking-wide text-white mb-4">Edit Contact</h2>
                                        <ContactForm
                                            value={editContact}
                                            onChange={v => { setEditContact(v); setContactSaveError(null); }}
                                            onSave={saveContact}
                                            onCancel={() => { setEditContact(null); setContactSaveError(null); }}
                                            saving={saving}
                                            saveError={contactSaveError}
                                        />
                                    </>
                                ) : (
                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <h2 className="font-heading-bold text-xl tracking-wide text-white">{selectedContact.name}</h2>
                                                <div className="flex flex-wrap items-center gap-3 mt-1">
                                                    <a
                                                        href={`mailto:${selectedContact.email}`}
                                                        className="text-sm text-[#ffd54f]/70 hover:text-[#ffd54f] transition-colors font-sans"
                                                    >
                                                        {selectedContact.email}
                                                    </a>
                                                </div>
                                                {selectedContact.tags.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                                        {selectedContact.tags.map(t => <TagChip key={t.id} tag={t} />)}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <button onClick={() => setEditContact({ ...selectedContact })} className={btnGhost}>
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => deleteContact(selectedContact.id)}
                                                    className="text-xs text-red-400/80 hover:text-red-400 border border-red-400/30 hover:border-red-400/55 px-3 py-2 transition-colors cursor-pointer font-sans"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                        {selectedContact.description && (
                                            <p className="text-sm text-white/75 leading-relaxed font-sans">{selectedContact.description}</p>
                                        )}
                                    </div>
                                )}
                            </section>

                            <section>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-xs text-white/65 uppercase tracking-wider font-sans">
                                        Email History {emails.length > 0 && <span className="text-white/45 normal-case tracking-normal">({emails.length})</span>}
                                    </h3>
                                    {!addingEmail && !editContact && (
                                        <button onClick={startAddEmail} className="text-xs text-[#ffd54f]/70 hover:text-[#ffd54f] transition-colors cursor-pointer font-sans">
                                            + Email
                                        </button>
                                    )}
                                </div>

                                {apiError && (
                                    <p className="text-sm text-red-400 font-sans mb-4 px-1">{apiError}</p>
                                )}
                                {loadingEmails && emails.length === 0 && <p className="text-sm text-white/55 text-center py-6 font-sans">Loading…</p>}
                                {!loadingEmails && emails.length === 0 && !addingEmail && (
                                    <p className="text-sm text-white/55 text-center py-6 font-sans">No emails on record</p>
                                )}
                                <div className="flex flex-col gap-4">
                                    {threadGroups.map(([threadId, threadEmails], groupIdx) => {
                                        const threadSender = threadEmails.find(e => e.sender !== null)?.sender ?? null;
                                        const outgoingInThread = threadEmails.filter(e => e.sender !== null);
                                        const replyIds = new Set(threadEmails.map(e => e.parent_id).filter((id): id is number => id !== null));
                                        return (
                                            <div key={threadId} className="flex flex-col gap-2">
                                                {groupIdx > 0 && <div className="h-px bg-white/10 my-1" />}
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs text-white/50 font-sans">Thread {threadId}</span>
                                                    <span className="text-xs text-white/35 font-sans">· {threadEmails.length} {threadEmails.length === 1 ? 'email' : 'emails'}</span>
                                                </div>
                                                {threadEmails.map(email => (
                                                    <EmailCard
                                                        key={email.id}
                                                        email={email}
                                                        contactName={selectedContact.name}
                                                        parentEmail={email.parent_id != null ? emailById.get(email.parent_id) : null}
                                                        senderName={senderName}
                                                        sendAddrs={sendAddrs}
                                                        threadSender={threadSender}
                                                        senderEditable={email.sender !== null && outgoingInThread.length === 1 && !replyIds.has(email.id)}
                                                        onReply={() => startReply(email)}
                                                        onDelete={() => deleteEmail(email.id)}
                                                        onEdit={(sender, subject, body, cc) => editEmail(email.id, sender, subject, body, cc)}
                                                        onSend={() => sendSingleEmail(email.id)}
                                                        onAttachmentUpload={(file) => uploadAttachment(email.id, file)}
                                                        onAttachmentDelete={(attId) => deleteAttachment(email.id, attId)}
                                                        onEditingChange={(ed) => setEditingEmailId(ed ? email.id : null)}
                                                    />
                                                ))}
                                                {addingEmail && replyToEmail?.thread_id === threadId && (
                                                    <div ref={composeRef}>
                                                        <NewEmailCard
                                                            replyTo={replyToEmail}
                                                            contactName={selectedContact.name}
                                                            senderName={senderName}
                                                            sendAddrs={sendAddrs}
                                                            threadSender={threadSender}
                                                            saving={saving}
                                                            onSave={addEmail}
                                                            onCancel={() => { setAddingEmail(false); setReplyToEmail(null); }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {addingEmail && !replyToEmail && (
                                        <div ref={composeRef} className="flex flex-col gap-2">
                                            {threadGroups.length > 0 && <div className="h-px bg-white/10 my-1" />}
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs text-white/50 font-sans">Thread {nextThreadId}</span>
                                            </div>
                                            <NewEmailCard
                                                replyTo={null}
                                                contactName={selectedContact.name}
                                                senderName={senderName}
                                                sendAddrs={sendAddrs}
                                                threadSender={null}
                                                saving={saving}
                                                onSave={addEmail}
                                                onCancel={() => { setAddingEmail(false); setReplyToEmail(null); }}
                                            />
                                        </div>
                                    )}
                                </div>
                            </section>
                        </>
                    )}

                    {!selectedContact && !addingContact && (
                        <div className="h-full flex items-center justify-center min-h-[200px]">
                            <p className="text-sm text-white/50 font-sans">← Select a contact or add a new one</p>
                        </div>
                    )}
                </main>
            </div>

            {/* Send emails modal */}
            {showSendModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
                    <div className="bg-[#111] border border-white/15 p-6 w-full max-w-md mx-4 flex flex-col gap-5">
                        <div>
                            <h2 className="font-heading-bold text-lg tracking-wide text-white mb-1">Send all emails</h2>
                            <p className="text-sm text-white/55 font-sans">
                                {sendResult
                                    ? null
                                    : pendingCount === null
                                        ? 'Counting pending emails…'
                                        : pendingCount === 0
                                            ? 'No pending emails to send.'
                                            : `${pendingCount} unsent ${pendingCount === 1 ? 'email' : 'emails'} will be sent.`}
                            </p>
                        </div>

                        {!sendResult && (
                            <div className="flex gap-2">
                                <button
                                    onClick={sendEmails}
                                    disabled={sendingEmails || pendingCount === 0}
                                    className={btnPrimary}
                                >
                                    {sendingEmails ? 'Sending…' : 'Send'}
                                </button>
                                <button onClick={() => setShowSendModal(false)} className={btnGhost} disabled={sendingEmails}>
                                    Cancel
                                </button>
                            </div>
                        )}

                        {sendResult && (
                            <>
                                <div className="flex flex-col gap-1.5">
                                    <p className="text-sm font-sans">
                                        <span className="text-white/85">{sendResult.sent} sent</span>
                                        {sendResult.failed > 0 && (
                                            <span className="text-red-400 ml-3">{sendResult.failed} failed</span>
                                        )}
                                    </p>
                                    {sendResult.errors.length > 0 && (
                                        <ul className="text-xs text-red-400/80 font-sans mt-1 flex flex-col gap-0.5">
                                            {sendResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                                        </ul>
                                    )}
                                </div>
                                <button onClick={() => setShowSendModal(false)} className={btnPrimary}>Close</button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
