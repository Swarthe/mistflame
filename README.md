# Mistflame

Mistflame is a lightweight email manager for small-scale outreach/CRM and
personal email domains. It gives you a single organised view of your contacts
and the complete email history with each one. You can compose outbound drafts in
the UI, and inbound replies arrive automatically via Cloudflare Email Routing.

![Mistflame screenshot](screenshot.png)

This software is intended for solo operators or small teams who need to
comprehensively manage emails and track conversations without the overhead of a
full CRM platform.

Deployed entirely on Cloudflare's infrastructure with Next.js 16: Workers
(compute), D1 (SQLite database), KV (session storage), R2 (attachments), and
Email Workers (send and receive).

## Features

**Contacts**
- Add, edit and delete contacts, with freeform colour-coded tags
- Fuzzy search and an awaiting-reply filter in the sidebar

**Search**
- One box searches contacts and message text at once: contacts by fuzzy match,
  subjects, tags and bodies by full text
- Results show a highlighted extract; clicking one jumps to that message in its
  thread

**Email history**
- Complete history per contact, grouped into threads
- HTML messages are rendered; quoted history collapses behind a toggle
- Attachments and inline images stored in R2 and shown in the UI

**Sending**
- Compose plain-text drafts, editable until sent; send one at a time or all at
  once
- Pick the sender address per email; CC and attachments supported
- Replies are threaded and quote the message they answer, preserving its HTML
- Requires the Cloudflare Workers Paid plan; receiving and reading work on the
  free tier

**Receiving**
- Inbound mail matched to contacts by sender address, with unknown senders added
  automatically
- Threading via `In-Reply-To`, with a subject-line fallback
- Remote images blocked until you ask for them, so tracking pixels do not fire
- Optional notification email on arrival (`NOTIFY_ADDRS`) and a configurable
  inbound rate limit (`RATE_LIMIT_MAX`)

**Access**
- Password-protected, any number of simultaneous sessions, with an optional
  "Remember me"

See [Security](#security) for how HTML email, remote images and authentication
are handled.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Swarthe/mistflame
cd mistflame
npm install
cp wrangler.toml.example wrangler.toml
cp email-receiver/wrangler.toml.example email-receiver/wrangler.toml
```

`wrangler.toml` and `email-receiver/wrangler.toml` are gitignored; the
`.example` files are the tracked templates. You will fill in the IDs as you
create Cloudflare resources below.

### 2. KV namespace

```bash
npx wrangler kv namespace create SESSION
```

Copy the returned ID into `wrangler.toml` under `[[kv_namespaces]]`.

### 3. D1 database

```bash
npx wrangler d1 create mistflame-db
```

Copy the returned database ID into `wrangler.toml`, then apply the schema:

```bash
npx wrangler d1 execute mistflame-db --remote --file db/schema.sql
```

### 4. R2 bucket

```bash
npx wrangler r2 bucket create mistflame-attachments
```

No ID needed, R2 bindings reference the bucket by name. The bucket holds
attachments and the inline images embedded in HTML message bodies; both are
deleted along with the email or contact they belong to.

### 5. Email routing

Email routing must be enabled on the domain before any email bindings work.

**Cloudflare Dashboard -> [your domain] -> Email -> Email Routing -> Enable**

Cloudflare will add the required MX records automatically.

**Receiving:** route inbound email to the worker for each address you want to
receive on:
- Email Routing -> Routes -> Add rule: **Custom address** (e.g. `hello@yourdomain.com`)
  -> **Send to Worker** -> `mistflame-email-receiver`

Alternatively, use a **Catch-all** rule to receive on all addresses for the
domain (useful if you want replies to any address to land in Mistflame, or if
you have not set up individual addresses).

To receive on multiple domains, enable Email Routing on each domain and add the
same per-address or catch-all route pointing to the same worker.

**Sending:** the `send_email` binding works for any address on any domain that
has Email Routing active, no per-address verification needed. Add multiple
addresses to `SEND_ADDRS` (comma-separated) to send from different domains.

> **Note:** outbound email sending via `EMAIL_SENDER` requires the **Cloudflare
> Workers Paid plan**; it is a beta feature not available on the free tier.
> Receiving inbound emails, storing them, and viewing the full UI all work
> without it; only the send action will fail if the binding is unavailable.

## Configuration

All branding and addresses are set as `[vars]` in `wrangler.toml`, no code
changes needed to customise the app for a new deployment.

### Main worker (`wrangler.toml`)

| Var | Default | Purpose |
|---|---|---|
| `ORG_NAME` | `""` | Organisation/project name; when set, shown in the UI as "Mistflame - {ORG_NAME}" and used as the display name in email `From:` headers; leave empty to show "Mistflame" only |
| `SEND_ADDRS` | `"hello@example.com"` | Comma-separated list of sender addresses available in the UI |
| `SESSION_TTL_HOURS` | `"24"` | KV TTL for the auth token when "Remember me" is unchecked |
| `REMEMBER_TTL_DAYS` | `"30"` | KV TTL and cookie lifespan for the auth token when "Remember me" is checked |

### Email receiver worker (`email-receiver/wrangler.toml`)

| Var | Default | Purpose |
|---|---|---|
| `NOTIFY_ADDRS` | `""` | Comma-separated list of addresses to email when a new inbound message arrives; leave empty to disable |
| `RATE_LIMIT_MAX` | `"30"` | Soft limit on inbound emails per window (`0` = disabled); requires the `KV` binding. Enforced via a KV counter; not a hard guarantee, but effective against sustained spam |
| `RATE_LIMIT_WINDOW_MINUTES` | `"60"` | Window length in minutes for the rate limit |

### Bindings

| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 Database | Contacts and email history |
| `SESSION` | KV Namespace | Auth tokens, one per active session |
| `ATTACHMENTS` | R2 Bucket | Email attachments, including inline (`cid:`) images from HTML bodies |
| `EMAIL_SENDER` | Send Email | Outbound email via Cloudflare Email Workers |
| `KV` | KV Namespace | Rate limit counters (email receiver only; can share the `SESSION` namespace) |
| `PASSWORD` | Secret | Login password |

## Deployment

### 1. Set password

```bash
npx wrangler secret put PASSWORD
```

> **Warning:** if `PASSWORD` is not set, the site is unprotected; anyone can log in by submitting an empty password.

### 2. Deploy main worker

```bash
npm run deploy
```

### 3. Deploy email receiver worker

The inbound worker has its own `wrangler.toml` and must be deployed separately:

```bash
npx wrangler deploy --config email-receiver/wrangler.toml
```

Redeploy this worker whenever `email-receiver/index.ts` changes (`npm run
deploy` only redeploys the main worker).

### 4. Apply any pending migrations

`db/schema.sql` always describes the current shape of the database, so an
install created from it already has every migration applied. `db/migrations/`
holds the numbered files that bring an *existing* database up to that shape, and
the two are always updated together.

**1. Back up.** `wrangler d1 export` refuses a database containing a virtual
table, and the search index is one, so drop it before exporting and reapply the
migration afterwards. The index holds no text of its own, so nothing is lost:

```bash
npx wrangler d1 execute mistflame-db --remote --command "DROP TABLE email_fts"
npx wrangler d1 export mistflame-db --remote --output backup.sql
npx wrangler d1 execute mistflame-db --remote --file db/migrations/004-email-fts.sql
```

**2. Apply the migrations,** in order:

```bash
npx wrangler d1 execute mistflame-db --remote --file db/migrations/001-html-email.sql
npx wrangler d1 execute mistflame-db --remote --file db/migrations/002-indexes.sql
npx wrangler d1 execute mistflame-db --remote --file db/migrations/003-revision.sql
npx wrangler d1 execute mistflame-db --remote --file db/migrations/004-email-fts.sql
```

002 to 004 use `IF NOT EXISTS` throughout and are safe to reapply, so an already
current database is left alone. 001 is not: SQLite has no
`ADD COLUMN IF NOT EXISTS`, so it errors rather than doing nothing. Check
whether it is needed with
`npx wrangler d1 execute mistflame-db --remote --command "PRAGMA table_info(email)"`.

Swap `--remote` for `--local` and the database name for the binding name `DB` to
apply the same files to a development database. A one-off change can go through
`--command` rather than a file:

```bash
npx wrangler d1 execute mistflame-db --remote --command "ALTER TABLE email ADD COLUMN notes TEXT"
```

## Security

- **Authentication**: a single password, compared in constant time so a wrong
  guess cannot be distinguished by timing. Each login gets its own session
  token, so any number of sessions can be active at once; logging out ends
  only your own.
- **HTML email**: inbound HTML is sanitised with DOMPurify and rendered in a
  sandboxed iframe with scripts disabled, so a sender's markup and stylesheet
  apply to their message and cannot reach the rest of the app.
- **Remote images**: blocked by default and replaced with a placeholder, so
  tracking pixels do not fire when a message is opened. "Load images" fetches
  them through the worker, so the sender sees a Cloudflare address rather than
  your IP address; images declaring dimensions of 1x1 are discarded and never
  load at all. Nothing proxied is stored, so deleting an email leaves no trace
  of its images.
- **Indexing**: `robots.txt` serves `Disallow: /` for all user agents, and
  `middleware.ts` sets `X-Robots-Tag: noindex, nofollow` and a restrictive
  Content-Security-Policy on every HTML response. That policy is what keeps
  remote images blocked, so do not loosen `img-src`.
- **Input limits**: inbound attachments are capped at 10 MB each and oversized
  ones are dropped; email bodies are limited to 100,000 characters and subjects
  to 500; proxied images are capped at 5 MB.

**Recommended:** add a Cloudflare WAF rate limiting rule to prevent brute force
attacks:

1. Dashboard -> Security -> WAF -> Rate limiting rules -> Create rule
2. Fields: **Hostname** equals `your-domain.com` **AND** **URI Path** starts with `/api`
3. Threshold: 20 requests per 10 seconds per IP (example)
4. Action: Block, Duration: 10 seconds

Scoping by hostname matters if other workers share the same Cloudflare zone; a
plain `/api/*` rule also rate-limits API routes on those workers.

## Development

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in
values. Secrets are never stored in config files.

```bash
cp .dev.vars.example .dev.vars      # fill in values
npm run dev                         # local Next.js dev server (no CF bindings)
npm run preview                     # Cloudflare Workers preview with local binding simulators
npm run preview:remote              # Cloudflare Workers preview against real remote bindings
```

The local D1 database is created automatically on first run. Apply the schema
and optionally seed it with example contacts and email threads for testing:

```bash
# Apply schema
npx wrangler d1 execute DB --local --file db/schema.sql

# Seed with example data (2 contacts, 4 threads covering all email states,
# including an HTML email with inline, remote and quoted content)
npx wrangler d1 execute DB --local --file db/seed-local.sql

# Reset all data (attachments first, or re-seeding hits a primary key conflict)
npx wrangler d1 execute DB --local --command "DELETE FROM attachment; DELETE FROM email; DELETE FROM contact; DELETE FROM tag; DELETE FROM contact_tag; DELETE FROM sqlite_sequence WHERE name IN ('email','contact','tag','attachment');"
```

The seeded HTML email references an inline image, whose bytes have to be put
into local R2 separately or it renders as a missing image; the comment above
thread 4 in `db/seed-local.sql` has the one-off command.

All `wrangler d1` commands use the binding name `DB` (not the database name) and
must be run from the project root. Local state is stored in
`.wrangler/state/v3/d1/` (gitignored); delete that directory to fully reset the
database.

## Limitations and missing features

Contributions and feature requests are welcome. The following features are not
currently implemented.

- **Rich-text composing**: the composer is plain text only. Replies to HTML
  emails carry an HTML part so the quote chain survives, but your own words in
  the reply are not formatted
- **Inline images in quoted history**: `cid:` images are dropped from the quote
  of an outgoing reply, since their Content-ID belongs to the received message.
  A full mail client re-attaches those parts; this one does not
- **Remote images in CSS**: `url(...)` backgrounds in inline styles stay blocked
  even after "Load images"; only `<img>` elements are proxied
- **Search scope**: full-text search covers subjects and message text, but not
  attachment contents or contact descriptions, and there are no field filters
  such as `from:` or date ranges
- **Contact import/export**: no CSV or vCard import/export
- **Pagination**: long contact lists and email histories are loaded in full
- **Email templates / LLM integration**: no reusable draft templates or LLM
  support for reply generation
- **Scheduled sending**: no support for sending emails at a scheduled time
- **User accounts**: no per-user accounts or roles; everyone shares one
  password and sees the same data
- **Push updates**: new mail appears through polling rather than a push, so it
  can take up to five seconds to show. The poll itself is cheap (see Notes), but
  there is no WebSocket or SSE channel

## Notes

- The `middleware.ts` deprecation warning during builds is expected and
  harmless, `@opennextjs/cloudflare` 1.x requires this convention
- D1 FK constraints are declared in the schema but not enforced at runtime;
  cascading deletes are handled manually in route handlers
- The client checks for new mail every five seconds, but rather than refetching
  the contact list, the open thread and the pending-send count each time, it
  reads a single counter from `GET /api/revision` and only refetches when that
  number has moved. The counter lives in the `meta` table, maintained by SQLite
  triggers on every user-visible table; triggers rather than bumps in the route
  handlers, because the email receiver is a separate worker that writes to D1
  directly and never goes through the API. An idle tab therefore costs one
  indexed row read per poll, and polling pauses while the tab is hidden. A full
  refetch happens once a minute regardless, so a write path that ever lands
  without a trigger behind it degrades to a slow refresh rather than a stuck
  view
- Emails received before HTML rendering existed have raw markup stored in their
  body column. `scripts/backfill-html-bodies.mjs` converts those rows into a
  readable text body plus the HTML fragment; it reads a D1 dump and writes SQL
  for review rather than touching the database itself. Its inputs and output
  contain real correspondence and are gitignored

## License

Copyright (C) 2026 Emil A. Overbeck `<emil.a.overbeck at gmail dot com>`.

This file is part of `Mistflame`.

This software is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along
with this program.  If not, see <https://www.gnu.org/licenses/>.
