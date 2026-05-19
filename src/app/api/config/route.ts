import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function GET() {
    const { env } = await getCloudflareContext({ async: true });
    return Response.json({
        orgName: env.ORG_NAME ?? '',
        sendAddrs: (env.SEND_ADDRS ?? '').split(',').map((a: string) => a.trim()).filter(Boolean),
    });
}
