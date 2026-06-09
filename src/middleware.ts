import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

const SESSION_COOKIE = '__session';
const REMEMBER_COOKIE = '__remember';
const SESSION_KEY = 'session';
const DEFAULT_REMEMBER_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

function setSecurityHeaders(response: NextResponse, pathname: string) {
    if (!pathname.startsWith('/api/')) {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
        response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    }
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'no-referrer');
}

async function authenticate(request: NextRequest): Promise<{ authenticated: boolean; devMode: boolean; newSessionToken?: string; rememberToken?: string; rememberTtl?: number }> {
    const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;

    if (sessionCookie) {
        try {
            const { env } = await getCloudflareContext({ async: true });
            const devMode = !!env.DEV_MODE;
            if (devMode) {
                return { authenticated: sessionCookie === 'dev-session-token', devMode };
            }
            const stored = await env.SESSION.get(SESSION_KEY);
            if (stored !== null && stored === sessionCookie) {
                return { authenticated: true, devMode };
            }
        } catch {
            // fall through to remember-me check
        }
    }

    const rememberCookie = request.cookies.get(REMEMBER_COOKIE)?.value;
    if (!rememberCookie) return { authenticated: false, devMode: false };

    try {
        const { env } = await getCloudflareContext({ async: true });
        const devMode = !!env.DEV_MODE;
        let rememberValid = false;
        if (devMode) {
            rememberValid = rememberCookie === 'dev-remember-token';
        } else {
            const stored = await env.SESSION.get(`remember:${rememberCookie}`);
            rememberValid = stored !== null;
        }

        if (rememberValid) {
            const ttlHours = Math.max(1, parseInt(env.SESSION_TTL_HOURS ?? '24', 10) || 24);
            const rememberTtlDays = Math.max(1, parseInt(env.REMEMBER_TTL_DAYS ?? '30', 10) || 30);
            const newToken = devMode ? 'dev-session-token' : crypto.randomUUID();
            if (!devMode) {
                await env.SESSION.put(SESSION_KEY, newToken, { expirationTtl: ttlHours * 60 * 60 });
            }
            return { authenticated: true, devMode, newSessionToken: newToken, rememberToken: rememberCookie, rememberTtl: rememberTtlDays * 24 * 60 * 60 };
        }
    } catch {
        // fall through
    }

    return { authenticated: false, devMode: false };
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    const isPublic =
        pathname === '/login' ||
        pathname === '/api/auth' ||
        pathname === '/api/config';

    const auth = await authenticate(request);

    if (auth.authenticated && pathname === '/login') {
        const response = NextResponse.redirect(new URL('/', request.url));
        if (auth.newSessionToken) {
            const secure = auth.devMode ? '' : '; Secure';
            response.headers.set('Set-Cookie', `${SESSION_COOKIE}=${auth.newSessionToken}${secure}; Path=/; HttpOnly; SameSite=Strict`);
            if (auth.rememberToken) {
                response.headers.append('Set-Cookie', `${REMEMBER_COOKIE}=${auth.rememberToken}${secure}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${auth.rememberTtl ?? DEFAULT_REMEMBER_TTL}`);
            }
        }
        setSecurityHeaders(response, pathname);
        return response;
    }

    if (!auth.authenticated && !isPublic) {
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/login', request.url));
    }

    const response = NextResponse.next();

    if (auth.newSessionToken) {
        const secure = auth.devMode ? '' : '; Secure';
        response.headers.set('Set-Cookie', `${SESSION_COOKIE}=${auth.newSessionToken}${secure}; Path=/; HttpOnly; SameSite=Strict`);
        if (auth.rememberToken) {
            response.headers.append('Set-Cookie', `${REMEMBER_COOKIE}=${auth.rememberToken}${secure}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${auth.rememberTtl ?? DEFAULT_REMEMBER_TTL}`);
        }
    }

    setSecurityHeaders(response, pathname);
    return response;
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
