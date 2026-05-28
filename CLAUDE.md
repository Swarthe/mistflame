# Mistflame - Claude instructions

## Conventions
- **British English** in all documentation (README.md, CLAUDE.md): -ise not -ize, -our not -or, etc.
- **No em-dashes** (-- or Unicode --) in documentation or code comments; use a comma, colon, or semicolon instead.
- **Four-space indentation** in all TypeScript source files.
- Claude maintains `.gitignore` -- update it when adding dependencies or build tools that produce new output paths.
- Claude maintains `README.md` and `CLAUDE.md` -- auto-update CLAUDE.md whenever architecture or features change; for README.md, proactively identify and suggest changes, then apply when the user confirms.

## Checks
- Typecheck: `npx tsc --noEmit`
- No test suite. Verify changes manually via `npm run preview`.
- `wrangler.toml` and `email-receiver/wrangler.toml` are gitignored. Copy from the `.example` files before running preview:
  ```
  cp wrangler.toml.example wrangler.toml
  cp email-receiver/wrangler.toml.example email-receiver/wrangler.toml
  ```

## Stack constraints
- Next.js 16 App Router, deployed on Cloudflare Workers via `@opennextjs/cloudflare`.
- Do **not** use `export const runtime = 'edge'` in any route; not supported by OpenNext.
- `middleware.ts` is the correct convention; the deprecation warning during build is expected and harmless.
- `cloudflare:email` is ESM-only; `scripts/patch-opennext.mjs` rewrites the runtime `require()` call post-build. Do not change how it is imported in `send-emails/route.ts`.

## Configuration
All vars are set in `wrangler.toml` (non-secret) or via `wrangler secret put` (password). For local development, copy `.dev.vars.example` to `.dev.vars`.

**Main worker (`wrangler.toml`)**

| Var | Purpose |
|---|---|
| `ORG_NAME` | Organisation/project name; shown in the UI as "Mistflame - {ORG_NAME}" and used as the display name in email From: headers; defaults to empty |
| `SEND_ADDRS` | Comma-separated list of available sender addresses |
| `SESSION_TTL_HOURS` | KV expiry for the server-side session token (default `24`); the browser cookie has no max-age, so the session always ends when the browser closes |
| `PASSWORD` | Login password (secret) |

**Email receiver worker (`email-receiver/wrangler.toml`)**

| Var | Purpose |
|---|---|
| `NOTIFY_ADDRS` | Comma-separated addresses to notify on inbound email (empty = disabled) |
| `RATE_LIMIT_MAX` | Soft limit on inbound emails per window (`0` = disabled); requires `KV` binding. Enforced via a KV counter (read-increment-write); not atomically exact, but effective against sustained spam |
| `RATE_LIMIT_WINDOW_MINUTES` | Window length in minutes for the rate limit (default `60`) |

## Bindings
| Binding | Type | Worker | Purpose |
|---|---|---|---|
| `DB` | D1 Database | both | Contacts and email history |
| `SESSION` | KV Namespace | main | Active session token |
| `ATTACHMENTS` | R2 Bucket | both | Email attachments |
| `EMAIL_SENDER` | Send Email | both | Outbound email via Cloudflare Email Workers |
| `KV` | KV Namespace | email-receiver | Rate limit counters (can share the `SESSION` namespace) |
| `PASSWORD` | Secret | main | Login password |

## Database
- D1 (SQLite). FK constraints declared in `db/schema.sql` but **not enforced at runtime**; cascading deletes are done manually in route handlers.
- Schema changes (remote): `npx wrangler d1 execute mistflame-db --remote --file <file>` for SQL files, or `--command "ALTER TABLE ..."` for single statements.
- **Local D1 commands** (use the binding name `DB`, not the database name; all commands run from the mistflame directory):
  ```
  # Apply schema to local dev database
  npx wrangler d1 execute DB --local --file db/schema.sql

  # Run an arbitrary query
  npx wrangler d1 execute DB --local --command "SELECT * FROM contact"

  # Seed with example contacts and email threads for local testing
  npx wrangler d1 execute DB --local --file db/seed-local.sql

  # Reset all data
  npx wrangler d1 execute DB --local --command "DELETE FROM email; DELETE FROM contact; DELETE FROM tag; DELETE FROM contact_tag; DELETE FROM sqlite_sequence WHERE name IN ('email','contact','tag');"
  ```
- Local state is stored in `.wrangler/state/v3/d1/` (gitignored). Delete this directory to fully reset the local database.

## Tags
- Tags are case-insensitively normalised on both sides:
  - **Client** (`ContactForm` in `page.tsx`): `addTag` resolves `matchedTag` via `allTags.find(t => t.name.toLowerCase() === input.toLowerCase())` and uses `matchedTag.name` (the stored casing) rather than the typed string.
  - **Server** (`upsertTags` in `contacts/route.ts`): does a `SELECT ... WHERE LOWER(name) = LOWER(?)` lookup before inserting, so the existing row is always reused if a case variant is present.
- The tag `name` UNIQUE constraint in SQLite is case-sensitive by default; the application layer is responsible for deduplication.

## Email composition
- Manually added emails and replies are always outgoing (mistflame sender). There is no option to add a contact-type (inbound) email manually.
- The `+ Reply` button is only shown on inbound emails (`sender IS NULL`). Replies are always sent as mistflame.
- When replying, the sender address is locked to the address that originally received the inbound email.
- Reply drafts are composed without quoted text in the body. At send time, `send-emails/route.ts` appends the quoted parent body to both the outgoing email and the stored DB body. The thread view collapses quoted sections behind a `···` toggle button (`splitQuote` in `page.tsx` detects the `\n\nOn ... wrote:` boundary); inbound emails from contacts are handled the same way if their client includes quoted text.
- The POST and PATCH endpoints for emails reject `sender: null`; null senders are only written by the email receiver worker directly via D1, not via the API.

## Email data model
The `email` table uses two columns to encode email state; get these wrong and everything breaks:

| `sender` | `sent_at` | Meaning |
|---|---|---|
| `NULL` | timestamp | Inbound email from the contact |
| address string | `NULL` | Outgoing draft, not yet sent |
| address string | timestamp | Outgoing sent |

- There is no stored `thread_id` column. Thread grouping is computed at query time via a recursive CTE over `parent_id`: each email walks up to its root (`parent_id IS NULL`), and threads are numbered with `DENSE_RANK() OVER (ORDER BY root_id)`. The client still receives a `thread_id` field; it is computed, not stored.
- `awaiting_reply` on the contact is **computed** in the SQL query (not a stored column). It is true when any inbound email (`sender IS NULL`) for that contact has no child replies.
- Outbound emails have their `message_id` generated and stored in the DB at send time (`send-emails/route.ts`), so inbound `In-Reply-To` lookups match directly. A subject-line fallback handles contacts replying without a matching `In-Reply-To`.
- `In-Reply-To` parsing extracts the first `<...>` block via regex rather than stripping outer angle brackets, to handle headers that contain multiple message IDs.
- The subject fallback matches against both the bare normalised subject and `'Re: ' || normalised`, because outbound reply subjects are stored with the "Re: " prefix applied by the UI.

## Email worker
- The email receiver (`email-receiver/index.ts`) is a **separate worker** with its own `wrangler.toml`. `npm run deploy` does not redeploy it.
- Deploy: `npx wrangler deploy --config email-receiver/wrangler.toml`

## Shared constants
- `isValidEmail` is exported from `src/app/api/contacts/route.ts` for server-side use. It is also defined inline in `page.tsx` for client-side use; this duplication is intentional (different environments); do not consolidate.
- `SEND_ADDRS` is **not** a shared constant; it comes from `env.SEND_ADDRS` at runtime (server) or `/api/config` (client).
- `ORG_NAME` follows the same pattern: `env.ORG_NAME` on the server; `/api/config` (as `orgName`) on the client. The `orgName` local variable in `OutreachPage` and the `orgName` prop passed to `EmailCard`/`NewEmailCard` fall back to `'Mistflame'` when the env var is empty.

## Security headers
`middleware.ts` sets the following headers on every response:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`

On HTML page responses (non-`/api/` routes) it additionally sets:
- `X-Robots-Tag: noindex, nofollow`
- `Content-Security-Policy`: `default-src 'self'` with `'unsafe-inline'` for scripts and styles (required for Next.js App Router hydration) and `frame-ancestors 'none'`

Do not tighten `script-src` to remove `'unsafe-inline'` without first implementing nonce-based CSP; Next.js injects inline scripts for hydration.

## Input limits
- Email body: 100,000 characters (enforced in POST and PATCH handlers)
- Email subject: 500 characters (enforced in POST and PATCH handlers)
- Inbound attachments: 10 MB per file; oversized attachments are silently dropped in the email receiver before the R2 write

## Password comparison
`/api/auth` uses a manual XOR-reduce constant-time comparison (`a[i] ^ b[i]` accumulated into a single `diff`) to avoid leaking password length or content via timing. Do not replace with a plain `===` comparison.

## Client fetch pattern
All `fetch` calls in `page.tsx` go through the `apiFetch` wrapper (defined inside `OutreachPage`), which redirects to `/login` on any 401 response. Two exceptions use raw `fetch` deliberately: the logout `DELETE /api/auth` (redirect is handled explicitly after it) and the `ContactForm` `/api/tags` fetch (non-critical autocomplete in a subcomponent without a router).
