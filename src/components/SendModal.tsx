'use client';

import { btnPrimary, btnGhost } from '@/components/styles';

export interface SendResult {
    sent: number;
    failed: number;
    errors: string[];
}

export function SendModal({ pendingCount, sending, result, onSend, onClose }: {
    pendingCount: number | null;
    sending: boolean;
    result: SendResult | null;
    onSend: () => void;
    onClose: () => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <div className="bg-[#111] border border-white/15 p-6 w-full max-w-md mx-4 flex flex-col gap-5">
                <div>
                    <h2 className="font-heading-bold text-lg tracking-wide text-white mb-1">Send all emails</h2>
                    <p className="text-sm text-white/55 font-sans">
                        {result
                            ? null
                            : pendingCount === null
                                ? 'Counting pending emails…'
                                : pendingCount === 0
                                    ? 'No pending emails to send.'
                                    : `${pendingCount} unsent ${pendingCount === 1 ? 'email' : 'emails'} will be sent.`}
                    </p>
                </div>

                {!result && (
                    <div className="flex gap-2">
                        <button
                            onClick={onSend}
                            disabled={sending || pendingCount === 0}
                            className={btnPrimary}
                        >
                            {sending ? 'Sending…' : 'Send'}
                        </button>
                        <button onClick={onClose} className={btnGhost} disabled={sending}>
                            Cancel
                        </button>
                    </div>
                )}

                {result && (
                    <>
                        <div className="flex flex-col gap-1.5">
                            <p className="text-sm font-sans">
                                <span className="text-white/85">{result.sent} sent</span>
                                {result.failed > 0 && (
                                    <span className="text-red-400 ml-3">{result.failed} failed</span>
                                )}
                            </p>
                            {result.errors.length > 0 && (
                                <ul className="text-xs text-red-400/80 font-sans mt-1 flex flex-col gap-0.5">
                                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                                </ul>
                            )}
                        </div>
                        <button onClick={onClose} className={btnPrimary}>Close</button>
                    </>
                )}
            </div>
        </div>
    );
}
