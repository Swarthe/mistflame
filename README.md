# Mistflame

Mistflame is a lightweight email manager for small-scale outreach and personal
email domains: a single organised view of your contacts and the complete email
history with each one, for solo operators and small teams who want to track
conversations without the overhead of a full CRM. Drafts are composed in the
UI; inbound replies arrive automatically via Cloudflare Email Routing.

![Mistflame screenshot](screenshot.png)

Deployed entirely on Cloudflare's infrastructure with Next.js 16: Workers
(compute), D1 (SQLite database), KV (session storage), R2 (attachments), and
Email Workers (send and receive). Outbound sending requires the Workers Paid
plan; everything else works on the free tier.

## Features

**Contacts and history**
- Add, edit and delete contacts, with freeform colour-coded tags and an
  awaiting-reply filter. The list is ordered by most recent activity and
  shows each contact's last-activity date, with a pencil marking contacts
  that have unsent drafts
- Complete email history per contact, grouped into threads; HTML messages are
  rendered, quoted history collapses behind a toggle, and attachments and
  inline images are stored in R2 and shown in the UI
- One search box covers everything: contacts and tags by fuzzy match, subjects
  and bodies by full text, with highlighted extracts that jump to the message
  in its thread
- Finished conversations can be archived: the contact moves to a collapsed
  section at the bottom of the sidebar, history intact, and resurfaces
  automatically when new mail arrives from them

**Sending**
- Compose drafts in markdown, with a formatting toolbar, preview and
  attachments, editable until sent; send one at a time or all at once. The
  message goes out as rich text with the readable source as the plain-text
  part
- Pick the sender address per email, with extra To recipients, CC and BCC.
  Recipient fields autocomplete from your contacts, with known addresses
  highlighted
- Replies are threaded, quote the message they answer (HTML preserved) and go
  to its `Reply-To` address when one is set; Reply All pre-fills the other
  recipients
- Forward any received or sent email to another contact, attachments included;
  a typed address becomes a new contact on the spot

**Receiving**
- Inbound mail matched to contacts by sender address; unknown senders become
  contacts automatically
- Threading via `In-Reply-To` and `References`, with a subject-line fallback;
  bounces are threaded onto the message that failed rather than filed under a
  mailer-daemon contact
- Remote images blocked until you ask for them, so tracking pixels do not fire
- Optional notification emails (`NOTIFY_ADDRS`), routable per receiving
  address (`NOTIFY_MAP`), and a configurable inbound rate limit
  (`RATE_LIMIT_MAX`)

**Access**
- Password-protected, with optional "Remember me" and any number of
  simultaneous sessions; the header notes when another session is active

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

No ID needed; R2 bindings reference the bucket by name. The bucket holds
attachments and inline images, deleted along with the email or contact they
belong to.

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

> **Note:** outbound sending via `EMAIL_SENDER` requires the **Cloudflare
> Workers Paid plan** (it is a beta feature). Receiving, storage and the full
> UI work without it; only the send action fails.

## Configuration

All branding and addresses are set as `[vars]` in `wrangler.toml`; no code
changes are needed to customise a deployment.

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
| `NOTIFY_MAP` | unset | Optional JSON object routing notifications by receiving address: each key is one of your inbound addresses, each value a list of addresses to notify. An address with no entry notifies all `NOTIFY_ADDRS`; an empty list mutes it. Malformed JSON falls back to notifying everyone, with a warning line in the notification |
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
npx wrangler d1 execute mistflame-db --remote --file db/migrations/005-reply-headers.sql
npx wrangler d1 execute mistflame-db --remote --file db/migrations/006-recipients.sql
npx wrangler d1 execute mistflame-db --remote --file db/migrations/007-body-format.sql
npx wrangler d1 execute mistflame-db --remote --file db/migrations/008-presence.sql
npx wrangler d1 execute mistflame-db --remote --file db/migrations/009-contact-activity.sql
npx wrangler d1 execute mistflame-db --remote --file db/migrations/010-contact-archive.sql
```

002 to 004, 008 and 009 use `IF NOT EXISTS` throughout and are safe to
reapply, so an already current database is left alone. 001, 005 to 007 and 010
are not: SQLite has no `ADD COLUMN IF NOT EXISTS`, so they error rather than
doing nothing. Check whether they are needed with
`npx wrangler d1 execute mistflame-db --remote --command "PRAGMA table_info(email)"`.

Swap `--remote` for `--local` and the database name for the binding name `DB`
to apply the same files to a development database; a one-off statement can go
through `--command` rather than a file.

## Security

- **Authentication**: a single password, compared in constant time so a wrong
  guess cannot be distinguished by timing. Each login gets its own session
  token, so any number of sessions can be active at once; logging out ends
  only your own.
- **HTML email**: inbound HTML is sanitised with DOMPurify and rendered in a
  sandboxed iframe with scripts disabled, so a sender's markup and stylesheet
  apply to their message and cannot reach the rest of the app. Your own
  markdown-composed messages are rendered with raw HTML disabled, so markup
  typed into the composer stays literal text.
- **Remote images**: blocked by default and replaced with a placeholder, so
  tracking pixels do not fire when a message is opened. "Load images" fetches
  them through the worker, so the sender sees a Cloudflare address rather than
  your IP address; images declaring 1x1 dimensions are discarded and never
  load at all. CSS `url(...)` backgrounds follow the same rule, though with no
  declared dimensions a background-based tracker cannot be discarded like a
  pixel; it fires only after the explicit opt-in, through the proxy. Nothing
  proxied is stored, so deleting an email leaves no trace of its images.
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
values; secrets are never stored in config files.

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

The seeded HTML email references an inline image whose bytes have to be put
into local R2 separately, or it renders as a missing image; the comment above
thread 4 in `db/seed-local.sql` has the one-off command.

Local `wrangler d1` commands use the binding name `DB` (not the database name)
and run from the project root. Local state lives in `.wrangler/state/v3/d1/`
(gitignored); delete that directory to fully reset the database.

## Limitations and missing features

Contributions and feature requests are welcome. Not currently implemented:

- **WYSIWYG composing**: formatting is written as markdown in a plain
  textarea (with a toolbar and preview) rather than edited in place, and
  outgoing mail cannot carry composed inline images
- **Inline images in quoted history**: `cid:` images are dropped from the quote
  of an outgoing reply, since their Content-ID belongs to the received message.
  A full mail client re-attaches those parts; this one does not
- **Search scope**: full-text search covers subjects and bodies, but not
  attachment contents or contact descriptions, and there are no field filters
  such as `from:` or date ranges
- **Contact import/export**: no CSV or vCard import/export
- **Unified inbox**: mail is read per contact; there is no cross-contact view
  of recent inbound messages, so triage means scanning the sidebar
- **Follow-up reminders**: nothing resurfaces a contact whose last message is
  an unanswered outbound one; the awaiting-reply dot only covers mail that is
  waiting on you, not mail you are waiting on
- **Pagination**: long contact lists and email histories load in full
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
- The client checks for new mail every five seconds, but reads a single
  revision counter (`GET /api/revision`) and refetches the lists only when it
  has moved. The counter is maintained by SQLite triggers on every
  user-visible table, so the email receiver's direct D1 writes are covered
  too. An idle tab costs one indexed row read per poll, polling pauses while
  the tab is hidden, and an unconditional refetch once a minute means a write
  path without a trigger degrades to a slow refresh rather than a stuck view
- The same poll doubles as a presence heartbeat: the `presence` table stores a
  hash of each session token with a last-seen time, and the header counts the
  other sessions seen in the last 30 seconds. Sessions are anonymous, so the
  notice counts rather than names
- Emails received before HTML rendering existed have raw markup in their body
  column. `scripts/backfill-html-bodies.mjs` converts those rows to a readable
  text body plus the HTML fragment; it reads a D1 dump and writes SQL for
  review rather than touching the database. Its inputs and output contain real
  correspondence and are gitignored

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
