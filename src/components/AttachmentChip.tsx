'use client';

import type { Attachment } from '@/lib/types';
import { formatSize } from '@/lib/format';

export function AttachmentChip({ att, href, onDelete }: {
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
