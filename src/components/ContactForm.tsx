'use client';

import { useState, useEffect } from 'react';
import type { Contact, Tag } from '@/lib/types';
import { isValidEmail } from '@/lib/format';
import { TagChip } from '@/components/TagChip';
import { inputCls, inputErrorCls, btnPrimary, btnGhost } from '@/components/styles';

export function ContactForm({ value, onChange, onSave, onCancel, saving, saveError }: {
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
        onChange({ ...value, tags: [...currentTags, { id: matchedTag?.id ?? 0, name: matchedTag?.name ?? name, color: effectiveColor }] });
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
                        className={emailError ? inputErrorCls : inputCls}
                        placeholder="Email *"
                        type="email"
                        {...field('email')}
                        onFocus={() => setEmailError(null)}
                        onBlur={() => setEmailError(value.email && !isValidEmail(value.email) ? 'Invalid email address' : null)}
                    />
                    {emailError && <p className="text-xs text-red-400">{emailError}</p>}
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
            {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            <div className="flex gap-2">
                <button className={btnPrimary} onClick={onSave} disabled={saving || !value.name?.trim() || !isValidEmail(value.email ?? '')}>
                    {saving ? 'Saving…' : 'Save'}
                </button>
                <button className={btnGhost} onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}
