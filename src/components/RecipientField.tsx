'use client';

import { useState, useRef } from 'react';
import type { Contact } from '@/lib/types';
import { fuzzyMatch, isValidEmail } from '@/lib/format';

// Gmail-style chip input for an address list. Only addresses that passed
// isValidEmail (typed) or came from the contact list (picked) ever reach
// `value`, so the parent components need no validation state of their own.
// Chips whose address belongs to a contact show the contact's name in gold;
// unknown addresses stay grey. The optional fixed chip (the address the send
// path targets anyway) cannot be removed.
export function RecipientField({ label, fixedAddress, value, onChange, contacts, placeholder }: {
    label: string;
    /** Unremovable first chip: the contact or Reply-To the copy goes to. */
    fixedAddress?: string | null;
    /** Comma-separated additional addresses. */
    value: string;
    onChange: (value: string) => void;
    contacts: Contact[];
    placeholder?: string;
}) {
    const [input, setInput] = useState('');
    const [invalid, setInvalid] = useState(false);
    // -1 = nothing highlighted: Enter then prefers the raw typed address, so
    // an unknown address that happens to fuzzy-match a contact is not
    // silently swapped for that contact.
    const [highlightIdx, setHighlightIdx] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);

    const addrs = value.split(',').map(a => a.trim()).filter(Boolean);
    const taken = new Set([
        ...(fixedAddress ? [fixedAddress.toLowerCase()] : []),
        ...addrs.map(a => a.toLowerCase()),
    ]);
    const contactByAddr = new Map(contacts.map(c => [c.email.toLowerCase(), c]));

    const q = input.trim();
    const suggestions = q
        ? contacts
            .filter(c => !taken.has(c.email.toLowerCase()) && (fuzzyMatch(q, c.name) || fuzzyMatch(q, c.email)))
            .slice(0, 6)
        : [];
    const offerRaw = isValidEmail(q) && !taken.has(q.toLowerCase());

    const commit = (addr: string) => {
        const a = addr.trim();
        if (a && !taken.has(a.toLowerCase())) {
            onChange([...addrs, a].join(', '));
        }
        setInput('');
        setInvalid(false);
        setHighlightIdx(-1);
    };

    const commitInput = () => {
        if (!q) return;
        if (isValidEmail(q)) commit(q);
        else setInvalid(true);
    };

    const remove = (addr: string) => onChange(addrs.filter(a => a !== addr).join(', '));

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            if (highlightIdx >= 0 && suggestions[highlightIdx]) commit(suggestions[highlightIdx].email);
            else if (offerRaw) commit(q);
            else if (suggestions.length > 0) commit(suggestions[0].email);
            else commitInput();
        } else if (e.key === 'ArrowDown' && suggestions.length) {
            e.preventDefault();
            setHighlightIdx(i => (i + 1) % suggestions.length);
        } else if (e.key === 'ArrowUp' && suggestions.length) {
            e.preventDefault();
            setHighlightIdx(i => (i <= 0 ? suggestions.length - 1 : i - 1));
        } else if (e.key === 'Escape') {
            setInput('');
            setInvalid(false);
            setHighlightIdx(-1);
        } else if (e.key === 'Backspace' && !input && addrs.length) {
            remove(addrs[addrs.length - 1]);
        }
    };

    const chip = (addr: string, removable: boolean) => {
        const contact = contactByAddr.get(addr.toLowerCase());
        const cls = !removable
            ? 'border-white/10 bg-white/[0.04] text-white/45'
            : contact
                ? 'border-[#ffd54f]/40 bg-[#ffd54f]/10 text-[#ffd54f]/90'
                : 'border-white/20 bg-white/[0.06] text-white/80';
        return (
            <span key={addr} title={contact ? `${contact.name} <${addr}>` : addr} className={`flex items-center gap-1 border px-1.5 py-0.5 text-xs font-sans ${cls}`}>
                {contact ? contact.name : addr}
                {removable && (
                    <button onClick={() => remove(addr)} className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer leading-none">✕</button>
                )}
            </span>
        );
    };

    return (
        <div className="relative flex-1 min-w-0">
            <div
                className={`flex flex-wrap items-center gap-1.5 border bg-white/[0.07] px-3 py-2 cursor-text ${invalid ? 'border-red-400/60' : 'border-white/15 focus-within:border-white/40'}`}
                onClick={() => inputRef.current?.focus()}
            >
                <span className="text-xs text-white/35 font-sans select-none w-7 shrink-0">{label}</span>
                {fixedAddress && chip(fixedAddress, false)}
                {addrs.map(a => chip(a, true))}
                <input
                    ref={inputRef}
                    className="flex-1 min-w-[80px] bg-transparent text-sm text-white placeholder:text-white/25 focus:outline-none font-sans"
                    value={input}
                    placeholder={addrs.length > 0 || fixedAddress ? '' : placeholder}
                    onChange={e => { setInput(e.target.value); setInvalid(false); setHighlightIdx(-1); }}
                    onKeyDown={onKeyDown}
                    onBlur={commitInput}
                />
            </div>
            {invalid && <p className="text-xs text-red-400 font-sans mt-1">Invalid address: {q}</p>}
            {(suggestions.length > 0 || offerRaw) && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 bg-[#111] border border-white/15 max-h-56 overflow-y-auto">
                    {suggestions.map((c, i) => (
                        // onMouseDown rather than onClick: it must win the race
                        // against the input's blur, which commits the raw text
                        // and closes the dropdown.
                        <button
                            key={c.id}
                            onMouseDown={e => { e.preventDefault(); commit(c.email); }}
                            onMouseEnter={() => setHighlightIdx(i)}
                            className={`w-full text-left px-3 py-1.5 cursor-pointer font-sans ${i === highlightIdx ? 'bg-white/[0.08]' : ''}`}
                        >
                            <span className="text-sm text-white">{c.name}</span>
                            <span className="text-xs text-white/40 ml-2">{c.email}</span>
                        </button>
                    ))}
                    {offerRaw && (
                        <button
                            onMouseDown={e => { e.preventDefault(); commit(q); }}
                            className="w-full text-left px-3 py-1.5 cursor-pointer font-sans"
                        >
                            <span className="text-sm text-white/60">Add</span>
                            <span className="text-sm text-white ml-2">{q}</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
