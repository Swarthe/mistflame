# Mistflame — Claude instructions

## Checks
- Typecheck: `npx tsc --noEmit`
- No test suite. Verify changes manually via `npm run preview`.

## Stack constraints
- Next.js 16 App Router, deployed on Cloudflare Workers via `@opennextjs/cloudflare`.
- Do **not** use `export const runtime = 'edge'` in any route — not supported by OpenNext.
- `middleware.ts` is the correct convention — the deprecation warning during build is expected and harmless.
- `cloudflare:email` is ESM-only; `scripts/patch-opennext.mjs` rewrites the runtime `require()` call post-build. Do not change how it is imported in `send-emails/route.ts`.

## Configuration
All branding and addresses are set via Cloudflare `[vars]` in `wrangler.toml` (non-secret) or `wrangler secret put` (password):

| Var | Purpose |
|---|---|
| `ORG_NAME` | Organisation/project name — shown in the UI title as "Mistflame - {ORG_NAME}" and used as the display name in email From: headers |
| `SEND_ADDRS` | Comma-separated list of available sender addresses |
| `PASSWORD` | Secret — login password |

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in values.

## Bindings
| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 Database | Contacts and email history |
| `SESSION` | KV Namespace | Active session token (1-day TTL) |
| `ATTACHMENTS` | R2 Bucket | Email attachments |
| `EMAIL_SENDER` | Send Email | Outbound email via Cloudflare Email Workers |

## Database
- D1 (SQLite). FK constraints declared in `schema.sql` but **not enforced at runtime** — cascading deletes are done manually in route handlers.
- Schema changes: `npx wrangler d1 execute mistflame-db --remote --file <file>`

## Email worker
- The email receiver (`workers/email-receiver/index.ts`) is a **separate worker** with its own `wrangler.toml`. `npm run deploy` does not redeploy it.
- Deploy: `npx wrangler deploy --config workers/email-receiver/wrangler.toml`

## Shared constants
- `isValidEmail` is defined and exported from `src/app/api/contacts/route.ts`. Import from there; do not redefine locally.
- `SEND_ADDRS` is **not** a shared constant — it comes from `env.SEND_ADDRS` at runtime (server) or `/api/config` (client).

## Conventions
- No comments unless the WHY is non-obvious.
- No trailing summaries in responses — the user reads the diff.
- Never commit without explicit instruction.
