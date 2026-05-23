import { getCloudflareContext } from '@opennextjs/cloudflare';

const SESSION_COOKIE = '__session';
const SESSION_KEY = 'session';

export async function POST(request: Request) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const password = body?.password;
    const force = body?.force === true;

    if (typeof password !== 'string') {
        return Response.json({ ok: false, error: 'Password required.' }, { status: 400 });
    }

    const { env } = await getCloudflareContext({ async: true });

    const ttlHours = Math.max(1, parseInt(env.SESSION_TTL_HOURS ?? '24', 10) || 24);
    const COOKIE_MAX_AGE = ttlHours * 60 * 60;

    if (password !== (env.PASSWORD ?? '')) {
        return Response.json({ ok: false, error: 'Incorrect password.' }, { status: 401 });
    }

    if (!env.DEV_MODE && !force) {
        const existing = await env.SESSION.get(SESSION_KEY);
        if (existing) {
            return Response.json({ ok: false, activeSession: true }, { status: 409 });
        }
    }

    const token = env.DEV_MODE ? 'dev-session-token' : crypto.randomUUID();
    if (!env.DEV_MODE) {
        await env.SESSION.put(SESSION_KEY, token, { expirationTtl: COOKIE_MAX_AGE });
    }

    const cookieFlags = `Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Strict`;
    const secure = !env.DEV_MODE ? '; Secure' : '';

    const response = Response.json({ ok: true });
    response.headers.set('Set-Cookie', `${SESSION_COOKIE}=${token}${secure}; ${cookieFlags}`);
    return response;
}

export async function DELETE() {
    try {
        const { env } = await getCloudflareContext({ async: true });
        if (!env.DEV_MODE) {
            await env.SESSION.delete(SESSION_KEY);
        }
    } catch {
        // best-effort, still clear the cookie
    }
    const response = Response.json({ ok: true });
    response.headers.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
    return response;
}
