import { useRef, useState } from 'react';
import { Bold, Italic, Code, Link, List, ListOrdered, TextQuote, CircleHelp, Paperclip } from 'lucide-react';
import { useMarkdownHtml } from '@/hooks/useMarkdownHtml';
import { toggleWrap, togglePrefix, continueList, type EditResult } from '@/lib/markdown-edit';
import { inputCls } from '@/components/styles';

// The body editor shared by NewEmailCard and EmailCard's edit mode: a
// markdown textarea with a formatting toolbar, Write/Preview tabs and a
// syntax help link. Composition is always markdown (there is no plain-text
// mode: markdown source *is* plain text, so writing without markup costs
// nothing). The value handed up is the raw source; rendering happens at send
// time and display time. The text manipulation lives in
// src/lib/markdown-edit.ts, where it is pure and testable.

const toolBtn = 'p-1 border border-white/15 text-white/55 hover:text-white hover:border-white/40 transition-colors cursor-pointer';
const tabBtn = (active: boolean) =>
    `text-xs px-2 py-0.5 border transition-colors cursor-pointer ${active
        ? 'text-white/85 border-white/45'
        : 'text-white/40 hover:text-white/65 border-white/20 hover:border-white/40'}`;

export function BodyEditor({ value, onChange, placeholder, onAttach, attachBusy }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    /** Renders a paperclip in the toolbar; the parent owns the hidden file
     *  input and the attachment chip row. */
    onAttach?: () => void;
    attachBusy?: boolean;
}) {
    const [previewing, setPreviewing] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const previewHtml = useMarkdownHtml(previewing ? value : null);

    // The selection is restored a frame later: onChange re-renders the
    // textarea from the parent's state, which resets the caret to the end.
    const apply = (result: EditResult) => {
        onChange(result.text);
        requestAnimationFrame(() => {
            const ta = textareaRef.current;
            if (!ta) return;
            ta.focus();
            ta.setSelectionRange(result.selStart, result.selEnd);
        });
    };

    const withSelection = (edit: (start: number, end: number) => EditResult | null) => {
        const ta = textareaRef.current;
        if (!ta) return;
        const result = edit(ta.selectionStart, ta.selectionEnd);
        if (result) apply(result);
    };

    const wrap = (marker: string, fallback: string) =>
        withSelection((s, e) => toggleWrap(value, s, e, marker, fallback));

    // [selected](url) with "url" left selected, so typing replaces it.
    const insertLink = () => withSelection((start, end) => {
        const text = value.slice(start, end) || 'link text';
        const urlStart = start + text.length + 3;
        return {
            text: `${value.slice(0, start)}[${text}](url)${value.slice(end)}`,
            selStart: urlStart,
            selEnd: urlStart + 3,
        };
    });

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            const ta = e.currentTarget;
            // A selection replaced by Enter is the default behaviour.
            if (ta.selectionStart !== ta.selectionEnd) return;
            const result = continueList(value, ta.selectionStart);
            if (result) {
                e.preventDefault();
                apply(result);
            }
            return;
        }
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key === 'b') { e.preventDefault(); wrap('**', 'bold text'); }
        else if (key === 'i') { e.preventDefault(); wrap('*', 'italic text'); }
        else if (key === 'k') { e.preventDefault(); insertLink(); }
    };

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                    {!previewing && (
                        <>
                            <button className={toolBtn} onClick={() => wrap('**', 'bold text')} title="Bold (Ctrl+B)"><Bold className="w-3.5 h-3.5" /></button>
                            <button className={toolBtn} onClick={() => wrap('*', 'italic text')} title="Italic (Ctrl+I)"><Italic className="w-3.5 h-3.5" /></button>
                            <button className={toolBtn} onClick={() => wrap('`', 'code')} title="Inline code"><Code className="w-3.5 h-3.5" /></button>
                            <button className={toolBtn} onClick={insertLink} title="Link (Ctrl+K)"><Link className="w-3.5 h-3.5" /></button>
                            <button className={toolBtn} onClick={() => withSelection((s, e) => togglePrefix(value, s, e, () => '- ', /^- /))} title="Bulleted list"><List className="w-3.5 h-3.5" /></button>
                            <button className={toolBtn} onClick={() => withSelection((s, e) => togglePrefix(value, s, e, i => `${i + 1}. `, /^\d+[.)] /))} title="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></button>
                            <button className={toolBtn} onClick={() => withSelection((s, e) => togglePrefix(value, s, e, () => '> ', /^> /))} title="Quote"><TextQuote className="w-3.5 h-3.5" /></button>
                            {onAttach && (
                                <button
                                    className="p-1 ml-1 text-white/55 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    onClick={onAttach}
                                    disabled={attachBusy}
                                    title={attachBusy ? 'Uploading…' : 'Attach a file'}
                                ><Paperclip className="w-3.5 h-3.5" /></button>
                            )}
                            <a
                                className="group relative flex items-center text-white/30 hover:text-white/60 transition-colors ml-1"
                                href="https://commonmark.org/help/"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <CircleHelp className="w-3.5 h-3.5" />
                                {/* Styled rather than a title attribute so it
                                    shows without the browser's hover delay. */}
                                <span className="absolute bottom-full left-0 mb-1.5 hidden group-hover:block whitespace-nowrap bg-black border border-white/20 text-white/75 text-xs px-2 py-1 pointer-events-none">
                                    Markdown syntax is supported; click for a reference
                                </span>
                            </a>
                        </>
                    )}
                </div>
                <div className="flex items-center gap-1 ml-auto">
                    <button className={tabBtn(!previewing)} onClick={() => setPreviewing(false)}>Write</button>
                    <button className={tabBtn(previewing)} onClick={() => setPreviewing(true)}>Preview</button>
                </div>
            </div>
            {previewing ? (
                value.trim() === '' ? (
                    <div className={`${inputCls} min-h-[200px] text-white/40`}>Nothing to preview</div>
                ) : previewHtml !== null ? (
                    // Safe without a sanitiser pass: markdown-it output with
                    // html: false is a closed tag set (see src/lib/markdown.ts).
                    <div
                        className={`${inputCls} mf-markdown min-h-[200px]`}
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                ) : (
                    // Renderer still loading (or failed): the source is the
                    // fallback rendition, as everywhere else.
                    <div className={`${inputCls} min-h-[200px] whitespace-pre-wrap`}>{value}</div>
                )
            ) : (
                <textarea
                    ref={textareaRef}
                    className={`${inputCls} resize-y min-h-[200px]`}
                    rows={10}
                    placeholder={placeholder}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
            )}
        </div>
    );
}
