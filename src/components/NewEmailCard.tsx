'use client';

import { useState, useRef } from 'react';
import type { EmailRecord } from '@/lib/types';
import { formatSize, validateCc } from '@/lib/format';
import { ReplyPreview } from '@/components/ReplyPreview';
import { inputCls, btnPrimary, btnGhost } from '@/components/styles';

export function NewEmailCard({ replyTo, contactName, orgName, sendAddrs, threadSender, saving, onSave, onCancel }: {
    replyTo: EmailRecord | null;
    contactName: string;
    orgName: string;
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
            {replyTo && <ReplyPreview email={replyTo} contactName={contactName} orgName={orgName} />}
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
