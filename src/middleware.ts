import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

const REMEMBER_COOKIE = '__remember';

// Agent tokens: a second way in, for API callers that are programs rather
// than people. A bearer token is looked up as `agent:<sha256 hex of token>`
// in the SESSION namespace, so a dump of KV yields no usable credential,
// and the stored value says who the token is for and what it may do.
// scripts/agent-token.mjs mints, lists and revokes them.
const AGENT_KEY_PREFIX = 'agent:';
const AGENT_SCOPES = ['read', 'read+draft', 'read+draft+send'] as const;
type AgentScope = (typeof AGENT_SCOPES)[number];
interface AgentGrant {
    principal: string;
    scope: AgentScope;
}

// Set on the forwarded request when a bearer token authenticated it, so a
// route can tell an agent from a person. Stripped from every incoming
// request first, so a browser cannot claim to be one.
const AGENT_HEADER = 'x-mistflame-agent';

// Everything a token may call, by method and path, and the least scope that
// allows it. A route absent from this table is refused to every token: that
// covers deletes, contact edits, the login route and the image proxy, none
// of which an agent has any business with.
const AGENT_ROUTES: { method: string; path: RegExp; scope: AgentScope }[] = [
    { method: 'GET', path: /^\/api\/(contacts|tags|search|revision|send-emails)$/, scope: 'read' },
    { method: 'GET', path: /^\/api\/contacts\/\d+\/emails$/, scope: 'read' },
    { method: 'GET', path: /^\/api\/contacts\/\d+\/emails\/\d+\/attachments\/\d+$/, scope: 'read' },
    { method: 'POST', path: /^\/api\/contacts\/\d+\/emails$/, scope: 'read+draft' },
    { method: 'POST', path: /^\/api\/contacts\/\d+\/emails\/forward$/, scope: 'read+draft' },
    { method: 'PATCH', path: /^\/api\/contacts\/\d+\/emails\/\d+$/, scope: 'read+draft' },
    { method: 'POST', path: /^\/api\/contacts\/\d+\/emails\/\d+\/attachments$/, scope: 'read+draft' },
    { method: 'POST', path: /^\/api\/send-emails$/, scope: 'read+draft+send' },
];

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

function bearerToken(request: NextRequest): string | null {
    const header = request.headers.get('Authorization') ?? '';
    const match = header.match(/^Bearer\s+(\S+)$/i);
    return match ? match[1] : null;
}

async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function isScope(value: unknown): value is AgentScope {
    return typeof value === 'string' && (AGENT_SCOPES as readonly string[]).includes(value);
}

/** The grant behind a bearer token, or null if the token is unknown, expired
 *  or malformed. A malformed stored value is an operator error and reads as
 *  "no such token" rather than as a grant of anything. */
async function agentGrant(token: string): Promise<AgentGrant | null> {
    try {
        const { env } = await getCloudflareContext({ async: true });
        if (env.DEV_MODE) {
            return token === 'dev-agent-token'
                ? { principal: 'dev', scope: 'read+draft+send' }
                : null;
        }
        const stored = await env.SESSION.get(`${AGENT_KEY_PREFIX}${await sha256Hex(token)}`);
        if (stored === null) return null;
        const parsed = JSON.parse(stored) as Record<string, unknown>;
        if (typeof parsed.principal !== 'string' || !parsed.principal || !isScope(parsed.scope)) {
            return null;
        }
        return { principal: parsed.principal, scope: parsed.scope };
    } catch {
        return null;
    }
}

function agentMayCall(grant: AgentGrant, method: string, pathname: string): boolean {
    const held = AGENT_SCOPES.indexOf(grant.scope);
    return AGENT_ROUTES.some(route =>
        route.method === method &&
        route.path.test(pathname) &&
        AGENT_SCOPES.indexOf(route.scope) <= held
    );
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

    // A presented token is the identity claimed: it is checked on its own,
    // and a cookie alongside it is ignored. Tokens exist for the API only;
    // on a page route one is simply not a login.
    const token = pathname.startsWith('/api/') ? bearerToken(request) : null;
    if (token !== null) {
        const grant = await agentGrant(token);
        if (grant === null) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        }
        if (!agentMayCall(grant, request.method, pathname)) {
            return NextResponse.json({
                ok: false,
                error: `Forbidden: scope ${grant.scope} does not allow ${request.method} ${pathname}`,
            }, { status: 403 });
        }
        const headers = new Headers(request.headers);
        headers.set(AGENT_HEADER, grant.principal);
        const response = NextResponse.next({ request: { headers } });
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

    // A person's request never carries the agent header, whatever the
    // client sent.
    const headers = new Headers(request.headers);
    headers.delete(AGENT_HEADER);
    const response = NextResponse.next({ request: { headers } });
    setSecurityHeaders(response, pathname);
    return response;
}

export const config = {
    // robots.txt is excluded so crawlers can actually read it; behind the auth
    // wall it would redirect to /login and never be served.
    matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
