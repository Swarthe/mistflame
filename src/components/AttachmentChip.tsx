'use client';

import { formatSize } from '@/lib/format';

// Chip for a stored attachment (href set, name downloads) or a pending file
// awaiting upload (no href, name is plain text).
export function AttachmentChip({ att, href, onDelete }: {
    att: { filename: string; size: number };
    href?: string;
    onDelete?: () => void;
}) {
    return (
        <div className="max-w-full min-w-0 flex items-center gap-1.5 text-xs text-white/60 bg-white/5 border border-white/10 px-2 py-1">
            {href ? (
                <a href={href} download={att.filename} title={att.filename} className="truncate hover:text-white/90 transition-colors">
                    {att.filename}
                </a>
            ) : (
                <span className="truncate" title={att.filename}>{att.filename}</span>
            )}
            <span className="text-white/35 shrink-0">{formatSize(att.size)}</span>
            {onDelete && (
                <button onClick={onDelete} className="shrink-0 text-white/30 hover:text-red-400 transition-colors cursor-pointer leading-none p-1 -m-1">✕</button>
            )}
        </div>
    );
}
