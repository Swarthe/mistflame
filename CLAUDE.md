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
- `cloudflare:email` is ESM-only; it must be imported via string-concatenation (`(await import('cloudflare' + ':email'))`) to prevent esbuild from trying to resolve it. `scripts/patch-opennext.mjs` rewrites the bundled runtime `require()` call post-build. Do not change how it is imported in `send-emails/route.ts` or `email-receiver/index.ts`.

## Configuration
All vars are set in `wrangler.toml` (non-secret) or via `wrangler secret put` (password). For local development, copy `.dev.vars.example` to `.dev.vars`.

**Main worker (`wrangler.toml`)**

| Var | Purpose |
|---|---|
| `ORG_NAME` | Organisation/project name; shown in the UI as "Mistflame - {ORG_NAME}" and used as the display name in email From: headers; defaults to empty |
| `SEND_ADDRS` | Comma-separated list of available sender addresses |
| `SESSION_TTL_HOURS` | KV TTL for the active-session marker and for the auth token when "Remember me" is unchecked (default `24`); does not control cookie Max-Age |
| `REMEMBER_TTL_DAYS` | KV TTL and cookie Max-Age for the auth token when "Remember me" is checked (default `30`) |
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
| `SESSION` | KV Namespace | main | Active session marker and auth tokens |
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
- CC addresses are stored as a comma-separated string. At send time, the raw email is delivered separately to each CC address rather than relying on the `Cc:` SMTP header alone (see "CC delivery" below).
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
- Unknown senders are auto-created as contacts (name from the parsed `From:` display name, email from the sender address) with `INSERT OR IGNORE`. If the insert race-conditions, the second `SELECT` fallback handles it.
- Inbound attachments are silently dropped if they exceed 10 MB or have no content (`!att.content`). Related/inline attachments (`att.related`) are skipped.
- Notification emails (one per `NOTIFY_ADDRS`) are sent with a 500-character body preview. Notification failures are caught and never affect inbound processing.
- The rate limiter uses a KV counter keyed by time-bucket (`rate:inbound:{bucket}`). It warns once per bucket via email when the limit is reached, then silently discards. The counter is not atomically exact (read-increment-write), but effective against sustained spam.

## Build patch (`scripts/patch-opennext.mjs`)
Applied automatically via the `postinstall` hook. Three changes to `@opennextjs/cloudflare`:
1. Adds `"cloudflare:email"` to the esbuild `external` array so esbuild does not try to resolve it.
2. Changes `const patchedCode` to `let patchedCode` in the bundle server script, so the next step can reassign it.
3. Rewrites `require("cloudflare:email")` in the bundled output to `__cfEmail` (a top-level `import * as __cfEmail from "cloudflare:email"`).

The script is idempotent — it checks for each change before applying. If any patch site is missing, it exits with code 1. Do not remove or restructure it without understanding the import chain.

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

## Authentication

### Login (`POST /api/auth`)
On successful password check, a `crypto.randomUUID()` token is generated. Two KV keys are written, both with the same TTL:

| KV key | Value | Purpose |
|---|---|---|
| `session` | the token | Tracks the current session; used for the overlap check and displacement |
| `remember:<token>` | `""` (empty) | Auth token; middleware looks this up on every request |

The `__remember` cookie (HttpOnly, SameSite=Strict) holds the token. When "Remember me" is unchecked, the cookie has no Max-Age (browser-session cookie) and both KV keys use `SESSION_TTL_HOURS`. When checked, the cookie gets a Max-Age and both KV keys use `REMEMBER_TTL_DAYS`.

### Middleware auth check
Middleware reads `__remember` from the request, looks up `remember:<cookieValue>` in KV. If found → authenticated. If not → redirect to `/login` (or 401 for API routes). Visiting `/login` with a valid cookie redirects straight to `/`. One KV read per request, no session-creation side effects.

### Session overlap check (409)
Before writing a new token, the server reads the existing `session` key. If a token is found, it verifies that `remember:<token>` still exists in KV. Only if both are present does it return 409 ("Another session is currently active"). A stale `session` marker whose auth token has expired is silently ignored — login proceeds without a prompt.

### Forced login (displacement)
When the user clicks "Log in anyway" (`force: true`), the old token is read from `session` and `remember:<oldToken>` is deleted from KV before the new token is written. The displaced user's cookie stops working on their next request.

### Logout (`DELETE /api/auth`)
Deletes both the `session` key and `remember:<token>` from KV, then clears the `__remember` cookie.

### Dev mode
When `DEV_MODE` is set, a hardcoded token (`dev-remember-token`) is used. KV is not read or written. The `Secure` flag is omitted from the cookie.

### Constants
The `REMEMBER_COOKIE` constant is defined identically in both `middleware.ts` and `auth/route.ts`. This duplication is intentional (same reason as `isValidEmail`): middleware and API routes are different execution contexts and should not share imports.

### Password comparison
`/api/auth` uses a manual XOR-reduce constant-time comparison (`a[i] ^ b[i]` accumulated into a single `diff`) to avoid leaking password length or content via timing. Do not replace with a plain `===` comparison.

## Client fetch pattern
All `fetch` calls in `page.tsx` go through the `apiFetch` wrapper (defined inside `OutreachPage`), which redirects to `/login` on any 401 response. Two exceptions use raw `fetch` deliberately: the logout `DELETE /api/auth` (redirect is handled explicitly after it) and the `ContactForm` `/api/tags` fetch (non-critical autocomplete in a subcomponent without a router).

## Client state (page.tsx)
- **Polling**: a 10-second `setInterval` polls `/api/contacts/{id}/emails`, `/api/contacts`, and `/api/send-emails` while the tab is visible. A `visibilitychange` listener pauses polling when the tab is hidden and fires an immediate poll when it becomes visible again. Do not remove this without an alternative refresh mechanism.
- **Contact persistence**: the selected contact ID is stored in `localStorage` under the key `mf_contact` and restored on mount. This survives page reloads and browser restarts.

## CC delivery
Outgoing CC addresses are stored as a comma-separated string in the `cc` column. At send time (`send-emails/route.ts`), the raw email is delivered separately to each CC address (one `EMAIL_SENDER.send()` call per address) rather than relying on the SMTP `Cc:` header for delivery. The `Cc:` header is still included in each copy for recipient visibility.

## Styling
- Tailwind CSS 4 with `shadcn/ui` and `tw-animate-css`.
- `next-themes` is configured with `forcedTheme="dark"` — the app is dark-only. Do not add a light theme toggle without removing `forcedTheme`.
- Two Google Fonts loaded via `next/font/google`: DM Sans (body, variable `--font-dm-sans`) and Libre Baskerville (headings, variable `--font-playfair`). A custom `font-heading-bold` utility class uses the Playfair variable.
- `robots.ts` serves `Disallow: /` for all user agents as a static route (complementing the `X-Robots-Tag` header set by middleware).
