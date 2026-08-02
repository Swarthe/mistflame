'use client';

import { hexToRgba } from '@/lib/format';

export function TagChip({ tag, onRemove }: { tag: { name: string; color: string }; onRemove?: () => void }) {
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
