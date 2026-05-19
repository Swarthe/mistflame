import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

const SESSION_COOKIE = '__session';
const SESSION_KEY = 'session';

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    const isPublic =
        pathname === '/login' ||
        pathname === '/api/auth' ||
        pathname === '/api/config';

    if (!isPublic) {
        const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
        let authenticated = false;

        if (sessionCookie) {
            try {
                const { env } = await getCloudflareContext({ async: true });
                if (env.DEV_MODE) {
                    authenticated = sessionCookie === 'dev-session-token';
                } else {
                    const stored = await env.SESSION.get(SESSION_KEY);
                    authenticated = stored !== null && stored === sessionCookie;
                }
            } catch {
                authenticated = false;
            }
        }

        if (!authenticated) {
            if (pathname.startsWith('/api/')) {
                return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
            }
            return NextResponse.redirect(new URL('/login', request.url));
        }
    }

    const response = NextResponse.next();
    if (!pathname.startsWith('/api/')) {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
