'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import type { AppConfig, Attachment, Contact, EmailRecord, SearchResult } from '@/lib/types';
import { fuzzyMatch } from '@/lib/format';
import { useEmailSearch } from '@/hooks/useEmailSearch';
import { ContactSidebar } from '@/components/ContactSidebar';
import { ContactForm } from '@/components/ContactForm';
import { EmailCard } from '@/components/EmailCard';
import { NewEmailCard } from '@/components/NewEmailCard';
import { ForwardModal } from '@/components/ForwardModal';
import { SendModal, type SendResult } from '@/components/SendModal';
import { TagChip } from '@/components/TagChip';
import { Wordmark } from '@/components/Wordmark';
import { btnGhost, btnDanger, btnDangerOutline, btnGold } from '@/components/styles';

const POLL_INTERVAL_MS = 5_000;
const HIGHLIGHT_MS = 2_500;

// A refetch is forced this often regardless of the revision, so a write path
// that ever lands without a trigger behind it degrades to a slow refresh rather
// than a stuck view.
const FALLBACK_REFRESH_MS = 60_000;

export default function OutreachPage() {
    const router = useRouter();
    const apiFetch = (...args: Parameters<typeof fetch>): Promise<Response> =>
        fetch(...args).then(res => { if (res.status === 401) router.push('/login'); return res; });

    const [config, setConfig] = useState<AppConfig | null>(null);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(() => {
        if (typeof window === 'undefined') return null;
        const stored = localStorage.getItem('mf_contact');
        const parsed = stored ? parseInt(stored, 10) : NaN;
        // A corrupt stored value must not become a NaN id and fetch
        // /api/contacts/NaN/emails on every poll.
        return Number.isNaN(parsed) ? null : parsed;
    });
    const [emails, setEmails] = useState<EmailRecord[]>([]);
    const [loadingContacts, setLoadingContacts] = useState(true);
    const [contactsError, setContactsError] = useState(false);
    const [loadingEmails, setLoadingEmails] = useState(false);
    const [emailsError, setEmailsError] = useState(false);
    // Below md the sidebar is an overlay drawer; this opens it.
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [apiError, setApiError] = useState<string | null>(null);

    const [addingContact, setAddingContact] = useState(false);
    const [addContactForm, setAddContactForm] = useState<Partial<Contact>>({});
    const [editContact, setEditContact] = useState<Partial<Contact> | null>(null);
    const [contactSaveError, setContactSaveError] = useState<string | null>(null);
    const [filterAwaiting, setFilterAwaiting] = useState(false);
    // Set when a result is clicked for a contact whose emails are not loaded
    // yet; the scroll happens once they arrive.
    const [pendingScrollId, setPendingScrollId] = useState<number | null>(null);
    const [highlightId, setHighlightId] = useState<number | null>(null);

    const [addingEmail, setAddingEmail] = useState(false);
    const [replyToEmail, setReplyToEmail] = useState<EmailRecord | null>(null);
    // Empty for a plain reply; Reply All fills it with the parent's other
    // recipients. Part of the composer's remount key.
    const [replyInitialCc, setReplyInitialCc] = useState('');
    const [editingEmailId, setEditingEmailId] = useState<number | null>(null);

    const [forwardingEmail, setForwardingEmail] = useState<EmailRecord | null>(null);
    const [forwardBusy, setForwardBusy] = useState(false);
    const [forwardError, setForwardError] = useState<string | null>(null);

    const [showSendModal, setShowSendModal] = useState(false);
    const [sendingEmails, setSendingEmails] = useState(false);
    const [pendingCount, setPendingCount] = useState<number | null>(null);
    const [sendResult, setSendResult] = useState<SendResult | null>(null);

    // How many other sessions the presence table saw inside its window,
    // reported alongside the revision on every poll. Zero also covers
    // "unknown" (a database predating migration 008): no notice either way.
    const [activeOthers, setActiveOthers] = useState(0);

    const search = useEmailSearch(apiFetch);

    // Last revision the currently held data was read against, and when the last
    // unconditional refetch happened. Refs, not state: the poll reads them
    // without needing to re-render or restart its interval.
    const lastRevision = useRef<number | null>(null);
    const lastFullRefresh = useRef(0);
    // Mirror of selectedId for in-flight email fetches: a slow response for a
    // contact the user has already switched away from must not overwrite the
    // new contact's thread. Kept in step by the selectedId effect below.
    const selectedIdRef = useRef<number | null>(selectedId);

    const selectedContact = contacts.find(c => c.id === selectedId) ?? null;
    const orgName = config?.orgName || 'Mistflame';
    const sendAddrs = config?.sendAddrs ?? [];
    const filteredContacts = contacts.filter(c => {
        if (filterAwaiting && !c.awaiting_reply) return false;
        if (!search.trimmed) return true;
        return (
            fuzzyMatch(search.trimmed, c.name) ||
            fuzzyMatch(search.trimmed, c.email) ||
            c.tags.some(t => fuzzyMatch(search.trimmed, t.name))
        );
    });

    // Helper: fetch, check ok, parse JSON. Rejects on non-ok so .catch handles it.
    const json = <T,>(res: Response): Promise<T> => res.ok ? res.json() as Promise<T> : Promise.reject();

    const fetchEmails = (id: number) =>
        apiFetch(`/api/contacts/${id}/emails`)
            .then(r => json<{ emails?: EmailRecord[] }>(r))
            .then(data => {
                if (selectedIdRef.current !== id) return;
                setEmailsError(false);
                setEmails(prev => {
                    const next = data.emails ?? [];
                    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
                });
            })
            .catch(() => {
                if (selectedIdRef.current === id) setEmailsError(true);
            });

    const retryEmails = () => {
        if (selectedId === null) return;
        setLoadingEmails(true);
        fetchEmails(selectedId).finally(() => setLoadingEmails(false));
    };

    const fetchPendingCount = () => {
        apiFetch('/api/send-emails')
            .then(r => json<{ count?: number }>(r))
            .then(data => setPendingCount(prev => {
                const next = data.count ?? 0;
                return prev === next ? prev : next;
            }))
            .catch(() => setPendingCount(0));
    };

    const fetchContacts = () => {
        setLoadingContacts(true);
        setContactsError(false);
        apiFetch('/api/contacts')
            .then(r => json<{ contacts?: Contact[] }>(r))
            .then(data => {
                setContacts(prev => {
                    const next = data.contacts ?? [];
                    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
                });
                setContactsError(false);
            })
            .catch(() => setContactsError(true))
            .finally(() => setLoadingContacts(false));
    };

    const fetchRevision = (): Promise<number | null> =>
        apiFetch('/api/revision')
            .then(r => json<{ revision?: number | null; activeOthers?: number | null }>(r))
            .then(data => {
                setActiveOthers(data.activeOthers ?? 0);
                return data.revision ?? null;
            });

    const refreshContacts = () => {
        apiFetch('/api/contacts')
            .then(r => json<{ contacts?: Contact[] }>(r))
            .then(data => {
                setContacts(prev => {
                    const next = data.contacts ?? [];
                    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
                });
            })
            .catch(() => {}); // keep existing contacts on error
    };

    const refreshPendingCount = () => {
        apiFetch('/api/send-emails')
            .then(r => json<{ count?: number }>(r))
            .then(data => setPendingCount(data.count ?? 0))
            .catch(() => {});
    };

    useEffect(() => {
        apiFetch('/api/config')
            .then(r => r.json())
            .then((data: unknown) => setConfig(data as AppConfig))
            .catch(() => {});
        fetchContacts();
        fetchPendingCount();
        // Start the fallback clock here, so the first poll goes through the
        // revision check rather than straight to a refetch.
        lastFullRefresh.current = Date.now();
        // lastRevision is deliberately left unset: the first poll then always
        // refetches, which picks up anything written while the page was
        // loading. Recording it here would race the two fetches above and could
        // store a revision newer than the data they returned.
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (selectedId === null) { setEmails([]); return; }
        setEmails([]);
        setLoadingEmails(true);
        fetchEmails(selectedId).finally(() => setLoadingEmails(false));
    }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const refreshAll = () => {
            lastFullRefresh.current = Date.now();
            if (selectedId !== null) fetchEmails(selectedId);
            refreshContacts();
            fetchPendingCount();
        };
        const poll = () => {
            if (document.visibilityState !== 'visible') return;
            if (Date.now() - lastFullRefresh.current >= FALLBACK_REFRESH_MS) {
                refreshAll();
                return;
            }
            // The revision is recorded before the lists are read, so a write
            // landing between the two still reads as a change on the next poll.
            // The cost of that ordering is the occasional redundant refetch,
            // which is the right way round to be wrong.
            fetchRevision()
                .then(revision => {
                    if (revision !== null && revision === lastRevision.current) return;
                    lastRevision.current = revision;
                    refreshAll();
                })
                .catch(() => {});
        };
        const interval = setInterval(poll, POLL_INTERVAL_MS);
        document.addEventListener('visibilitychange', poll);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', poll);
        };
    }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        selectedIdRef.current = selectedId;
        if (selectedId === null) localStorage.removeItem('mf_contact');
        else localStorage.setItem('mf_contact', String(selectedId));
    }, [selectedId]);

    const scrollToEmail = (id: number) => {
        const el = document.getElementById(`email-${id}`);
        if (!el) return false;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightId(id);
        return true;
    };

    // A result for another contact switches to it first; the card only exists
    // once that contact's emails have loaded. rAF because the scroll wants the
    // committed layout, not the state that produced it.
    useEffect(() => {
        if (pendingScrollId === null) return;
        if (!emails.some(e => e.id === pendingScrollId)) return;
        const frame = requestAnimationFrame(() => {
            scrollToEmail(pendingScrollId);
            setPendingScrollId(null);
        });
        return () => cancelAnimationFrame(frame);
    }, [emails, pendingScrollId]);

    useEffect(() => {
        if (highlightId === null) return;
        const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
        return () => clearTimeout(timer);
    }, [highlightId]);

    /** Returns false when a discard prompt was declined and nothing changed. */
    const selectContact = (id: number): boolean => {
        // Re-selecting the current contact changes nothing; without this it
        // would prompt to discard an open composer and then wipe it.
        if (id === selectedId) {
            setSidebarOpen(false);
            return true;
        }
        if (addingContact && (addContactForm.name || addContactForm.email || addContactForm.description)) {
            if (!confirm('Discard new contact?')) return false;
        } else if (editContact) {
            if (!confirm('Discard unsaved changes?')) return false;
        } else if (addingEmail || replyToEmail) {
            if (!confirm('Discard unsaved email?')) return false;
        } else if (editingEmailId !== null) {
            if (!confirm('Discard unsaved email edits?')) return false;
        }
        setSidebarOpen(false);
        setSelectedId(id);
        setAddingContact(false);
        setAddContactForm({});
        setEditContact(null);
        setContactSaveError(null);
        setAddingEmail(false);
        setReplyToEmail(null);
        setEditingEmailId(null);
        setApiError(null);
        return true;
    };

    const startAddContact = () => {
        if (addingContact && (addContactForm.name || addContactForm.email || addContactForm.description) && !confirm('Discard new contact?')) return;
        if (editContact && !confirm('Discard unsaved changes?')) return;
        if ((addingEmail || replyToEmail) && !confirm('Discard unsaved email?')) return;
        if (editingEmailId !== null && !confirm('Discard unsaved email edits?')) return;
        setSidebarOpen(false);
        setAddingContact(true);
        setSelectedId(null);
        setEditContact(null);
        setAddContactForm({});
        setContactSaveError(null);
        setAddingEmail(false);
        setReplyToEmail(null);
        setEditingEmailId(null);
        setApiError(null);
    };

    const openSearchResult = (result: SearchResult) => {
        if (result.contact_id === selectedId) {
            setSidebarOpen(false);
            scrollToEmail(result.id);
            return;
        }
        if (!selectContact(result.contact_id)) return;
        // The contact's emails are fetched by the selectedId effect; the scroll
        // waits for them to arrive.
        setPendingScrollId(result.id);
    };

    // Coarse dirty flag: an open composer, edit or filled contact form. The
    // body text lives in the child components, so "open" stands in for
    // "dirty", matching the in-app discard prompts.
    const hasUnsavedWork = addingEmail || replyToEmail !== null
        || editingEmailId !== null || editContact !== null
        || (addingContact && !!(addContactForm.name || addContactForm.email || addContactForm.description));

    useEffect(() => {
        if (!hasUnsavedWork) return;
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [hasUnsavedWork]);

    const logout = async () => {
        if (hasUnsavedWork && !confirm('Discard unsaved changes and log out?')) return;
        await fetch('/api/auth', { method: 'DELETE' });
        router.push('/login');
    };

    const openSendModal = () => {
        setShowSendModal(true);
        setSendResult(null);
        refreshPendingCount();
    };

    const sendEmails = async () => {
        setSendingEmails(true);
        try {
            const res = await apiFetch('/api/send-emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ send_all: true }),
            });
            const data = (await res.json()) as { sent?: number; failed?: number; errors?: string[] };
            setSendResult({ sent: data.sent ?? 0, failed: data.failed ?? 0, errors: data.errors ?? [] });
            refreshPendingCount();
            refreshContacts();
        } catch {
            setSendResult({ sent: 0, failed: 0, errors: ['Network error — could not reach the server.'] });
        } finally {
            setSendingEmails(false);
        }
    };

    const addContact = async () => {
        setSaving(true);
        setContactSaveError(null);
        try {
            const res = await apiFetch('/api/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(addContactForm),
            });
            const data = (await res.json()) as { contact?: Contact; error?: string };
            if (res.ok && data.contact) {
                setContacts(prev => [...prev, data.contact!].sort((a, b) => a.name.localeCompare(b.name)));
                setAddContactForm({});
                setAddingContact(false);
                setSelectedId(data.contact.id);
            } else {
                setContactSaveError(data.error ?? 'Failed to save contact.');
            }
        } catch {
            setContactSaveError('Network error — could not reach the server.');
        } finally { setSaving(false); }
    };

    const saveContact = async () => {
        if (!editContact?.id) return;
        setSaving(true);
        setContactSaveError(null);
        try {
            const res = await apiFetch(`/api/contacts/${editContact.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editContact),
            });
            const data = (await res.json()) as { ok: boolean; error?: string };
            if (res.ok) {
                setEditContact(null);
                setContactSaveError(null);
                refreshContacts();
            } else {
                setContactSaveError(data.error ?? 'Failed to save contact.');
            }
        } catch {
            setContactSaveError('Network error — could not reach the server.');
        } finally { setSaving(false); }
    };

    const deleteContact = async (id: number) => {
        if (!confirm('Delete this contact and all their emails?')) return;
        setApiError(null);
        try {
            const res = await apiFetch(`/api/contacts/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setContacts(prev => prev.filter(c => c.id !== id));
                if (selectedId === id) setSelectedId(null);
            } else {
                setApiError('The contact could not be deleted.');
            }
        } catch {
            setApiError('Network error — could not reach the server.');
        }
    };

    // No editingEmailId guard here or in startReply: an in-place edit lives in
    // its EmailCard's local state and survives a composer opening unharmed.
    const startAddEmail = () => {
        if (addingEmail && !confirm('Discard unsaved email?')) return;
        setReplyToEmail(null);
        setReplyInitialCc('');
        setAddingEmail(true);
    };

    const startReply = (email: EmailRecord, all = false) => {
        if (addingEmail && !confirm('Discard unsaved email?')) return;
        // Reply All: the parent's other To recipients and CC move into CC,
        // minus everything that gets a copy anyway (the contact, or the
        // Reply-To standing in for them) and every address that is us (our
        // send addresses, plus the one that received the parent; a catch-all
        // route means it may not be listed in SEND_ADDRS).
        let cc = '';
        if (all) {
            const excluded = new Set([
                ...sendAddrs.map(a => a.toLowerCase()),
                ...(selectedContact ? [selectedContact.email.toLowerCase()] : []),
                ...(email.recipient ? [email.recipient.toLowerCase()] : []),
                ...(email.reply_to ? [email.reply_to.toLowerCase()] : []),
            ]);
            cc = [...(email.to_addrs ?? '').split(','), ...(email.cc ?? '').split(',')]
                .map(a => a.trim()).filter(Boolean)
                .filter(a => {
                    const key = a.toLowerCase();
                    if (excluded.has(key)) return false;
                    excluded.add(key);
                    return true;
                })
                .join(', ');
        }
        setReplyToEmail(email);
        setReplyInitialCc(cc);
        setAddingEmail(true);
    };

    const addEmail = async (sender: string | null, subject: string, body: string, cc: string, toAddrs: string, bcc: string, files: File[]) => {
        if (!selectedId) return;
        setSaving(true);
        setApiError(null);
        try {
            const payload = {
                sender,
                subject: subject.trim() || null,
                body,
                // Everything composed in the UI is markdown; 'text' marks
                // inbound rows and rows predating migration 007.
                body_format: 'markdown',
                cc: cc.trim() || null,
                to_addrs: toAddrs.trim() || null,
                bcc: bcc.trim() || null,
                parent_id: replyToEmail?.id ?? null,
            };
            const res = await apiFetch(`/api/contacts/${selectedId}/emails`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = (await res.json()) as { email?: Omit<EmailRecord, 'attachments'>; error?: string };
            if (res.ok && data.email) {
                const emailId = data.email.id;
                const uploadedAttachments: Attachment[] = [];
                for (const file of files) {
                    const formData = new FormData();
                    formData.append('file', file);
                    const attRes = await apiFetch(`/api/contacts/${selectedId}/emails/${emailId}/attachments`, {
                        method: 'POST',
                        body: formData,
                    });
                    const attData = (await attRes.json()) as { attachment?: Attachment };
                    if (attRes.ok && attData.attachment) uploadedAttachments.push(attData.attachment);
                }
                setEmails(prev => [...prev, { ...data.email!, attachments: uploadedAttachments }]);
                setAddingEmail(false);
                setReplyToEmail(null);
                refreshPendingCount();
                refreshContacts();
                const failedUploads = files.length - uploadedAttachments.length;
                if (failedUploads > 0) {
                    setApiError(`Email saved, but ${failedUploads} attachment${failedUploads > 1 ? 's' : ''} failed to upload.`);
                }
            } else {
                setApiError(data.error ?? `Server error (${res.status})`);
            }
        } catch {
            setApiError('Network error — could not reach the server.');
        } finally { setSaving(false); }
    };

    const uploadAttachment = async (emailId: number, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await apiFetch(`/api/contacts/${selectedId}/emails/${emailId}/attachments`, {
            method: 'POST',
            body: formData,
        });
        const data = (await res.json()) as { attachment?: Attachment; error?: string };
        if (res.ok && data.attachment) {
            setEmails(prev => prev.map(e => e.id === emailId ? { ...e, attachments: [...e.attachments, data.attachment!] } : e));
        } else {
            throw new Error(data.error ?? 'Upload failed');
        }
    };

    const deleteAttachment = async (emailId: number, attachmentId: number) => {
        if (!confirm('Delete this attachment?')) return;
        setApiError(null);
        try {
            const res = await apiFetch(`/api/contacts/${selectedId}/emails/${emailId}/attachments/${attachmentId}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                setEmails(prev => prev.map(e => e.id === emailId ? { ...e, attachments: e.attachments.filter(a => a.id !== attachmentId) } : e));
            } else {
                setApiError('The attachment could not be deleted.');
            }
        } catch {
            setApiError('Network error — could not reach the server.');
        }
    };

    const sendSingleEmail = async (emailId: number) => {
        setApiError(null);
        try {
            const res = await apiFetch('/api/send-emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email_id: emailId }),
            });
            const data = (await res.json()) as { sent?: number; failed?: number; errors?: string[]; error?: string };
            // The endpoint reports send failures inside the body of a 200, so
            // res.ok alone would read a failed send as success and say nothing.
            if (!res.ok || (data.failed ?? 0) > 0 || (data.errors?.length ?? 0) > 0 || (data.sent ?? 0) === 0) {
                setApiError(data.errors?.length ? data.errors.join('; ') : (data.error ?? 'The email was not sent.'));
            }
            refreshPendingCount();
            if (selectedId !== null) fetchEmails(selectedId);
            refreshContacts();
        } catch {
            setApiError('Network error — could not reach the server.');
        }
    };

    const editEmail = async (emailId: number, sender: string | null, subject: string, body: string, cc: string, toAddrs: string, bcc: string) => {
        // Saving through the markdown editor makes the draft markdown, even
        // one created as 'text' before the editor became markdown-only.
        // Failures are rethrown with a readable message; EmailCard shows them
        // next to its Save button.
        let res: Response;
        try {
            res = await apiFetch(`/api/contacts/${selectedId}/emails/${emailId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender, subject: subject.trim() || null, body, body_format: 'markdown', cc: cc.trim() || null, to_addrs: toAddrs.trim() || null, bcc: bcc.trim() || null }),
            });
        } catch {
            throw new Error('Network error — could not reach the server.');
        }
        if (res.ok) {
            // Only the row itself changes: an edit cannot alter parent_id or
            // null the sender, so the contact's awaiting_reply is unaffected.
            setEmails(prev => prev.map(e => e.id === emailId ? { ...e, sender, subject: subject.trim() || null, body, body_format: 'markdown' as const, cc: cc.trim() || null, to_addrs: toAddrs.trim() || null, bcc: bcc.trim() || null } : e));
        } else {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(data.error ?? 'Failed to save');
        }
    };

    const deleteEmail = async (id: number) => {
        if (!confirm('Delete this email and all its replies?')) return;
        setApiError(null);
        try {
            const res = await apiFetch(`/api/contacts/${selectedId}/emails/${id}`, { method: 'DELETE' });
            if (res.ok) {
                const data = (await res.json()) as { deleted?: number };
                if ((data.deleted ?? 1) > 1) {
                    if (selectedId !== null) fetchEmails(selectedId);
                } else {
                    setEmails(prev => prev.filter(e => e.id !== id));
                }
                refreshPendingCount();
                refreshContacts();
            } else {
                setApiError('The email could not be deleted.');
            }
        } catch {
            setApiError('Network error — could not reach the server.');
        }
    };

    const startForward = (email: EmailRecord) => {
        setForwardError(null);
        setForwardingEmail(email);
    };

    const forwardEmail = async (targetId: number) => {
        if (!forwardingEmail) return;
        setForwardBusy(true);
        setForwardError(null);
        try {
            // Prefer the address the source arrived on, so a forward goes out
            // from the mailbox that saw the original; a catch-all recipient
            // not in SEND_ADDRS falls back to the first configured address.
            const sender = forwardingEmail.recipient && sendAddrs.includes(forwardingEmail.recipient)
                ? forwardingEmail.recipient
                : sendAddrs[0] ?? null;
            const res = await apiFetch(`/api/contacts/${targetId}/emails/forward`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_id: forwardingEmail.id, sender }),
            });
            const data = (await res.json()) as { email_id?: number; attachments_failed?: number; error?: string };
            if (!res.ok || !data.email_id) {
                setForwardError(data.error ?? `Server error (${res.status})`);
                return;
            }
            setForwardingEmail(null);
            if (targetId === selectedId) {
                // The selectedId effect does not refire on an unchanged id.
                fetchEmails(targetId);
            } else if (!selectContact(targetId)) {
                return;
            }
            setPendingScrollId(data.email_id);
            if ((data.attachments_failed ?? 0) > 0) {
                setApiError(`Forward created, but ${data.attachments_failed} attachment${data.attachments_failed! > 1 ? 's' : ''} could not be copied.`);
            }
            refreshPendingCount();
            refreshContacts();
        } catch {
            setForwardError('Network error — could not reach the server.');
        } finally {
            setForwardBusy(false);
        }
    };

    const createContactAndForward = async (address: string) => {
        setForwardBusy(true);
        setForwardError(null);
        try {
            const res = await apiFetch('/api/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Same convention as receiver-created contacts: the address
                // stands in for the name until someone edits it.
                body: JSON.stringify({ name: address, email: address }),
            });
            const data = (await res.json()) as { contact?: Contact; error?: string };
            if (!res.ok || !data.contact) {
                setForwardError(data.error ?? 'Failed to create contact.');
                return;
            }
            setContacts(prev => [...prev, data.contact!].sort((a, b) => a.name.localeCompare(b.name)));
            await forwardEmail(data.contact.id);
        } catch {
            setForwardError('Network error — could not reach the server.');
        } finally {
            setForwardBusy(false);
        }
    };

    const emailById = useMemo(() => new Map(emails.map(e => [e.id, e])), [emails]);

    const threadGroups = useMemo(() => {
        const groups = new Map<number, EmailRecord[]>();
        for (const email of emails) {
            if (!groups.has(email.thread_id)) groups.set(email.thread_id, []);
            groups.get(email.thread_id)!.push(email);
        }
        return Array.from(groups.entries())
            .sort((a, b) => (a[1][0].sent_at ?? '9999').localeCompare(b[1][0].sent_at ?? '9999'));
    }, [emails]);

    const nextThreadId = useMemo(() => threadGroups.length + 1, [threadGroups]);

    const composeRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (addingEmail) {
            composeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [addingEmail, replyToEmail]);

    return (
        <div className="h-dvh bg-black text-white flex flex-col overflow-hidden">
            {/* Header */}
            <header className="flex-shrink-0 border-b border-white/25 px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                <button
                    onClick={() => setSidebarOpen(v => !v)}
                    className="md:hidden shrink-0 p-1.5 border border-white/20 text-white/65 hover:text-white hover:border-white/40 transition-colors cursor-pointer"
                    title="Contacts"
                >
                    <Menu className="w-4 h-4" />
                </button>
                <Wordmark orgName={config?.orgName ?? ''} className="text-xl min-w-0 truncate" />
                <div className="flex items-center gap-3 ml-auto">
                    {activeOthers > 0 && (
                        <span className="hidden lg:inline text-sm text-gold/65" title="Someone else is logged in and using the app right now">
                            {activeOthers} other session{activeOthers === 1 ? '' : 's'} active
                        </span>
                    )}
                    <button onClick={openSendModal} disabled={pendingCount === 0} className={`whitespace-nowrap shrink-0 text-sm border px-4 py-2 transition-colors ${pendingCount === 0 ? 'text-gold/30 border-gold/10 cursor-not-allowed' : 'text-gold/70 hover:text-gold border-gold/25 hover:border-gold/55 cursor-pointer'}`}>
                        Send emails{pendingCount ? ` (${pendingCount})` : ''}
                    </button>
                    <button onClick={logout} className={`${btnGhost} whitespace-nowrap shrink-0`}>
                        Log out
                    </button>
                </div>
            </header>

            <div className="flex flex-1 min-h-0">
                <ContactSidebar
                    loading={loadingContacts}
                    error={contactsError}
                    contacts={contacts}
                    filteredContacts={filteredContacts}
                    selectedId={selectedId}
                    searchQuery={search.query}
                    searchActive={search.active}
                    filterAwaiting={filterAwaiting}
                    searchResults={search.results}
                    searchTruncated={search.truncated}
                    searchLoading={search.loading}
                    searchUnavailable={search.unavailable}
                    onSearchChange={search.setQuery}
                    onToggleAwaiting={() => setFilterAwaiting(v => !v)}
                    onSelectContact={selectContact}
                    onOpenResult={openSearchResult}
                    onNewContact={startAddContact}
                    onRetry={fetchContacts}
                    mobileOpen={sidebarOpen}
                    onCloseMobile={() => setSidebarOpen(false)}
                />

                {/* Main area */}
                <main className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 min-w-0">
                    {addingContact && (
                        <section className="mb-8">
                            <h2 className="font-heading-bold text-lg tracking-wide text-white mb-4">New Contact</h2>
                            <ContactForm
                                value={addContactForm}
                                onChange={v => { setAddContactForm(v); setContactSaveError(null); }}
                                onSave={addContact}
                                onCancel={() => { setAddingContact(false); setAddContactForm({}); setContactSaveError(null); }}
                                saving={saving}
                                saveError={contactSaveError}
                            />
                        </section>
                    )}

                    {selectedContact && !addingContact && (
                        <>
                            <section className="mb-6 pb-6 border-b border-white/20">
                                {editContact ? (
                                    <>
                                        <h2 className="font-heading-bold text-lg tracking-wide text-white mb-4">Edit Contact</h2>
                                        <ContactForm
                                            value={editContact}
                                            onChange={v => { setEditContact(v); setContactSaveError(null); }}
                                            onSave={saveContact}
                                            onCancel={() => { setEditContact(null); setContactSaveError(null); }}
                                            saving={saving}
                                            saveError={contactSaveError}
                                        />
                                    </>
                                ) : (
                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <h2 className="font-heading-bold text-xl tracking-wide text-white break-words">{selectedContact.name}</h2>
                                                <div className="flex flex-wrap items-center gap-3 mt-1">
                                                    <a
                                                        href={`mailto:${selectedContact.email}`}
                                                        className="text-sm text-gold/70 hover:text-gold transition-colors min-w-0 break-all"
                                                    >
                                                        {selectedContact.email}
                                                    </a>
                                                </div>
                                                {selectedContact.tags.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                                        {selectedContact.tags.map(t => <TagChip key={t.id} tag={t} />)}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <button onClick={() => setEditContact({ ...selectedContact })} className={btnGhost}>
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => deleteContact(selectedContact.id)}
                                                    className={btnDangerOutline}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                        {selectedContact.description && (
                                            <p className="text-sm text-white/75 leading-relaxed break-words">{selectedContact.description}</p>
                                        )}
                                    </div>
                                )}
                            </section>

                            <section>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-xs text-white/65 uppercase tracking-wider">
                                        Email History {emails.length > 0 && <span className="text-white/45 normal-case tracking-normal">({emails.length})</span>}
                                    </h3>
                                    {!addingEmail && !editContact && (
                                        <button onClick={startAddEmail} className={btnGold}>
                                            + Email
                                        </button>
                                    )}
                                </div>

                                {apiError && (
                                    <div className="flex items-start justify-between gap-3 mb-4 px-1">
                                        <p className="text-sm text-red-400 break-words">{apiError}</p>
                                        <button onClick={() => setApiError(null)} className={`${btnDanger} p-1 -m-1 mt-1`} title="Dismiss">✕</button>
                                    </div>
                                )}
                                {loadingEmails && emails.length === 0 && <p className="text-sm text-white/55 text-center py-6">Loading…</p>}
                                {!loadingEmails && emails.length === 0 && !addingEmail && (emailsError ? (
                                    <div className="py-6 flex flex-col items-center gap-3">
                                        <p className="text-sm text-white/55">Failed to load emails</p>
                                        <button onClick={retryEmails} className="text-xs text-white/50 hover:text-white/80 transition-colors cursor-pointer">Retry</button>
                                    </div>
                                ) : (
                                    <p className="text-sm text-white/55 text-center py-6">No emails on record</p>
                                ))}
                                <div className="flex flex-col gap-4">
                                    {threadGroups.map(([threadId, threadEmails], groupIdx) => {
                                        const threadSender = threadEmails.find(e => e.sender !== null)?.sender ?? null;
                                        const outgoingInThread = threadEmails.filter(e => e.sender !== null);
                                        const replyIds = new Set(threadEmails.map(e => e.parent_id).filter((id): id is number => id !== null));
                                        return (
                                            <div key={threadId} className="flex flex-col gap-2">
                                                {groupIdx > 0 && <div className="h-px bg-white/10 my-1" />}
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs text-white/50">Thread {threadId}</span>
                                                    <span className="text-xs text-white/35">· {threadEmails.length} {threadEmails.length === 1 ? 'email' : 'emails'}</span>
                                                </div>
                                                {threadEmails.map(email => (
                                                    <EmailCard
                                                        key={email.id}
                                                        email={email}
                                                        contactName={selectedContact.name}
                                                        contactEmail={selectedContact.email}
                                                        contacts={contacts}
                                                        parentEmail={email.parent_id != null ? emailById.get(email.parent_id) : null}
                                                        orgName={orgName}
                                                        sendAddrs={sendAddrs}
                                                        threadSender={threadSender}
                                                        senderEditable={email.sender !== null && outgoingInThread.length === 1 && !replyIds.has(email.id)}
                                                        highlighted={highlightId === email.id}
                                                        onReply={() => startReply(email)}
                                                        onReplyAll={() => startReply(email, true)}
                                                        onForward={() => startForward(email)}
                                                        onDelete={() => deleteEmail(email.id)}
                                                        onEdit={(sender, subject, body, cc, toAddrs, bcc) => editEmail(email.id, sender, subject, body, cc, toAddrs, bcc)}
                                                        onSend={() => sendSingleEmail(email.id)}
                                                        onAttachmentUpload={(file) => uploadAttachment(email.id, file)}
                                                        onAttachmentDelete={(attId) => deleteAttachment(email.id, attId)}
                                                        onEditingChange={(ed) => setEditingEmailId(ed ? email.id : null)}
                                                    />
                                                ))}
                                                {addingEmail && replyToEmail?.thread_id === threadId && (
                                                    <div ref={composeRef}>
                                                        {/* Keyed by the reply target and the CC prefill:
                                                            switching to another email, or between Reply and
                                                            Reply all on the same one, must remount the card,
                                                            or its subject and CC keep the old target's. */}
                                                        <NewEmailCard
                                                            key={`${replyToEmail?.id}:${replyInitialCc}`}
                                                            replyTo={replyToEmail}
                                                            contactName={selectedContact.name}
                                                            contactEmail={selectedContact.email}
                                                            contacts={contacts}
                                                            orgName={orgName}
                                                            sendAddrs={sendAddrs}
                                                            threadSender={threadSender}
                                                            initialCc={replyInitialCc}
                                                            saving={saving}
                                                            onSave={addEmail}
                                                            onCancel={() => { setAddingEmail(false); setReplyToEmail(null); }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {addingEmail && !replyToEmail && (
                                        <div ref={composeRef} className="flex flex-col gap-2">
                                            {threadGroups.length > 0 && <div className="h-px bg-white/10 my-1" />}
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs text-white/50">Thread {nextThreadId}</span>
                                            </div>
                                            <NewEmailCard
                                                replyTo={null}
                                                contactName={selectedContact.name}
                                                contactEmail={selectedContact.email}
                                                contacts={contacts}
                                                orgName={orgName}
                                                sendAddrs={sendAddrs}
                                                threadSender={null}
                                                initialCc=""
                                                saving={saving}
                                                onSave={addEmail}
                                                onCancel={() => { setAddingEmail(false); setReplyToEmail(null); }}
                                            />
                                        </div>
                                    )}
                                </div>
                            </section>
                        </>
                    )}

                    {!selectedContact && !addingContact && (
                        <div className="h-full flex items-center justify-center min-h-[200px]">
                            <p className="text-sm text-white/50">← Select a contact or add a new one</p>
                        </div>
                    )}
                </main>
            </div>

            {forwardingEmail && (
                <ForwardModal
                    contacts={contacts}
                    busy={forwardBusy}
                    error={forwardError}
                    onPick={forwardEmail}
                    onCreate={createContactAndForward}
                    onClose={() => { setForwardingEmail(null); setForwardError(null); }}
                />
            )}

            {showSendModal && (
                <SendModal
                    pendingCount={pendingCount}
                    sending={sendingEmails}
                    result={sendResult}
                    onSend={sendEmails}
                    onClose={() => setShowSendModal(false)}
                />
            )}
        </div>
    );
}
