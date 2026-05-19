import type { NextConfig } from 'next';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

initOpenNextCloudflareForDev().catch(() => {});

const nextConfig: NextConfig = {};

export default nextConfig;
