import { getCloudflareContext } from '@opennextjs/cloudflare';

const SESSION_COOKIE = '__session';
const REMEMBER_COOKIE = '__remember';
const SESSION_KEY = 'session';
const DEFAULT_REMEMBER_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

export async function POST(request: Request) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const password = body?.password;
    const force = body?.force === true;

    if (typeof password !== 'string') {
        return Response.json({ ok: false, error: 'Password required.' }, { status: 400 });
    }

    const { env } = await getCloudflareContext({ async: true });

    const ttlHours = Math.max(1, parseInt(env.SESSION_TTL_HOURS ?? '24', 10) || 24);
    const kvTtl = ttlHours * 60 * 60;

    const encoder = new TextEncoder();
    const a = encoder.encode(password);
    const b = encoder.encode(env.PASSWORD ?? '');
    let diff = a.length ^ b.length;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) diff |= a[i] ^ b[i];
    if (diff !== 0) {
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
        await env.SESSION.put(SESSION_KEY, token, { expirationTtl: kvTtl });
    }

    const remember = body?.remember === true;

    const rememberTtlDays = Math.max(1, parseInt(env.REMEMBER_TTL_DAYS ?? '30', 10) || 30);
    const rememberTtl = rememberTtlDays * 24 * 60 * 60;

    let rememberToken: string | null = null;
    if (remember) {
        rememberToken = env.DEV_MODE ? 'dev-remember-token' : crypto.randomUUID();
        if (!env.DEV_MODE) {
            await env.SESSION.put(`remember:${rememberToken}`, '', { expirationTtl: rememberTtl });
        }
    }

    const cookieFlags = `Path=/; HttpOnly; SameSite=Strict`;
    const secure = !env.DEV_MODE ? '; Secure' : '';

    const response = Response.json({ ok: true });
    response.headers.set('Set-Cookie', `${SESSION_COOKIE}=${token}${secure}; ${cookieFlags}`);
    if (rememberToken) {
        response.headers.append('Set-Cookie', `${REMEMBER_COOKIE}=${rememberToken}${secure}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${rememberTtl}`);
    }
    return response;
}

export async function DELETE(request: Request) {
    try {
        const { env } = await getCloudflareContext({ async: true });
        if (!env.DEV_MODE) {
            await env.SESSION.delete(SESSION_KEY);
            const cookieHeader = request.headers.get('Cookie') ?? '';
            const rememberMatch = cookieHeader.match(new RegExp(`${REMEMBER_COOKIE}=([^;]+)`));
            if (rememberMatch) {
                await env.SESSION.delete(`remember:${rememberMatch[1]}`);
            }
        }
    } catch {
        // best-effort, still clear the cookies
    }
    const response = Response.json({ ok: true });
    response.headers.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
    response.headers.append('Set-Cookie', `${REMEMBER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
    return response;
}
