import { getCloudflareContext } from '@opennextjs/cloudflare';

// Defined identically in middleware.ts and auth/route.ts; the duplication
// across execution contexts is deliberate (see CLAUDE.md).
const REMEMBER_COOKIE = '__remember';

/**
 * The route is public so the login page can show the organisation name, but
 * the sender address list is only for the app itself: an unauthenticated
 * caller has no business enumerating the organisation's valid addresses.
 */
async function isAuthenticated(request: Request, env: CloudflareEnv): Promise<boolean> {
    const match = (request.headers.get('Cookie') ?? '')
        .match(new RegExp(`(?:^|;\\s*)${REMEMBER_COOKIE}=([^;]+)`));
    if (!match) return false;
    if (env.DEV_MODE) return match[1] === 'dev-remember-token';
    try {
        return (await env.SESSION.get(`remember:${match[1]}`)) !== null;
    } catch {
        return false;
    }
}

export async function GET(request: Request) {
    const { env } = await getCloudflareContext({ async: true });
    const authed = await isAuthenticated(request, env);
    return Response.json({
        orgName: env.ORG_NAME ?? '',
        sendAddrs: authed
            ? (env.SEND_ADDRS ?? '').split(',').map((a: string) => a.trim()).filter(Boolean)
            : [],
    });
}
