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
| `ORG_NAME` | Organisation/project name — when set, shown in the UI as "Mistflame — {ORG_NAME}" and used as the display name in email From: headers; defaults to empty (shows "Mistflame" only) |
| `SEND_ADDRS` | Comma-separated list of available sender addresses |
| `SESSION_TTL_HOURS` | Session token lifetime in hours (default `24`) |
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
- Schema changes: `npx wrangler d1 execute mistflame-db --remote --file <file>` for SQL files, or `--command "ALTER TABLE ..."` for single statements (e.g. `ALTER TABLE email DROP COLUMN thread_id`). `--remote` for local deployments.

## Email data model
The `email` table uses two columns to encode email state — get these wrong and everything breaks:

| `sender` | `sent_at` | Meaning |
|---|---|---|
| `NULL` | timestamp | Inbound — received from the contact |
| address string | `NULL` | Outgoing draft — composed but not yet sent |
| address string | timestamp | Outgoing sent |

- There is no stored `thread_id` column. Thread grouping is computed at query time via a recursive CTE over `parent_id`: each email walks up to its root (`parent_id IS NULL`), and threads are numbered with `DENSE_RANK() OVER (ORDER BY root_id)`. The client still receives a `thread_id` field — it is computed, not stored.
- `awaiting_reply` on the contact is **computed** in the SQL query (not a stored column). It is true when any inbound email (`sender IS NULL`) for that contact has no child replies.
- The email receiver backfills `message_id` on a sent email when a reply arrives (using the inbound `In-Reply-To` header), so that subsequent replies thread correctly via `In-Reply-To` matching.

## Email worker
- The email receiver (`workers/email-receiver/index.ts`) is a **separate worker** with its own `wrangler.toml`. `npm run deploy` does not redeploy it.
- Deploy: `npx wrangler deploy --config workers/email-receiver/wrangler.toml`

## Shared constants
- `isValidEmail` is exported from `src/app/api/contacts/route.ts` for server-side use. It is also defined inline in `page.tsx` for client-side use — this duplication is intentional (different environments); do not consolidate.
- `SEND_ADDRS` is **not** a shared constant — it comes from `env.SEND_ADDRS` at runtime (server) or `/api/config` (client).

## Client fetch pattern
All `fetch` calls in `page.tsx` go through the `apiFetch` wrapper (defined inside `OutreachPage`), which redirects to `/login` on any 401 response. Two exceptions use raw `fetch` deliberately: the logout `DELETE /api/auth` (redirect is handled explicitly after it) and the `ContactForm` `/api/tags` fetch (non-critical autocomplete in a subcomponent without a router).
