'use client';

import { useState, useEffect, useRef } from 'react';
import { buildEmailDocument } from '@/lib/email-html';
import type { EmailRecord } from '@/lib/types';
import { formatDate, splitQuote, validateCc } from '@/lib/format';
import { useSanitisedHtml } from '@/hooks/useSanitisedHtml';
import { EmailFrame } from '@/components/EmailFrame';
import { ReplyPreview } from '@/components/ReplyPreview';
import { AttachmentChip } from '@/components/AttachmentChip';
import { inputCls, btnPrimary, btnGhost, btnDanger } from '@/components/styles';

export function EmailCard({ email, contactName, parentEmail, orgName, sendAddrs, threadSender, senderEditable, highlighted, onReply, onDelete, onEdit, onSend, onAttachmentUpload, onAttachmentDelete, onEditingChange }: {
    email: EmailRecord;
    contactName: string;
    parentEmail?: EmailRecord | null;
    orgName: string;
    sendAddrs: string[];
    threadSender: string | null;
    senderEditable: boolean;
    /** Outlined because a search result pointed here. */
    highlighted: boolean;
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
    // Registered only while actually editing: reporting `false` on mount would
    // clear the page's editing state for a *different* card whenever a new
    // email arrives mid-edit. The cleanup also unregisters when the card
    // unmounts.
    useEffect(() => {
        if (!editing) return;
        onEditingChange(true);
        return () => onEditingChange(false);
    }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
    const [editSenderAddr, setEditSenderAddr] = useState(email.sender ?? sendAddrs[0] ?? '');
    const [editSubject, setEditSubject] = useState(email.subject ?? '');
    const [editBody, setEditBody] = useState(email.body);
    const [editCc, setEditCc] = useState(email.cc ?? '');
    const [editCcError, setEditCcError] = useState<string | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [quoteExpanded, setQuoteExpanded] = useState(false);
    // Deliberately not persisted: the decision to contact a sender's server
    // should be made again on a fresh view rather than inherited.
    const [loadImages, setLoadImages] = useState(false);
    const sanitised = useSanitisedHtml(email, loadImages);
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
    // The outline marks the card a search result jumped to, and fades on its own.
    const cardCls = `flex flex-col gap-2 p-4 border transition-shadow ${displayIsUs ? 'ml-8 border-[#ffd54f]/30 bg-[#ffd54f]/[0.08]' : 'mr-8 border-white/20'}${highlighted ? ' shadow-[0_0_0_2px_#ffd54f]' : ''}`;

    if (editing) {
        return (
            <div id={`email-${email.id}`} className={`${cardCls} gap-3`}>
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

    const { main: bodyMain, quote: bodyQuote } = splitQuote(email.body);
    // Until the sanitiser resolves, the plain-text rendition stands in; it is
    // also the permanent fallback if the dynamic import fails.
    const showHtml = sanitised !== null;
    const quoteContent = showHtml ? sanitised.quote : bodyQuote;
    // Only what is actually on screen: the quote's images are not in the frame
    // document until it is expanded, so offering to load them would do nothing.
    const blockedImages = showHtml
        ? sanitised.blockedImages
            + (quoteExpanded ? sanitised.blockedImagesInQuote : 0)
        : 0;
    const fileAttachments = email.attachments.filter(att => att.inline === 0);
    // Used both as the plain-text rendition and as the frame's fallback.
    const textBody = (
        <p className="text-sm text-white/85 whitespace-pre-wrap leading-relaxed font-sans">{bodyMain}</p>
    );

    return (
        <div id={`email-${email.id}`} className={cardCls}>
            {parentEmail && <ReplyPreview email={parentEmail} contactName={contactName} orgName={orgName} />}
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm font-semibold text-white font-sans shrink-0">{isUs ? orgName : contactName}</span>
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
            {showHtml ? (
                <EmailFrame
                    srcDoc={buildEmailDocument(sanitised, quoteExpanded)}
                    fallback={textBody}
                />
            ) : textBody}
            {(quoteContent !== null || blockedImages > 0) && (
                <div className="mt-1">
                    <div className="flex items-center gap-2">
                        {quoteContent !== null && (
                            <button
                                onClick={() => setQuoteExpanded(v => !v)}
                                className={`text-xs px-1.5 py-0.5 border transition-colors cursor-pointer font-sans ${quoteExpanded ? 'text-white/70 border-white/45' : 'text-white/40 hover:text-white/65 border-white/25 hover:border-white/45'}`}
                                title={quoteExpanded ? 'Hide quoted text' : 'Show quoted text'}
                            >···</button>
                        )}
                        {blockedImages > 0 && (
                            <button
                                onClick={() => setLoadImages(true)}
                                className="text-xs px-1.5 py-0.5 border text-white/40 hover:text-white/65 border-white/25 hover:border-white/45 transition-colors cursor-pointer font-sans"
                                title="Fetch remote images through the server; the sender learns the message was opened"
                            >Load images ({blockedImages})</button>
                        )}
                    </div>
                    {/* An HTML quote is rendered inside the frame with the rest of
                        the message, so only the plain-text path expands here. */}
                    {quoteExpanded && quoteContent !== null && !showHtml && (
                        <p className="text-sm text-white/45 whitespace-pre-wrap leading-relaxed font-sans mt-2 border-l-2 border-white/20 pl-3">{quoteContent}</p>
                    )}
                </div>
            )}
            {fileAttachments.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    {fileAttachments.map(att => (
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
