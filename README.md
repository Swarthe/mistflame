# Mistflame

A self-contained email CRM. Manage contacts, draft and send emails, track
reply threads, and handle inbound replies. Deployed on Cloudflare Workers via
[OpenNext](https://opennext.js.org/cloudflare).

## Stack

- **Next.js 16** (App Router)
- **Cloudflare Workers**: hosting
- **Cloudflare D1**: contacts and email history
- **Cloudflare KV**: session storage
- **Cloudflare R2**: email attachments
- **Cloudflare Email Workers**: sending and receiving email

## Development

```bash
npm install
cp .dev.vars.example .dev.vars    # fill in values
npm run dev                       # local Next.js dev server (no CF bindings)
npm run preview                   # Cloudflare Workers preview with local binding simulators
npm run preview:remote            # Cloudflare Workers preview against real remote bindings
```

## Deployment

```bash
npm run deploy
```

The email receiver worker is deployed separately (see [Email
receiver](#email-receiver) below).

## Cloudflare setup

### 1. KV namespace

```bash
npx wrangler kv namespace create SESSION
```

Copy the returned ID into `wrangler.toml` under `[[kv_namespaces]]`.

### 2. D1 database

```bash
npx wrangler d1 create mistflame-db
```

Copy the returned database ID into `wrangler.toml`, then apply the schema:

```bash
npx wrangler d1 execute mistflame-db --remote --file schema.sql
```

### 3. R2 bucket

```bash
npx wrangler r2 bucket create mistflame-attachments
```

No ID needed, R2 bindings reference the bucket by name.

### 4. Email routing

Email routing must be enabled on the domain before any email bindings work.

**Cloudflare Dashboard → your domain → Email → Email Routing → Enable**

Cloudflare will add the required MX records automatically.

**Receiving:** add a catch-all route to the inbound worker:
- Email Routing -> Routes -> Add rule: **Catch-all** -> **Send to Worker** ->
  `mistflame-email-receiver`

To receive on multiple domains, enable Email Routing on each domain and add the
same catch-all route pointing to the same worker.

**Sending:** the `send_email` binding works for any address on any domain that
has Email Routing active, no per-address verification needed. Add multiple
addresses to `SEND_ADDRS` (comma-separated) to send from different domains.

### 5. Email receiver worker

The inbound worker has its own `wrangler.toml` and is deployed independently:

```bash
npx wrangler deploy --config workers/email-receiver/wrangler.toml
```

Redeploy this worker whenever `workers/email-receiver/index.ts` changes (`npm
run deploy` only redeploys the main worker).

### 6. Secrets

```bash
npx wrangler secret put PASSWORD
```

## Configuration

All branding and addresses are set as `[vars]` in `wrangler.toml`, no code
changes needed to customise the app for a new deployment.

### Main worker (`wrangler.toml`)

| Var | Default | Purpose |
|---|---|---|
| `ORG_NAME` | `"Mistflame"` | Organisation/project name, shown in the UI title as "Mistflame - {ORG_NAME}" and used as the display name in email `From:` headers |
| `SEND_ADDRS` | `"hello@example.com"` | Comma-separated list of sender addresses available in the UI |

### Bindings

| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 Database | Contacts and email history |
| `SESSION` | KV Namespace | Active session token (1-day TTL) |
| `ATTACHMENTS` | R2 Bucket | Inbound and outbound email attachments |
| `EMAIL_SENDER` | Send Email | Outbound email via Cloudflare Email Workers |
| `PASSWORD` | Secret | Login password |

For local development, set these in `.dev.vars` (see `.dev.vars.example`).
Secrets are never stored in config files.

## Security

- Single-user password authentication; session stored as a random token in KV
  with a 1-day TTL
- Only one active session at a time, logging in while a session exists shows a
  confirmation prompt
- Session cookie is `HttpOnly; Secure; SameSite=Strict`
- All routes are protected by middleware; unauthenticated API requests get a
  401, page requests redirect to `/login`
- If `PASSWORD` is unset, login is blocked for everyone (fails closed)
- **Recommended:** add a Cloudflare WAF rate limiting rule on all `/api/*` paths
  to prevent brute force:
  - Dashboard -> Security -> WAF -> Rate limiting rules -> Create rule
  - Field: URI Path starts with `/api`, Method: any
  - Threshold: 10 requests per 10 seconds per IP
  - Action: Block, Duration: 10 seconds

## Features

**Contacts**
- Add, edit, and delete contacts (name, email, description)
- Freeform colour-coded tags, fuzzy-searchable from the sidebar
- Auto-computed awaiting-reply indicator per contact

**Email history**
- Full email log per contact, grouped by thread
- Draft emails (`sent_at IS NULL`) are editable after creation
- Outgoing emails support CC (stored in DB, delivered separately per address)

**Sending**
- Send all pending drafts at once, or send individual emails inline
- Choose sender address per send
- Attachments (up to 10 MB each) are fetched from R2 and sent as `multipart/mixed`

**Receiving**
- Inbound emails matched to contacts by sender address
- Reply threading via `In-Reply-To` header matching with a subject-line fallback
- Attachments stored in R2 and shown in the UI
- Unknown senders auto-created as new contacts (name from display name, email from sender address)

## Project layout

```
src/
  app/
    page.tsx                    # Main UI (contacts + email threads)
    login/page.tsx              # Login form
    api/
      auth/route.ts             # Login (POST) / logout (DELETE)
      config/route.ts           # Public endpoint returning ORG_NAME, SEND_ADDRS
      contacts/route.ts         # List (GET) / create (POST)
      contacts/[id]/route.ts    # Update (PUT) / delete (DELETE)
      contacts/[id]/emails/route.ts
      contacts/[id]/emails/[emailId]/route.ts
      contacts/[id]/emails/[emailId]/attachments/route.ts
      contacts/[id]/emails/[emailId]/attachments/[attachmentId]/route.ts
      send-emails/route.ts      # Count pending (GET) / send (POST)
      tags/route.ts             # List all tags (GET, used for tag autocomplete)
  middleware.ts                 # Auth guard for all routes except /login and /api/config
  env.d.ts                      # Cloudflare env type declarations

workers/
  email-receiver/
    index.ts                    # Inbound email worker
    wrangler.toml               # Separate config; deploy independently

schema.sql                      # D1 schema (apply once with wrangler d1 execute)

scripts/
  patch-opennext.mjs            # Post-build patch for cloudflare:email ESM import
```

## Notes

- `@opennextjs/cloudflare` does not support `export const runtime = 'edge'`, all
  API routes use the default runtime
- `cloudflare:email` is ESM-only; `scripts/patch-opennext.mjs` patches the
  OpenNext bundle on every `npm install` and build
- The `middleware.ts` deprecation warning during builds is expected and
  harmless, `@opennextjs/cloudflare` 1.x requires this convention
- D1 FK constraints are declared in the schema but not enforced at runtime;
  cascading deletes are handled manually in route handlers

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
