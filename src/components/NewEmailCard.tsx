'use client';

import { useState, useRef } from 'react';
import type { Contact, EmailRecord } from '@/lib/types';
import { ReplyPreview } from '@/components/ReplyPreview';
import { RecipientField } from '@/components/RecipientField';
import { BodyEditor } from '@/components/BodyEditor';
import { AttachmentChip } from '@/components/AttachmentChip';
import { inputCls, selectCls, lockedSenderCls, btnPrimary, btnGhost, btnMuted } from '@/components/styles';

export function NewEmailCard({ replyTo, contactName, contactEmail, contacts, orgName, sendAddrs, threadSender, initialCc, saving, onSave, onCancel }: {
    replyTo: EmailRecord | null;
    contactName: string;
    contactEmail: string;
    /** For recipient autocomplete and chip styling. */
    contacts: Contact[];
    orgName: string;
    sendAddrs: string[];
    threadSender: string | null;
    /** CC prefill; empty for a plain reply, the merged recipient list for
     *  Reply All. The card is remounted when it changes. */
    initialCc: string;
    saving: boolean;
    onSave: (sender: string | null, subject: string, body: string, cc: string, toAddrs: string, bcc: string, files: File[]) => void;
    onCancel: () => void;
}) {
    // When replying, lock the sender to the address that received the inbound email.
    const effectiveThreadSender = threadSender ?? (replyTo?.sender === null ? replyTo.recipient : null) ?? null;
    const replyAsSender = effectiveThreadSender ?? sendAddrs[0] ?? '';
    const initialSubject = replyTo?.subject ? `Re: ${replyTo.subject.replace(/^(Re:\s*)+/i, '')}` : '';
    // The fixed To chip mirrors where the send path delivers the primary
    // copy: the parent's Reply-To when set, otherwise the contact.
    const fixedTo = replyTo?.reply_to ?? contactEmail;
    const [senderAddr, setSenderAddr] = useState(replyAsSender);
    const [subject, setSubject] = useState(initialSubject);
    const [toAddrs, setToAddrs] = useState('');
    const [cc, setCc] = useState(initialCc);
    const [bcc, setBcc] = useState('');
    const [body, setBody] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    // CC and BCC stay hidden until asked for, so the common composer is a row
    // shorter. A field that arrives with content (Reply All prefill) opens
    // visible, and once revealed a field stays for the composer's lifetime.
    const [showCc, setShowCc] = useState(initialCc !== '');
    const [showBcc, setShowBcc] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addrLocked = effectiveThreadSender !== null;
    const effectiveAddr = addrLocked ? effectiveThreadSender! : senderAddr;
    const sender = effectiveAddr || null;
    const cardCls = 'flex flex-col gap-3 p-4 border ml-4 sm:ml-8 border-gold/30 bg-gold/[0.08]';

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        setPendingFiles(prev => [...prev, file]);
    };

    return (
        <div className={cardCls}>
            {replyTo && <ReplyPreview email={replyTo} contactName={contactName} orgName={orgName} />}
            <div className="flex flex-col gap-2">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
                    {addrLocked ? (
                        <div className={lockedSenderCls}>{effectiveThreadSender}</div>
                    ) : (
                        <select className={selectCls} value={senderAddr} onChange={e => setSenderAddr(e.target.value)}>
                            {sendAddrs.map(addr => <option key={addr} value={addr} style={{ color: 'white' }}>{addr}</option>)}
                        </select>
                    )}
                    <RecipientField
                        label="To"
                        fixedAddress={fixedTo}
                        value={toAddrs}
                        onChange={setToAddrs}
                        contacts={contacts}
                    />
                    {(!showCc || !showBcc) && (
                        <div className="flex gap-2 shrink-0 sm:mt-3">
                            {!showCc && <button className={btnMuted} onClick={() => setShowCc(true)}>CC</button>}
                            {!showBcc && <button className={btnMuted} onClick={() => setShowBcc(true)}>BCC</button>}
                        </div>
                    )}
                </div>
                {(showCc || showBcc) && (
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
                        {showCc && (
                            <RecipientField
                                label="CC"
                                value={cc}
                                onChange={setCc}
                                contacts={contacts}
                                placeholder="CC recipients"
                            />
                        )}
                        {showBcc && (
                            <RecipientField
                                label="BCC"
                                value={bcc}
                                onChange={setBcc}
                                contacts={contacts}
                                placeholder="BCC recipients"
                            />
                        )}
                    </div>
                )}
            </div>
            <input className={inputCls} placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} />
            <BodyEditor
                value={body}
                onChange={setBody}
                placeholder="Email body *"
                onAttach={() => fileInputRef.current?.click()}
            />
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
            {pendingFiles.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    {pendingFiles.map((file, idx) => (
                        <AttachmentChip
                            key={idx}
                            att={{ filename: file.name, size: file.size }}
                            onDelete={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))}
                        />
                    ))}
                </div>
            )}
            <div className="flex gap-2">
                <button className={btnPrimary} onClick={() => onSave(sender, subject, body, cc, toAddrs, bcc, pendingFiles)} disabled={saving || !body.trim()}>
                    {saving ? 'Saving…' : 'Add Email'}
                </button>
                <button className={btnGhost} onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}
