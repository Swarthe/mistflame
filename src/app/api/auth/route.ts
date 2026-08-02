import { getCloudflareContext } from '@opennextjs/cloudflare';

const REMEMBER_COOKIE = '__remember';

export async function POST(request: Request) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const password = body?.password;
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

    // Each login gets its own token, so any number of sessions can be
    // active at once; logging in never affects anyone else's token.
    if (!env.DEV_MODE) {
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
            }
        }
    } catch {
        // best-effort, still clear the cookie
    }
    const response = Response.json({ ok: true });
    response.headers.set('Set-Cookie', `${REMEMBER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
    return response;
}
