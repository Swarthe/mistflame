import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

const REMEMBER_COOKIE = '__remember';

function setSecurityHeaders(response: NextResponse, pathname: string) {
    if (!pathname.startsWith('/api/')) {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
        response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    }
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'no-referrer');
}

async function isAuthenticated(request: NextRequest): Promise<boolean> {
    const rememberCookie = request.cookies.get(REMEMBER_COOKIE)?.value;
    if (!rememberCookie) return false;

    try {
        const { env } = await getCloudflareContext({ async: true });
        if (env.DEV_MODE) {
            return rememberCookie === 'dev-remember-token';
        }
        const stored = await env.SESSION.get(`remember:${rememberCookie}`);
        return stored !== null;
    } catch {
        return false;
    }
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    const isPublic =
        pathname === '/login' ||
        pathname === '/api/auth' ||
        pathname === '/api/config';

    if (isPublic) {
        if (pathname === '/login') {
            const authed = await isAuthenticated(request);
            if (authed) {
                const response = NextResponse.redirect(new URL('/', request.url));
                setSecurityHeaders(response, pathname);
                return response;
            }
        }
        const response = NextResponse.next();
        setSecurityHeaders(response, pathname);
        return response;
    }

    const authed = await isAuthenticated(request);
    if (!authed) {
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/login', request.url));
    }

    const response = NextResponse.next();
    setSecurityHeaders(response, pathname);
    return response;
}

export const config = {
    // robots.txt is excluded so crawlers can actually read it; behind the auth
    // wall it would redirect to /login and never be served.
    matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
