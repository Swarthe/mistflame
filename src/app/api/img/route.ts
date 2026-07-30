// Proxy for remote images in HTML email bodies.
//
// Rewriting <img src> to this route keeps remote images inside the existing
// img-src 'self' CSP, and means the sender sees a Cloudflare address rather than
// the reader's. It only runs when the reader clicks "Load images"; the sanitiser
// blocks remote images by default (see src/lib/email-html.ts).
//
// Middleware authenticates every non-public route, so this is not an open proxy.
//
// Nothing is stored durably. Deduplication is left to Cloudflare's edge cache via
// the cf options on the upstream fetch, so deleting an email leaves no trace of
// its images behind, and there is no bucket to grow or lifecycle rule to
// configure. The trade-off is that an evicted image is fetched again, which pings
// the sender's server a second time.

const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_SECONDS = 86_400;

/** Image subtypes are echoed into a response header, so keep the charset tight. */
const IMAGE_TYPE = /^image\/[a-z0-9][a-z0-9.+-]*$/;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function fail(status: number, error: string) {
    return Response.json({ ok: false, error }, { status });
}

/**
 * Workers egress reaches the public internet only, so it cannot hit RFC1918 or
 * loopback in the first place. These checks reject the obvious attempts anyway,
 * so a malformed or hostile URL fails before any fetch is made.
 */
function rejectReason(url: URL): string | null {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return 'Only http and https URLs are supported.';
    }
    if (url.port !== '' && url.port !== '80' && url.port !== '443') {
        return 'Unsupported port.';
    }
    const host = url.hostname.toLowerCase();
    if (!host) return 'Missing host.';
    // URL.hostname strips the brackets from an IPv6 literal, leaving the colons.
    if (host.includes(':') || IPV4.test(host)) {
        return 'IP addresses are not supported.';
    }
    if (host === 'localhost' || !host.includes('.')) return 'Unsupported host.';
    if (/\.(local|localhost|internal|home|lan)$/.test(host)) {
        return 'Unsupported host.';
    }
    return null;
}

export async function GET(request: Request) {
    const source = new URL(request.url).searchParams.get('u');
    if (!source) return fail(400, 'Missing u parameter.');
    if (source.length > 2048) return fail(400, 'URL too long.');

    let target: URL;
    try {
        target = new URL(source);
    } catch {
        return fail(400, 'Malformed URL.');
    }

    const reason = rejectReason(target);
    if (reason) return fail(400, reason);

    let upstream: Response;
    try {
        upstream = await fetch(target.toString(), {
            redirect: 'follow',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { Accept: 'image/*' },
            // cacheTtl overrides the origin's own cache headers, which matters
            // because the servers hosting marketing images routinely send
            // no-store and would otherwise be refetched on every view.
            cf: { cacheEverything: true, cacheTtl: CACHE_TTL_SECONDS },
        });
    } catch {
        return fail(502, 'Could not fetch the image.');
    }

    if (!upstream.ok) return fail(502, `Upstream returned ${upstream.status}.`);

    const contentType = (upstream.headers.get('content-type') ?? '')
        .split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPE.test(contentType)) {
        return fail(415, 'Upstream did not return an image.');
    }

    const declared = parseInt(upstream.headers.get('content-length') ?? '', 10);
    if (declared > MAX_BYTES) return fail(413, 'Image too large.');

    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) return fail(413, 'Image too large.');

    // Rebuilt from scratch rather than passing the upstream response through, so
    // no upstream header reaches the browser. `private` keeps shared caches out
    // of it while still letting the reader's own browser reuse it across views.
    return new Response(bytes, {
        headers: {
            'Content-Type': contentType,
            'Content-Length': String(bytes.byteLength),
            'Content-Disposition': 'inline',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cache-Control': `private, max-age=${CACHE_TTL_SECONDS}`,
            'Referrer-Policy': 'no-referrer',
        },
    });
}
