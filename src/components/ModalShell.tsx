'use client';

import { useEffect } from 'react';

// Shared overlay + panel for the app's modals. Escape and a click on the
// backdrop close the modal unless `locked` (an operation is in flight).
// Backdrop dismissal uses mousedown on the overlay itself, so a text
// selection dragged out of the panel cannot close it.
export function ModalShell({ locked, onClose, children }: {
    locked?: boolean;
    onClose: () => void;
    children: React.ReactNode;
}) {
    useEffect(() => {
        if (locked) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [locked, onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
            onMouseDown={e => {
                if (e.target === e.currentTarget && !locked) onClose();
            }}
        >
            <div className="bg-[#111] border border-white/15 p-6 w-full max-w-md mx-4 flex flex-col gap-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
                {children}
            </div>
        </div>
    );
}
