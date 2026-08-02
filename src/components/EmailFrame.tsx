'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';

/** Guards against an email whose own CSS inflates the document indefinitely. */
const MAX_FRAME_HEIGHT = 20000;
const MIN_FRAME_HEIGHT = 24;

/**
 * Render a sanitised email in an isolated frame.
 *
 * `sandbox` without `allow-scripts` means nothing in the message can execute, so
 * `allow-same-origin` is safe and lets us read the document to size the frame to
 * its content. `allow-popups` is what makes links clickable, since a sandboxed
 * frame otherwise blocks the new tab, and `allow-popups-to-escape-sandbox` stops
 * the opened page inheriting these restrictions.
 *
 * If the document cannot be read for any reason the card falls back to the
 * plain-text rendition rather than showing an empty box.
 */
export function EmailFrame({ srcDoc, fallback }: { srcDoc: string; fallback: ReactNode }) {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const observerRef = useRef<ResizeObserver | null>(null);
    const [height, setHeight] = useState(80);
    const [failed, setFailed] = useState(false);

    useEffect(() => () => observerRef.current?.disconnect(), []);

    const handleLoad = () => {
        const body = frameRef.current?.contentDocument?.body;
        if (!body) {
            console.error('Email frame document was not readable; showing plain text.');
            setFailed(true);
            return;
        }
        // body height stays content-driven while the frame's own height is set
        // from it, so measuring the body cannot feed back into itself the way
        // measuring documentElement would.
        const measure = () => {
            const target = frameRef.current?.contentDocument?.body;
            if (!target) return;
            // Floored so that an email which hides its own content, or has none,
            // leaves a visible sliver rather than a card that looks broken.
            setHeight(Math.max(
                MIN_FRAME_HEIGHT,
                Math.min(target.scrollHeight, MAX_FRAME_HEIGHT)));
        };
        // Deferred a frame so the first measurement does not force a synchronous
        // layout inside the load handler, which the browser warns about and which
        // can read a height taken before the frame's styles have settled.
        requestAnimationFrame(measure);
        // Images finish arriving after the document does, and expanding the quote
        // reflows it, so the height has to keep tracking the content.
        observerRef.current?.disconnect();
        const observer = new ResizeObserver(measure);
        observer.observe(body);
        observerRef.current = observer;
    };

    if (failed) return <>{fallback}</>;

    return (
        <iframe
            ref={frameRef}
            title="Email message"
            srcDoc={srcDoc}
            onLoad={handleLoad}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="mf-email-frame"
            style={{ height }}
        />
    );
}
