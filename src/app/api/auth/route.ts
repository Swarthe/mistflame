import { getCloudflareContext } from '@opennextjs/cloudflare';

const REMEMBER_COOKIE = '__remember';
const SESSION_KEY = 'session';

export async function POST(request: Request) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const password = body?.password;
    const force = body?.force === true;
    const remember = body?.remember === true;

    if (typeof password !== 'string') {
        return Response.json({ ok: false, error: 'Password required.' }, { status: 400 });
    }

    const { env } = await getCloudflareContext({ async: true });

    const sessionTtlHours = Math.max(1, parseInt(env.SESSION_TTL_HOURS ?? '24', 10) || 24);
    const sessionKvTtl = sessionTtlHours * 60 * 60;

    const encoder = new TextEncoder();
    const a = encoder.encode(password);
    const b = encoder.encode(env.PASSWORD ?? '');
    let diff = a.length ^ b.length;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) diff |= a[i] ^ b[i];
    if (diff !== 0) {
        return Response.json({ ok: false, error: 'Incorrect password.' }, { status: 401 });
    }

    const token = env.DEV_MODE ? 'dev-remember-token' : crypto.randomUUID();

    let cookieMaxAge = '';
    let kvTtl = sessionKvTtl;
    if (remember) {
        const rememberTtlDays = Math.max(1, parseInt(env.REMEMBER_TTL_DAYS ?? '30', 10) || 30);
        kvTtl = rememberTtlDays * 24 * 60 * 60;
        cookieMaxAge = `; Max-Age=${kvTtl}`;
    }

    if (!env.DEV_MODE) {
        if (!force) {
            const existingToken = await env.SESSION.get(SESSION_KEY);
            if (existingToken) {
                const stillValid = await env.SESSION.get(`remember:${existingToken}`);
                if (stillValid !== null) {
                    return Response.json({ ok: false, activeSession: true }, { status: 409 });
                }
            }
        } else {
            const oldToken = await env.SESSION.get(SESSION_KEY);
            if (oldToken) {
                await env.SESSION.delete(`remember:${oldToken}`);
            }
        }

        await env.SESSION.put(SESSION_KEY, token, { expirationTtl: kvTtl });
        await env.SESSION.put(`remember:${token}`, '', { expirationTtl: kvTtl });
    }

    const secure = !env.DEV_MODE ? '; Secure' : '';
    const response = Response.json({ ok: true });
    response.headers.set('Set-Cookie', `${REMEMBER_COOKIE}=${token}${secure}; Path=/; HttpOnly; SameSite=Strict${cookieMaxAge}`);
    return response;
}

export async function DELETE(request: Request) {
    try {
        const { env } = await getCloudflareContext({ async: true });
        if (!env.DEV_MODE) {
            const cookieHeader = request.headers.get('Cookie') ?? '';
            const rememberMatch = cookieHeader.match(new RegExp(`${REMEMBER_COOKIE}=([^;]+)`));
            if (rememberMatch) {
                await env.SESSION.delete(`remember:${rememberMatch[1]}`);
                // The active-session marker is only cleared when it is ours: a
                // displaced session logging out must not erase the marker of
                // the session that displaced it, which would silently disable
                // the overlap warning for the next login.
                const current = await env.SESSION.get(SESSION_KEY);
                if (current === rememberMatch[1]) {
                    await env.SESSION.delete(SESSION_KEY);
                }
            }
        }
    } catch {
        // best-effort, still clear the cookie
    }
    const response = Response.json({ ok: true });
    response.headers.set('Set-Cookie', `${REMEMBER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
    return response;
}
