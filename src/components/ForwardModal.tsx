import { useState } from 'react';
import type { Contact } from '@/lib/types';
import { fuzzyMatch, isValidEmail } from '@/lib/format';
import { ModalShell } from '@/components/ModalShell';
import { inputCls, btnGhost } from '@/components/styles';

export function ForwardModal({ contacts, busy, error, onPick, onCreate, onClose }: {
    contacts: Contact[];
    busy: boolean;
    error: string | null;
    onPick: (contactId: number) => void;
    onCreate: (address: string) => void;
    onClose: () => void;
}) {
    const [query, setQuery] = useState('');
    const q = query.trim();
    const filtered = q
        ? contacts.filter(c => fuzzyMatch(q, c.name) || fuzzyMatch(q, c.email))
        : contacts;
    // A typed address that matches no known contact can become a new one.
    const offerCreate = isValidEmail(q)
        && !contacts.some(c => c.email.toLowerCase() === q.toLowerCase());

    return (
        <ModalShell locked={busy} onClose={onClose}>
            <div>
                <h2 className="font-heading-bold text-lg tracking-wide text-white mb-1">Forward to</h2>
                <p className="text-sm text-white/55">
                    The forward becomes a new draft under the chosen contact.
                </p>
            </div>
            <input
                className={inputCls}
                placeholder="Search contacts or type an address"
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoFocus
            />
            <div className="flex flex-col max-h-64 overflow-y-auto">
                {filtered.map(c => (
                    <button
                        key={c.id}
                        onClick={() => onPick(c.id)}
                        disabled={busy}
                        className="text-left px-3 py-2 hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-40"
                    >
                        <span className="text-sm text-white">{c.name}</span>
                        <span className="text-xs text-white/40 ml-2">{c.email}</span>
                    </button>
                ))}
                {offerCreate && (
                    <button
                        onClick={() => onCreate(q)}
                        disabled={busy}
                        className="text-left px-3 py-2 hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-40"
                    >
                        <span className="text-sm text-gold/80">New contact:</span>
                        <span className="text-sm text-white ml-2">{q}</span>
                    </button>
                )}
                {filtered.length === 0 && !offerCreate && (
                    <p className="text-sm text-white/40 px-3 py-2">No matches.</p>
                )}
            </div>
            {error && <p className="text-xs text-red-400 break-words">{error}</p>}
            <button onClick={onClose} className={btnGhost} disabled={busy}>
                {busy ? 'Forwarding…' : 'Cancel'}
            </button>
        </ModalShell>
    );
}
