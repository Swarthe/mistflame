-- HTML email rendering: store the HTML alternative alongside the plain-text body,
-- and keep inline (cid:) attachments instead of discarding them.
--
-- Apply locally:
--   npx wrangler d1 execute DB --local --file db/migrations/001-html-email.sql
-- Apply remotely:
--   npx wrangler d1 execute mistflame-db --remote --file db/migrations/001-html-email.sql
--
-- SQLite has no ADD COLUMN IF NOT EXISTS; rerunning this file fails on the first
-- statement rather than doing nothing. Check with:
--   npx wrangler d1 execute DB --local --command "PRAGMA table_info(email)"

-- NULL means the email has no HTML alternative; body is then the only rendition.
ALTER TABLE email ADD COLUMN body_html TEXT;

-- Content-ID of an inline part, angle brackets stripped. NULL for ordinary files.
ALTER TABLE attachment ADD COLUMN content_id TEXT;

-- 1 = referenced from the HTML body via cid:, not shown as a downloadable file.
ALTER TABLE attachment ADD COLUMN inline INTEGER NOT NULL DEFAULT 0;
