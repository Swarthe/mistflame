# Mistflame - Claude instructions

## Conventions
- **British English** in all documentation (README.md, CLAUDE.md): -ise not -ize, -our not -or, etc.
- **No em-dashes** (-- or Unicode --) in documentation or code comments; use a comma, colon, or semicolon instead.
- **Four-space indentation** in all TypeScript source files.
- Claude maintains `.gitignore` -- update it when adding dependencies or build tools that produce new output paths.
- Claude maintains `README.md` and `CLAUDE.md` -- auto-update CLAUDE.md whenever architecture or features change; for README.md, proactively identify and suggest changes, then apply when the user confirms.

## Checks
- Typecheck: `npx tsc --noEmit`
- Lint: `npx eslint src`. `page.tsx` has two pre-existing `react-hooks/set-state-in-effect` errors (the mount and contact-selection effects); do not treat a clean run as the baseline. Run it against `src`: a bare `npx eslint` also walks `.next/` and `.open-next/` and reports thousands of problems from build output.
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
| `SESSION_TTL_HOURS` | KV TTL for the auth token when "Remember me" is unchecked (default `24`); does not control cookie Max-Age |
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
| `SESSION` | KV Namespace | main | Auth tokens (one `remember:<token>` key per active session) |
| `ATTACHMENTS` | R2 Bucket | both | Email attachments, including inline (`cid:`) parts of HTML bodies |
| `EMAIL_SENDER` | Send Email | both | Outbound email via Cloudflare Email Workers |
| `KV` | KV Namespace | email-receiver | Rate limit counters (can share the `SESSION` namespace) |
| `PASSWORD` | Secret | main | Login password |

## Database
- D1 (SQLite). FK constraints declared in `db/schema.sql` but **not enforced at runtime**; cascading deletes are done manually in route handlers.
- Schema changes (remote): `npx wrangler d1 execute mistflame-db --remote --file <file>` for SQL files, or `--command "ALTER TABLE ..."` for single statements.
- `db/migrations/` holds numbered migrations for existing deployments; `db/schema.sql` always describes the current shape for fresh installs. Both must be updated together. SQLite has no `ADD COLUMN IF NOT EXISTS`, so rerunning `001-html-email.sql` or `005-reply-headers.sql` errors rather than doing nothing; check with `PRAGMA table_info(<table>)` first. `002-indexes.sql`, `003-revision.sql` and `004-email-fts.sql` use `IF NOT EXISTS`/`INSERT OR IGNORE` throughout and are safe to rerun.
- **Indexes** (`002-indexes.sql`) exist for the paths the client polls and the receiver runs per inbound message; there were none before. Four are partial or expression indexes and are load-bearing rather than incidental: `idx_email_inbound` (`WHERE sender IS NULL`) serves the `awaiting_reply` subquery, `idx_email_draft` (`WHERE sent_at IS NULL AND sender IS NOT NULL`) the pending-send count and the send query, and `idx_contact_email_lower`/`idx_tag_name_lower` exist because the `LOWER(email)` and `LOWER(name)` lookups cannot use the UNIQUE indexes. Check a query with `EXPLAIN QUERY PLAN` before assuming an index applies.
- **`meta` table and revision triggers** (`003-revision.sql`): `meta` holds one row, `('revision', n)`, bumped by an `AFTER INSERT/UPDATE/DELETE` trigger on every user-visible table. See "Polling" under Client state. Triggers rather than bumps in the route handlers, because the receiver worker writes to D1 directly and never goes through the API, and a write path added later would otherwise be invisible to the client. Nothing writes to `meta` except those triggers, so there is no recursion. A new table whose contents the UI shows needs its own trigger pair.
- `contact.email` UNIQUE is case-sensitive, like `tag.name`. The contact POST and PUT handlers reject a case variant of an existing address (409) via a `LOWER(email)` pre-check, so the receiver's case-insensitive lookup can never find two candidate rows. Receiver-created contacts store the address lowercased.
- The cascading deletes in `contacts/[id]/route.ts` and `emails/[emailId]/route.ts` run as a single `env.DB.batch()` (one transaction), so a failure midway rolls back rather than leaving orphaned rows; the R2 object deletes around them stay best-effort.
- **Local D1 commands** (use the binding name `DB`, not the database name; all commands run from the mistflame directory):
  ```
  # Apply schema to local dev database
  npx wrangler d1 execute DB --local --file db/schema.sql

  # Run an arbitrary query
  npx wrangler d1 execute DB --local --command "SELECT * FROM contact"

  # Seed with example contacts and email threads for local testing
  npx wrangler d1 execute DB --local --file db/seed-local.sql

  # Reset all data (attachment first: the seed inserts attachment rows with
  # explicit ids, so leaving them behind makes re-seeding fail on the PK)
  npx wrangler d1 execute DB --local --command "DELETE FROM attachment; DELETE FROM email; DELETE FROM contact; DELETE FROM tag; DELETE FROM contact_tag; DELETE FROM sqlite_sequence WHERE name IN ('email','contact','tag','attachment');"
  ```
- The seed's `cid:` image needs bytes in local R2 or it will not render (the
  attachment row exists, but the object does not). See the comment above
  thread 4 in `db/seed-local.sql` for the `wrangler r2 object put` command.
- Local state is stored in `.wrangler/state/v3/d1/` (gitignored). Delete this directory to fully reset the local database.
- **Backups now need a drop first**: `wrangler d1 export` refuses a database containing a virtual table, and `email_fts` is one. See Search.

## Search
`GET /api/search?q=` runs FTS5 over email subjects and bodies. The sidebar box searches both halves at once: contacts are filtered client-side from data already in hand (`fuzzyMatch`, unchanged), messages come from the server.

- **`email_fts` is an external-content table** (`content='email'`, `content_rowid='id'`), so it stores no text of its own and is rebuilt from `email` with `INSERT INTO email_fts(email_fts) VALUES('rebuild')`. Three triggers keep it in step. An external-content index that misses a write does not error, it returns wrong rows, so the `'delete'` command must be passed `old.*` exactly as indexed; that is why the update trigger deletes before it reinserts. Verify with `INSERT INTO email_fts(email_fts) VALUES('integrity-check')`.
- **`wrangler d1 export` refuses a database containing a virtual table.** To back up: `DROP TABLE email_fts`, export, then reapply `004-email-fts.sql`. Nothing is lost, since the index is derived. This is the one real cost of FTS5 here and it is why the drop/recreate is documented in the migration itself.
- **Raw input is never passed to `MATCH`.** `AND`, `*`, `^`, `:`, `-` and an unpaired `"` are all operators, so `re: hello` would be a syntax error. `toMatchExpression` quotes every term, which makes it a literal phrase while still letting the tokeniser split inside it, so `sam@example.com` matches as sam + example + com. The last term gets `*` for prefix matching as the user types. Terms with no letter or digit are dropped, because a phrase that tokenises to nothing is rejected by FTS5.
- **Snippets are marked with `U+0002`/`U+0003`**, not HTML. `HIT_OPEN`/`HIT_CLOSE` are defined in both `api/search/route.ts` and `src/components/SnippetText.tsx` (same rationale as `isValidEmail`). `SnippetText` splits on them and renders each run as text, so an email body cannot inject markup into the sidebar.
- Ranking is `bm25(email_fts, 2.0, 1.0)`, subject weighted double. `MAX_RESULTS` is 50; the query asks for 51 so `truncated` can distinguish "exactly 50" from "more".
- A missing index returns **503 with `unavailable: true`** rather than a 500, and the sidebar says which migration to apply. Same reasoning as `/api/revision` returning null: the index ships as a migration separate from the code that queries it, so a deployment can legitimately be without it.
- Clicking a result selects the contact and scrolls to `#email-{id}`, outlining it for `HIGHLIGHT_MS`. When the contact is not the current one, `pendingScrollId` holds the target until that contact's emails arrive.

## Tags
- Tags are case-insensitively normalised on both sides:
  - **Client** (`src/components/ContactForm.tsx`): `addTag` resolves `matchedTag` via `allTags.find(t => t.name.toLowerCase() === input.toLowerCase())` and uses `matchedTag.name` (the stored casing) rather than the typed string.
  - **Server** (`upsertTags` in `contacts/route.ts`): does a `SELECT ... WHERE LOWER(name) = LOWER(?)` lookup before inserting, so the existing row is always reused if a case variant is present.
- The tag `name` UNIQUE constraint in SQLite is case-sensitive by default; the application layer is responsible for deduplication.

## Email composition
- Manually added emails and replies are always outgoing (mistflame sender). There is no option to add a contact-type (inbound) email manually.
- The `+ Reply` button is only shown on inbound emails (`sender IS NULL`). Replies are always sent as mistflame.
- When replying, the sender address is locked to the address that originally received the inbound email.
- Reply drafts are composed without quoted text in the body. At send time, `send-emails/route.ts` appends the quoted parent body to both the outgoing email and the stored DB body. The thread view collapses quoted sections behind a `···` toggle button (`splitQuote` in `src/lib/format.ts` detects the `\n\nOn ... wrote:` boundary); inbound emails from contacts are handled the same way if their client includes quoted text.
- CC addresses are stored as a comma-separated string. At send time, the raw email is delivered separately to each CC address rather than relying on the `Cc:` SMTP header alone (see "CC delivery" below).
- The POST and PATCH endpoints for emails reject `sender: null`; null senders are only written by the email receiver worker directly via D1, not via the API.
- **Replying to an HTML email preserves the HTML quote chain.** The composed reply is always plain text (the composer is a textarea), but when the parent has a `body_html`, `send-emails/route.ts` also builds an HTML rendition: our words escaped with `<br>` line breaks, the attribution line, then the parent's own markup nested in a `<blockquote>`. The message goes out as `multipart/alternative`, nested inside `multipart/mixed` when there are attachments. A thread that started as plain text stays plain text throughout.
- The HTML part is base64-encoded so non-ASCII survives regardless of the receiving server's 8BITMIME support; the text part stays readable in the raw message and declares `Content-Transfer-Encoding: 8bit`. Headers that may carry non-ASCII (Subject and the From/To display names) are RFC 2047-encoded by `encodeHeaderText` in `src/lib/mime.ts`; the receiver uses the same function for notification subjects.
- Every outgoing message, including the receiver's notification and rate-warning emails, carries a `Date:` header from `rfc2822Date` in `src/lib/mime.ts`. RFC 5322 requires one; without it receiving MTAs stamp arrival time and SpamAssassin scores `MISSING_DATE`.
- A reply's `References` header is the parent's stored chain (`references_hdr`) plus the parent's own Message-ID, deduplicated and capped at the 10 most recent ids, folded one id per continuation line so no header line approaches the 998-character limit. The parent's message ID is stripped of `<>` and whitespace before being emitted, since it came off the wire.
- Replies are delivered to the parent's `reply_to` when the contact's client set one that differs from From (shared mailboxes, "on behalf of" senders); otherwise to the contact address. The address was validated at ingest and is re-checked with `isValidEmail` at send time, so a row written by any other means cannot smuggle header syntax into `To:`.
- An attachment row whose R2 object is missing **fails the send** (the claim is released and the error reported) rather than letting the message go out looking complete without it.
- **The generated HTML is sent but deliberately not stored.** Nothing needs it: our own messages display as plain text (see "HTML email rendering"), and a reply always parents an inbound email because the `+ Reply` button only appears on those, so the HTML a reply nests is always the contact's and never ours. Keeping it out of the row also keeps the post-send body rewrite small; if that `UPDATE` fails the row stays marked sent (the claim wrote `sent_at` before the send, see "CC delivery"), just without the quote appended to its stored body.
- `quotableHtml` strips three things from the parent fragment before nesting it. `<style>`, because a quoted `body { display: none }` would apply to our whole outgoing message and hide our own reply in the recipient's client. `<script>`, which cannot reach `body_html` through `htmlToFragment` but is removed so no other path could pass one on. And `cid:` images, whose Content-ID belongs to the message we received rather than the one we are sending, so every one left in would be a guaranteed broken image for the recipient; a full client re-attaches those parts as `multipart/related`, which is not worth the extra R2 reads and MIME nesting to show someone their own logo in their own quote.

## Email data model
The `email` table uses two columns to encode email state; get these wrong and everything breaks:

| `sender` | `sent_at` | Meaning |
|---|---|---|
| `NULL` | timestamp | Inbound email from the contact |
| address string | `NULL` | Outgoing draft, not yet sent |
| address string | timestamp | Outgoing sent |

**`body` and `body_html`.** `body` is the canonical plain-text rendition and is **always** populated; `body_html` is an optional HTML alternative, `NULL` when the email has none. Everything that consumes text reads `body`: `ReplyPreview` and the `···` toggle in the email cards, the receiver's subject-match fallback and notification previews, and the outgoing `text/plain` part. When an inbound email has no `text/plain` part, the receiver derives the text from the HTML with `htmlToText` rather than storing markup in `body`; that is what made old rows render as raw HTML before this split existed (see `scripts/backfill-html-bodies.mjs`).

`body_html` holds a **body fragment**, not a document: the receiver runs `htmlToFragment` to drop the doctype, `<html>`/`<head>` wrapper, comments and `<script>`, so both the renderer and the outbound-quote path get something nestable. `<style>` blocks are hoisted inline and kept in storage even though both consumers currently strip them, so a future CSS-scoping renderer will not need a second migration.

**`body_html` is written only by the email receiver**, so a non-null `body_html` implies an inbound row. The POST and PATCH email endpoints do not accept it, for the same reason they reject `sender: null`. The send path *reads* it, to nest the parent's markup in an outgoing reply's HTML part, but never writes it. Drafts are never HTML and PATCH only updates rows with `sent_at IS NULL`, so an edit cannot clobber a stored HTML body.

- Three further inbound-only columns (migration 005): `reply_to` (the Reply-To address, stored only when it differs from From; the send path delivers replies there), `references_hdr` (the References header ids, normalised to `<a> <b>` with the most recent last, capped at 10 ids / 2000 chars) and `from_addr` (the actual From address when the row was not written by the contact it is filed under; set for bounces, see "Email worker"). None is accepted by the POST/PATCH email endpoints.
- There is no stored `thread_id` column. Thread grouping is computed at query time via a recursive CTE over `parent_id`: each email walks up to its root (`parent_id IS NULL`), and threads are numbered with `DENSE_RANK() OVER (ORDER BY root_id)`. The client still receives a `thread_id` field; it is computed, not stored. The query orders by `sent_at` with `id` as tie-break, because a batch send stamps every row with the same timestamp.
- `awaiting_reply` on the contact is **computed** in the SQL query (not a stored column). It is true when any inbound email (`sender IS NULL`) for that contact has no child replies.
- Outbound emails have their `message_id` generated and stored in the DB at send time (`send-emails/route.ts`), so inbound `In-Reply-To` lookups match directly. Inbound threading tries three steps in order: `In-Reply-To` against stored `message_id`, then the `References` chain (the most recent id that matches a stored one wins), then the subject fallback.
- `In-Reply-To` parsing extracts the first `<...>` block via regex rather than stripping outer angle brackets, to handle headers that contain multiple message IDs.
- The subject fallback matches against both the bare normalised subject and `'Re: ' || normalised`, because outbound reply subjects are stored with the "Re: " prefix applied by the UI. Only sent rows (`sent_at IS NOT NULL`) qualify: an unsent draft that happens to share the subject must not become the parent of a contact's unrelated message.

## Email worker
- The email receiver (`email-receiver/index.ts`) is a **separate worker** with its own `wrangler.toml`. `npm run deploy` does not redeploy it.
- Deploy: `npx wrangler deploy --config email-receiver/wrangler.toml`
- Unknown senders are auto-created as contacts (name from the parsed `From:` display name, email from the sender address) with `INSERT OR IGNORE`. If the insert race-conditions, the second `SELECT` fallback handles it.
- **Bounces (DSNs) are threaded onto the message that bounced** instead of creating a mailer-daemon contact. Detection: a `message/delivery-status` part, or a mailer-daemon/postmaster From address. Candidate message IDs are collected from In-Reply-To, References and a scan of the raw bytes for the original headers the DSN embeds (RFC 2046 forbids base64-encoding a `message/rfc822` part, so our send-time Message-ID appears verbatim), then looked up against sent outbound rows. On a match the row is filed under the original contact, parented to the bounced email, with `from_addr` set to the reporting MTA's address; the UI names `from_addr` instead of the contact and hides `+ Reply` on such rows. A bounce whose original cannot be found falls through to the normal flow and behaves as before.
- Inbound attachments are silently dropped if they exceed 10 MB or have no content (`!att.content`).
- Related/inline parts (`att.related`) **are** stored, with `content_id` (angle brackets stripped) and `inline = 1`, so `cid:` images in `body_html` resolve. A related part is only marked `inline` once its content ID is confirmed to appear in `body_html`; otherwise it stays `inline = 0` so it remains visible as a file instead of vanishing from the UI.
- Notification emails (one per `NOTIFY_ADDRS`) are sent with a 500-character body preview. Notification failures are caught and never affect inbound processing.
- The rate limiter uses a KV counter keyed by time-bucket (`rate:inbound:{bucket}`). It warns once per bucket via email when the limit is reached, then silently discards. The counter is not atomically exact (read-increment-write), but effective against sustained spam.

## Build patch (`scripts/patch-opennext.mjs`)
Applied automatically via the `postinstall` hook. Three changes to `@opennextjs/cloudflare`:
1. Adds `"cloudflare:email"` to the esbuild `external` array so esbuild does not try to resolve it.
2. Changes `const patchedCode` to `let patchedCode` in the bundle server script, so the next step can reassign it.
3. Rewrites `require("cloudflare:email")` in the bundled output to `__cfEmail` (a top-level `import * as __cfEmail from "cloudflare:email"`).

The script is idempotent — it checks for each change before applying. If any patch site is missing, it exits with code 1. Do not remove or restructure it without understanding the import chain.

## HTML email rendering
**Only inbound mail is rendered as HTML.** `useSanitisedHtml` gates on `sender === null`, so an outgoing message always shows its plain-text `body`: replies are composed as plain text and are read back that way, even though the copy the recipient gets carries an HTML part for the quote chain. Since the send path does not write `body_html`, the gate is belt-and-braces for the data as it stands, and is kept deliberately: it states the display rule rather than leaving it implied by the absence of data, and it keeps rows written by an earlier version rendering the way the current rules say they should.

Inbound HTML is sanitised, then rendered in a **sandboxed iframe** per message, not injected into the page. That isolation is what allows `<style>` blocks to be kept: they can only affect the message's own document. Native clients all render messages in an isolated document; among webmail, Gmail and Outlook web inject inline and maintain a CSS rewriter to scope selectors (you can see it in Gmail's DOM as `m_<messageid>_` class prefixes), while smaller clients such as Roundcube use a frame. A frame is the right trade for a codebase this size: the alternative means owning a selector rewriter whose failure mode is a sender's CSS escaping into the app.

**Frame (`src/components/EmailFrame.tsx`, document assembled by `buildEmailDocument`).**
- `sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"`. No `allow-scripts`, so nothing in the message can execute, which is what makes `allow-same-origin` safe: it exists only so the parent can read the document to size the frame. `allow-popups` is required or link clicks do nothing, and `allow-popups-to-escape-sandbox` stops the opened page inheriting the sandbox.
- A `srcdoc` frame **inherits the parent's CSP**, so `img-src 'self' data:` keeps blocking remote images inside it and the whole image-proxy design carries over unchanged.
- Height is measured from `body.scrollHeight` (not `documentElement`, which would feed back into the height we set) and tracked with a `ResizeObserver`, because images arrive after load and expanding the quote reflows. Clamped between `MIN_FRAME_HEIGHT` and `MAX_FRAME_HEIGHT`; the floor keeps an email that hides its own content from collapsing to nothing, the ceiling bounds a runaway layout.
- The quote is included in or omitted from the document rather than hidden, since no script inside can toggle it. Changing `srcDoc` re-navigates the frame, which is cheap.
- If `contentDocument` cannot be read, the card falls back to the plain-text `body` and logs.
- Message styling lives in `FRAME_STYLES` in `email-html.ts`, and is short because browser defaults apply inside the frame. Do not move it back into `globals.css`: the reason the old inline approach needed ~110 lines there was to undo Tailwind's preflight.

**Sanitiser (`src/lib/email-html.ts`).** Client-only. Still the security boundary in practice, even though the sandbox blocks script execution, and it is what does the image rewriting. Returns `{ main, quote, blockedImages }`.
- `<style>`, `class` and `id` are all **kept** — the frame isolates them, and the email's own selectors need its class and id attributes to match. `base` and `link` stay forbidden (the frame sets its own `<base target>`, and a stylesheet link is a remote fetch). Inline `style` attributes keep everything except `url(...)`, `position` and `expression(`; `position` goes because fixed elements do not contribute to `scrollHeight` and would break sizing.
- The input is wrapped in a `<div>` before sanitising. This is load-bearing: the HTML parser hoists a *leading* `<style>` into `<head>`, and DOMPurify returns body content only, so an email whose fragment starts with a style block (exactly where `htmlToFragment` puts the ones it lifts out of the head) would silently lose it.
- `@import` is stripped from surviving `<style>` elements. The inherited CSP would refuse the fetch anyway; this stops it being attempted.
- Quote splitting looks for the first `.gmail_quote_container`, `.gmail_quote`, `.moz-cite-prefix`, `#divRplyFwdMsg`, `#appendonsend`, `div.OutlookMessageHeader`, `hr#stopSpelling` or `blockquote`, descending through single-wrapper divs, then takes that node and its following siblings. This feeds the same `···` toggle the plain-text path uses.
- DOMPurify is loaded with a dynamic `import()` shared across cards (`loadPurifier` in `src/hooks/useSanitisedHtml.ts`), so it never runs during the prerender of the `'use client'` page. Until it resolves, and if it fails outright, the card falls back to the plain-text `body`.
- **A DOMPurify instance is itself callable** (`DOMPurify(window)` binds a new one), so it must never be passed straight to a `setState`: React would take it for an updater, call it with the previous state, and store the window-less factory that `DOMPurify(null)` returns, which has no `addHook` or `sanitize`. `useSanitisedHtml` holds it in a `{ purify }` wrapper so that mistake is a type error rather than a runtime one.

**Images.** `cid:` references are rewritten to `/api/contacts/{id}/emails/{emailId}/attachments/{attId}?inline=1`; a `cid:` with no matching attachment row has its `<img>` removed rather than left broken (which is what backfilled emails look like, since inline parts were discarded before they were stored). Attachments with `inline = 1` are filtered out of the attachment chip rows.

Remote images are blocked by default and replaced with a placeholder. A remote `<img>` that declares dimensions of 4px or less is deleted outright: it is a tracking pixel with nothing to show, so "Load images" never fires it and the count reflects only real images. `blockedImages` and `blockedImagesInQuote` are counted separately, by querying each half for the `mf-img-blocked` marker after the quote split, because the quote is absent from the frame document while collapsed; the button sums only what is actually on screen. Clicking `Load images (n)` re-sanitises with `loadImages`, rewriting `src` to `/api/img?u=...`. The choice is per-card component state and is deliberately **not** persisted, so a stale decision cannot silently contact a sender on a later view. CSS `url(...)` backgrounds stay blocked in both modes.

**Image proxy (`src/app/api/img/route.ts`).** Same-origin, so remote images satisfy the existing `img-src 'self'` CSP with no change to `middleware.ts`, and the sender sees a Cloudflare address rather than the reader's. Middleware authenticates it like any other route, so it is not an open proxy. Guards, before any fetch: `http:`/`https:` only, ports 80/443 only, and no IP literals, `localhost`, or `.local`/`.internal`/`.home`/`.lan` hosts. Redirects are followed by hand (up to `MAX_REDIRECTS`) with every hop re-checked against the same guards, since the initial checks vetted only the URL the email supplied. Then a 10-second timeout, an `image/*` content-type requirement, and a 5 MB cap enforced while the body streams in, so an upstream that lies about its length is cut off rather than buffered whole. The response is rebuilt from scratch so no upstream header reaches the browser.

**Nothing proxied is stored durably**, and it must stay that way. Deduplication is Cloudflare's edge cache, via `cf: { cacheEverything, cacheTtl }` on the upstream fetch; `cacheTtl` deliberately overrides the origin's own headers because servers hosting marketing images routinely send `no-store`. An earlier version cached to R2 under an `img-cache/` prefix and was changed on purpose: cache objects have no `attachment` row, so no deletion path could reach them, and deleting an email left its images (and their URLs, in `customMetadata`) in the bucket indefinitely. Do not reintroduce a durable image cache without a cleanup path; note that a URL-keyed cache cannot simply be evicted per email, since the same URL may still be referenced by a surviving one.

Inline (`cid:`) images are a different matter and *are* stored in R2, but they are rows in the `attachment` table, so the existing cleanup in `contacts/[id]/route.ts` and `emails/[emailId]/route.ts` already removes them when an email or contact is deleted.

**Plain-text extraction (`src/lib/html-to-text.mjs`).** Deliberately plain ESM, not TypeScript, so the receiver (via wrangler's esbuild) and `scripts/backfill-html-bodies.mjs` (via bare node) share one implementation; live ingest and the migration must derive identical text for the same input. Quoted sections get the `> ` prefix so `splitQuote` still works on the derived text. Its output is only ever rendered as escaped text, so it is **not** a security boundary.

## Shared constants
- `isValidEmail` is exported from `src/app/api/contacts/route.ts` for server-side use. It is also defined in `src/lib/format.ts` for client-side use; this duplication is intentional (different environments); do not consolidate.
- `src/lib/html-to-text.mjs` is a deliberate exception to that rule: the receiver and the backfill script import the same file, because a divergence between them would make migrated rows read differently from newly received ones.
- `src/lib/mime.ts` (`encodeHeaderText`, `rfc2822Date`, `extractMessageIds`) is shared the same way, between `send-emails/route.ts` and the receiver: both build raw MIME messages and must encode headers and parse message-id lists identically.
- `SEND_ADDRS` is **not** a shared constant; it comes from `env.SEND_ADDRS` at runtime (server) or `/api/config` (client). `/api/config` is public so the login page can show the organisation name, but it only includes `sendAddrs` for authenticated requests; it checks the `__remember` cookie against KV itself, since middleware waves the route through.
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

`img-src 'self' data:` is what blocks remote images in HTML emails, and it needs no relaxing: the proxy at `/api/img` is same-origin, and blocked-image placeholders use a `data:` URI. Do not add `https:` to `img-src` to "fix" email images; that would let every tracking pixel fire straight from the browser.

## Input limits
- Email body: 100,000 characters (enforced in POST and PATCH handlers)
- Email subject: 500 characters (enforced in POST and PATCH handlers)
- Inbound attachments: 10 MB per file; oversized attachments are silently dropped in the email receiver before the R2 write
- Inbound `body_html`: 500,000 characters. Over that it is dropped rather than truncated, since a half-written fragment renders as broken markup; the plain-text `body` is still stored
- Proxied remote images: 5 MB, and `/api/img?u=` itself caps the URL at 2048 characters

## Authentication

### Login (`POST /api/auth`)
On successful password check, a `crypto.randomUUID()` token is generated and one KV key is written: `remember:<token>` (empty value), which middleware looks up on every request. Each login gets its own independent token, so **any number of sessions can be active simultaneously**; logging in never touches anyone else's token. There used to be a `session` marker key enforcing a single active session (with a 409 overlap check and a "Log in anyway" displacement flow); it was removed when the app went multi-session. Stale `session` keys in existing KV namespaces expire on their own TTL and are ignored.

The `__remember` cookie (HttpOnly, SameSite=Strict) holds the token. When "Remember me" is unchecked, the cookie has no Max-Age (browser-session cookie) and the KV key uses `SESSION_TTL_HOURS`. When checked, the cookie gets a Max-Age and the KV key uses `REMEMBER_TTL_DAYS`.

### Middleware auth check
Middleware reads `__remember` from the request, looks up `remember:<cookieValue>` in KV. If found → authenticated. If not → redirect to `/login` (or 401 for API routes). Visiting `/login` with a valid cookie redirects straight to `/`. One KV read per request, no session-creation side effects. KV is eventually consistent across edge locations, so a token created at one location can take up to a minute to become visible at another; the worst case is one spurious redirect to `/login` shortly after logging in from elsewhere.

### Logout (`DELETE /api/auth`)
Deletes `remember:<token>` from KV (only the caller's own session) and clears the `__remember` cookie. There is no "log out everywhere"; other sessions' tokens expire on their TTL.

### Dev mode
When `DEV_MODE` is set, a hardcoded token (`dev-remember-token`) is used. KV is not read or written. The `Secure` flag is omitted from the cookie.

### Constants
The `REMEMBER_COOKIE` constant is defined identically in both `middleware.ts` and `auth/route.ts`. This duplication is intentional (same reason as `isValidEmail`): middleware and API routes are different execution contexts and should not share imports.

### Password comparison
`/api/auth` uses a manual XOR-reduce constant-time comparison (`a[i] ^ b[i]` accumulated into a single `diff`) to avoid leaking password length or content via timing. Do not replace with a plain `===` comparison.

## Client structure
`page.tsx` holds `OutreachPage`: all page-level state, the fetch handlers, the polling loop and the layout. Everything presentational or self-contained lives in its own module and receives state via props:

- `src/lib/types.ts`: the client-side interfaces (`Contact`, `EmailRecord`, `SearchResult`, ...).
- `src/lib/format.ts`: pure helpers (`isValidEmail`, `validateCc`, `splitQuote`, `formatDate`, `formatSize`, `fuzzyMatch`, `hexToRgba`).
- `src/components/`: `ContactSidebar`, `ContactForm`, `EmailCard`, `NewEmailCard`, `EmailFrame`, `SendModal`, `TagChip`, `ReplyPreview`, `AttachmentChip`, `SnippetText`, plus `styles.ts` with the shared Tailwind class strings.
- `src/hooks/useSanitisedHtml.ts`: DOMPurify loading and HTML sanitisation per card.
- `src/hooks/useEmailSearch.ts`: the debounced server-side message search (query state, results, 503 handling).

Components take callbacks rather than reaching for shared state; `EmailCard` and `NewEmailCard` receive `onSave`/`onSend`/`onDelete` handlers defined in `OutreachPage`, which is the only place that mutates server data.

## Client fetch pattern
All API `fetch` calls go through the `apiFetch` wrapper (defined inside `OutreachPage` and passed to `useEmailSearch`), which redirects to `/login` on any 401 response. Two exceptions use raw `fetch` deliberately: the logout `DELETE /api/auth` (redirect is handled explicitly after it) and the `ContactForm` `/api/tags` fetch (non-critical autocomplete in a subcomponent without a router).

## Client state (page.tsx)
- **Polling**: a 5-second `setInterval` (`POLL_INTERVAL_MS`) reads `/api/revision`, and only when that counter has moved does it refetch `/api/contacts/{id}/emails`, `/api/contacts` and `/api/send-emails`. An idle tab therefore costs one indexed row read per tick instead of three list queries. A `visibilitychange` listener pauses polling when the tab is hidden and fires an immediate poll when it becomes visible again. Do not remove this without an alternative refresh mechanism.
  - The counter comes from the `meta` table via triggers (see Database), so **any new write path is covered automatically**; a new *table* the UI reads is not, and needs its own triggers.
  - Two refs, not state, so the poll reads them without restarting its interval: `lastRevision` (the revision the held data was read against) and `lastFullRefresh`. The revision is recorded *before* the lists are refetched, so a write landing between the two still reads as a change on the next poll; the cost is an occasional redundant refetch, which is the right way round to be wrong.
  - `lastRevision` is deliberately left unset at mount. The first poll then always refetches, which picks up anything written while the page was loading; recording it in the mount effect would race the initial list fetches and could store a revision newer than the data they returned.
  - `FALLBACK_REFRESH_MS` (60 s) forces a refetch regardless of the revision, so a missing trigger degrades to a slow refresh rather than a stuck view.
  - `/api/revision` returns `revision: null` rather than an error when the `meta` row is missing, and the client treats null as "unknown" and refetches. A deployment whose database predates migration 003 therefore behaves as it did before, just without the saving.
  - The poll effect runs whether or not a contact is selected; only the emails fetch is skipped when `selectedId` is null. It used to return early, which left the contact list and the pending badge stale on the empty state. With the revision gate that no longer costs anything.
- **Contact persistence**: the selected contact ID is stored in `localStorage` under the key `mf_contact` and restored on mount (a corrupt value falls back to null rather than becoming a NaN id). This survives page reloads and browser restarts.
- **Stale responses**: `fetchEmails` drops a response when the user has switched contacts while it was in flight (`selectedIdRef`), so a slow fetch cannot overwrite the newly selected thread.
- **HTML bodies**: `useSanitisedHtml` (in `src/hooks/`) memoises on a `cidKey` built from the attachment ids and content IDs rather than on the array itself, because a poll that does refetch hands back a fresh array and would otherwise re-sanitise and rebuild the injected DOM.

## CC delivery
Outgoing CC addresses are stored as a comma-separated string in the `cc` column and validated in the email POST and PATCH handlers, so an invalid address is rejected at composition rather than surfacing at send time. At send time (`send-emails/route.ts`), the raw email is delivered separately to each CC address (one `EMAIL_SENDER.send()` call per address) rather than relying on the SMTP `Cc:` header for delivery. The `Cc:` header is still included in each copy for recipient visibility. The CC list is deduplicated case-insensitively and excludes the address the contact's copy went to (contact or Reply-To), so listing the contact in CC cannot deliver them a second copy.

The row is marked sent **before the contact's copy is delivered**, as a concurrency claim: `UPDATE email SET sent_at = ?, message_id = ? WHERE id = ? AND sent_at IS NULL`, and the send is skipped when `meta.changes` is 0 because another request claimed the row first. With multiple simultaneous sessions, two users clicking Send on the same draft would otherwise both read it as pending and both deliver it. A failed send releases the claim (sets `sent_at` and `message_id` back to NULL) so the retry behaviour is unchanged; once the contact's copy has gone out, nothing releases it, because a CC failure or a failed post-send body rewrite must not cause the contact's copy to be delivered twice. The residual risk is a crash between claim and send leaving the row marked sent but undelivered, which is the right way round to be wrong. A failed CC copy is reported in the send result's `errors`.

## Styling
- Tailwind CSS 4 with `shadcn/ui` and `tw-animate-css`.
- The app is dark-only. `layout.tsx` puts `dark` directly in the `<html>` className; there is no theme provider. It **must** stay in the server-rendered HTML, because the colour variables in `globals.css` default to a light palette under `:root`, so a class applied only on hydration means the first paint is white. `next-themes` used to do this and was removed: it was providing nothing but that one class, and its inline pre-hydration script threw `ReferenceError: __name is not defined`. The cause is worth knowing, because any library that serialises a function into an inline script will hit it: next-themes emits `` `(${fn.toString()})(...)` ``, and esbuild's `keepNames` rewrites named inner functions to append a `__name(fn, "fn")` call, which lands in the serialised source where the helper is not in scope. The script died, so the class never arrived before hydration and every load flashed white.
- Two Google Fonts loaded via `next/font/google`: DM Sans (body, variable `--font-dm-sans`) and Libre Baskerville (headings, variable `--font-playfair`). A custom `font-heading-bold` utility class uses the Playfair variable.
- `robots.ts` serves `Disallow: /` for all user agents as a static route (complementing the `X-Robots-Tag` header set by middleware). `robots.txt` is excluded from the middleware matcher; behind the auth wall it would redirect to `/login` and never be served to a crawler.
- `.mf-email-frame` at the end of `globals.css` styles only the message frame element itself, and must stay borderless and `display: block` because its height is set from its content. The message inside it is styled by `FRAME_STYLES` in `src/lib/email-html.ts`, where Tailwind's preflight cannot reach it. The frame surface is white because senders write inline colours such as `#333` assuming a light background.
