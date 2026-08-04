'use client';

import { useState, useEffect, useMemo } from 'react';

/**
 * The renderer module is imported on demand for the same reason DOMPurify is
 * (see useSanitisedHtml): it must not run during the prerender of the client
 * page, and markdown-it's weight should only be paid once a markdown body or
 * a composer preview is actually on screen. The promise is shared across
 * cards, so a thread full of markdown emails resolves one module.
 */
type Renderer = (source: string) => string;

let rendererPromise: Promise<Renderer> | null = null;

function loadRenderer(): Promise<Renderer> {
    if (!rendererPromise) {
        rendererPromise = import('@/lib/markdown')
            .then(mod => mod.renderMarkdown)
            .catch(err => {
                // Allow a later card to retry rather than wedging on one failure.
                rendererPromise = null;
                throw err;
            });
    }
    return rendererPromise;
}

/**
 * Render markdown source to HTML, or null while the renderer is loading or if
 * it failed to load. Callers fall back to showing the source as plain text,
 * which is exactly what markdown is designed to degrade to. Pass null to
 * opt out entirely (a plain-text body).
 */
export function useMarkdownHtml(source: string | null): string | null {
    // Held in a wrapper object, not as the bare function: setState would take
    // a bare function for an updater and call it with the previous state.
    const [loaded, setLoaded] = useState<{ render: Renderer } | null>(null);
    const render = loaded?.render ?? null;

    useEffect(() => {
        if (source === null || render) return;
        let cancelled = false;
        loadRenderer()
            .then(fn => { if (!cancelled) setLoaded({ render: fn }); })
            .catch(err => {
                // Never silent: the card falls back to showing the source,
                // and without a log there is nothing to distinguish that
                // from a body that was plain text all along.
                console.error('Could not load the markdown renderer', err);
            });
        return () => { cancelled = true; };
    }, [source, render]);

    return useMemo(() => {
        if (source === null || !render) return null;
        try {
            return render(source);
        } catch (err) {
            // One unrenderable body must not take the page down; the caller
            // falls back to the source text.
            console.error('Could not render markdown body', err);
            return null;
        }
    }, [source, render]);
}
