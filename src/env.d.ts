/// <reference types="@cloudflare/workers-types/2023-07-01" />

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    SESSION: KVNamespace;
    EMAIL_SENDER: SendEmail;
    ATTACHMENTS: R2Bucket;
    ORG_NAME: string;
    SEND_ADDRS: string;
    PASSWORD: string;
    DEV_MODE?: string;
    SESSION_TTL_HOURS?: string;
    NOTIFY_ADDRS?: string;
  }

  var EmailMessage: {
    new (from: string, to: string, raw: ReadableStream | string): import('@cloudflare/workers-types/2023-07-01').EmailMessage;
  };
}
export {};
