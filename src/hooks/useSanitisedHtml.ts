'use client';

import { useState, useEffect, useMemo } from 'react';
import { sanitiseEmailHtml, type SanitisedEmail } from '@/lib/email-html';
import type { DOMPurify as Purifier } from 'dompurify';
import type { EmailRecord } from '@/lib/types';

/**
 * DOMPurify is imported on demand rather than at module scope: it must not run
 * during the prerender of the client page, and its weight should only be paid
 * once an HTML email is actually on screen. The promise is shared so that a
 * thread full of HTML emails resolves one module.
 */
let purifyPromise: Promise<Purifier> | null = null;

function loadPurifier(): Promise<Purifier> {
    if (!purifyPromise) {
        purifyPromise = import('dompurify')
            .then(({ default: purify }) => {
                if (typeof purify?.addHook !== 'function'
                    || typeof purify?.sanitize !== 'function') {
                    // A DOMPurify evaluated without a usable window returns a bare
                    // factory instead of an instance, which would otherwise fail
                    // later with a confusing "addHook is not a function".
                    throw new Error('dompurify resolved without a usable instance');
                }
                return purify;
            })
            .catch(err => {
                // Allow a later card to retry rather than wedging on one failure.
                purifyPromise = null;
                throw err;
            });
    }
    return purifyPromise;
}

/**
 * Sanitise an email's HTML body, or null when it has none or the sanitiser has
 * not loaded yet. Callers fall back to the plain-text body in both cases, so a
 * failed import degrades to readable text rather than an empty card.
 */
export function useSanitisedHtml(email: EmailRecord, loadImages: boolean): SanitisedEmail | null {
    // Held in a wrapper object, not as the bare instance. A DOMPurify instance is
    // itself callable, so passing it straight to a setState would be taken for an
    // updater function: React would invoke it with the previous state, and
    // DOMPurify(null) returns a window-less factory with no addHook or sanitize.
    // The wrapper makes that mistake a type error rather than a runtime one.
    const [loadedPurifier, setLoadedPurifier] =
        useState<{ purify: Purifier } | null>(null);
    const purifier = loadedPurifier?.purify ?? null;
    // Only inbound mail is rendered as HTML. Our own messages are composed as
    // plain text, so they are shown that way: the HTML rendition of a sent reply
    // exists to carry the quote chain to the recipient, not to be read back here.
    // It stays in body_html regardless, because the next reply quotes it.
    const html = email.sender === null ? email.body_html : null;
    // Polling replaces the attachment array every 10 seconds; depend on the cid
    // mapping itself so a poll does not re-sanitise and rebuild the DOM.
    const cidKey = email.attachments
        .map(a => `${a.id}:${a.content_id ?? ''}`)
        .join(',');

    useEffect(() => {
        if (!html || purifier) return;
        let cancelled = false;
        loadPurifier()
            .then(purify => { if (!cancelled) setLoadedPurifier({ purify }); })
            .catch(err => {
                // Never silent: the card falls back to plain text, and without a
                // log there is nothing to distinguish that from an email that
                // simply had no HTML part.
                console.error('Could not load the HTML sanitiser', err);
            });
        return () => { cancelled = true; };
    }, [html, purifier]);

    return useMemo(() => {
        if (!html || !purifier) return null;
        try {
            return sanitiseEmailHtml(purifier, html, {
                contactId: email.contact_id,
                emailId: email.id,
                attachments: email.attachments,
                loadImages,
            });
        } catch (err) {
            // One unrenderable body must not take the whole page down with it.
            // Returning null falls the card back to its plain-text rendition,
            // which is always populated.
            console.error(`Could not render HTML body of email ${email.id}`, err);
            return null;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [html, purifier, email.contact_id, email.id, cidKey, loadImages]);
}
