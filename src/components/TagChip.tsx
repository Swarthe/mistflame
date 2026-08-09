'use client';

import { hexToRgba } from '@/lib/format';

export function TagChip({ tag, onRemove }: { tag: { name: string; color: string }; onRemove?: () => void }) {
    return (
        <span
            className="max-w-full min-w-0 text-xs px-2 py-0.5 font-medium flex items-center gap-1"
            style={{
                color: tag.color,
                backgroundColor: hexToRgba(tag.color, 0.10),
                border: `1px solid ${hexToRgba(tag.color, 0.20)}`,
            }}
        >
            <span className="truncate">{tag.name}</span>
            {onRemove && (
                <button onClick={onRemove} className="shrink-0 leading-none opacity-50 hover:opacity-100 cursor-pointer p-1 -m-1">✕</button>
            )}
        </span>
    );
}
