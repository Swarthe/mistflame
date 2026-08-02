'use client';

import type { Contact, SearchResult } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { TagChip } from '@/components/TagChip';
import { SnippetText } from '@/components/SnippetText';

export function ContactSidebar({
    loading, error, contacts, filteredContacts, selectedId,
    searchQuery, searchActive, filterAwaiting,
    searchResults, searchTruncated, searchLoading, searchUnavailable,
    onSearchChange, onToggleAwaiting, onSelectContact, onOpenResult,
    onNewContact, onRetry,
}: {
    loading: boolean;
    error: boolean;
    contacts: Contact[];
    filteredContacts: Contact[];
    selectedId: number | null;
    searchQuery: string;
    searchActive: boolean;
    filterAwaiting: boolean;
    searchResults: SearchResult[];
    searchTruncated: boolean;
    searchLoading: boolean;
    searchUnavailable: boolean;
    onSearchChange: (value: string) => void;
    onToggleAwaiting: () => void;
    onSelectContact: (id: number) => void;
    onOpenResult: (result: SearchResult) => void;
    onNewContact: () => void;
    onRetry: () => void;
}) {
    return (
        <aside className="w-72 flex-shrink-0 border-r border-white/20 flex flex-col min-h-0">
            <div className="flex-shrink-0 flex items-center gap-2 px-4 h-11 border-b border-white/20">
                <span className="text-xs text-white/65 uppercase tracking-wider font-sans">Contacts</span>
                {!loading && contacts.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-white/40 font-sans">
                        <span className="text-white/30">—</span>
                        <span>{contacts.length}</span>
                        {contacts.filter(c => c.awaiting_reply).length > 0 && (
                            <span className="flex items-center">
                                ({' '}<span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />{' '}{contacts.filter(c => c.awaiting_reply).length}{' '})
                            </span>
                        )}
                    </div>
                )}
                <span className="flex-1" />
                <button
                    onClick={onNewContact}
                    className="text-sm text-[#ffd54f]/60 hover:text-[#ffd54f] transition-colors cursor-pointer font-sans"
                >
                    + New
                </button>
            </div>
            <div className="flex-shrink-0 flex items-center gap-2 px-4 h-11 border-b border-white/20">
                <svg className="text-white/35 shrink-0" width="13" height="13" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.5"/>
                    <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <input
                    className="flex-1 bg-transparent text-white text-xs font-sans focus:outline-none placeholder:text-white/30"
                    placeholder="Search contacts and mail…"
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                />
                {searchQuery && (
                    <button
                        onClick={() => onSearchChange('')}
                        className="text-white/35 hover:text-white/70 transition-colors cursor-pointer font-sans text-xs"
                    >
                        ✕
                    </button>
                )}
                <button
                    onClick={onToggleAwaiting}
                    title="Show only contacts awaiting reply"
                    className={`flex items-center justify-center w-6 h-6 border transition-colors cursor-pointer ${filterAwaiting ? 'border-[#ffd54f]/50 text-[#ffd54f]' : 'border-white/15 text-white/35 hover:text-white/60 hover:border-white/30'}`}
                >
                    <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto">
                {loading && (
                    <p className="text-sm text-white/55 text-center py-8 font-sans">Loading…</p>
                )}
                {!loading && error && (
                    <div className="text-center py-8 flex flex-col items-center gap-3">
                        <p className="text-sm text-white/55 font-sans">Failed to load contacts</p>
                        <button onClick={onRetry} className="text-xs font-sans text-white/50 hover:text-white/80 transition-colors">Retry</button>
                    </div>
                )}
                {!loading && !error && contacts.length === 0 && (
                    <p className="text-sm text-white/55 text-center py-8 font-sans">No contacts yet</p>
                )}
                {!loading && contacts.length > 0 && filteredContacts.length === 0 && !searchActive && (
                    <p className="text-sm text-white/55 text-center py-8 font-sans">No matches</p>
                )}
                {searchActive && !loading && contacts.length > 0 && (
                    <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-white/40 font-sans border-b border-white/10">
                        Contacts {filteredContacts.length > 0 && `· ${filteredContacts.length}`}
                    </div>
                )}
                {searchActive && filteredContacts.length === 0 && (
                    <p className="text-xs text-white/40 px-4 py-3 font-sans">No matching contacts</p>
                )}
                {filteredContacts.map(c => (
                    <button
                        key={c.id}
                        onClick={() => onSelectContact(c.id)}
                        className={`w-full text-left px-4 py-3.5 border-b border-white/10 transition-colors hover:bg-white/[0.07] cursor-pointer ${selectedId === c.id ? 'bg-white/[0.08] border-l-2 border-l-[#ffd54f] pl-[14px]' : ''}`}
                    >
                        <div className="flex items-center gap-2">
                            <div className="text-sm font-semibold text-white truncate font-sans">{c.name}</div>
                            {!!c.awaiting_reply && <span className="w-1.5 h-1.5 rounded-full bg-[#ffd54f] shrink-0" />}
                        </div>
                        <div className="text-xs text-white/60 truncate mt-0.5 font-sans">{c.email}</div>
                        {c.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {c.tags.map(t => <TagChip key={t.id} tag={t} />)}
                            </div>
                        )}
                    </button>
                ))}

                {searchActive && (
                    <>
                        <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-white/40 font-sans border-y border-white/10 flex items-center gap-1.5">
                            <span>Messages</span>
                            {searchResults.length > 0 && (
                                <span>· {searchResults.length}{searchTruncated ? '+' : ''}</span>
                            )}
                            {searchLoading && <span className="text-white/25 normal-case tracking-normal">searching…</span>}
                        </div>
                        {searchUnavailable && (
                            <p className="text-xs text-white/40 px-4 py-3 font-sans">
                                Search index not installed. Apply
                                {' '}<span className="text-white/55">db/migrations/004-email-fts.sql</span>.
                            </p>
                        )}
                        {!searchUnavailable && !searchLoading && searchResults.length === 0 && (
                            <p className="text-xs text-white/40 px-4 py-3 font-sans">No matching messages</p>
                        )}
                        {searchResults.map(r => (
                            <button
                                key={r.id}
                                onClick={() => onOpenResult(r)}
                                className="w-full text-left px-4 py-3 border-b border-white/10 transition-colors hover:bg-white/[0.07] cursor-pointer"
                            >
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-xs text-white/70 truncate font-sans">{r.contact_name}</span>
                                    <span className="text-[10px] text-white/35 font-sans shrink-0">
                                        {r.sent_at ? formatDate(r.sent_at).split(',')[0] : 'draft'}
                                    </span>
                                </div>
                                <div className="text-xs text-white/90 truncate mt-0.5 font-sans">
                                    {r.subject || '(no subject)'}
                                </div>
                                <div className="text-[11px] text-white/45 mt-1 font-sans line-clamp-2 whitespace-pre-wrap break-words">
                                    <SnippetText snippet={r.snippet} />
                                </div>
                            </button>
                        ))}
                        {searchTruncated && (
                            <p className="text-[11px] text-white/35 px-4 py-2 font-sans">
                                Showing the first {searchResults.length}; narrow the search for more.
                            </p>
                        )}
                    </>
                )}
            </div>
        </aside>
    );
}
