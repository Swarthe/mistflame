-- The contacts list is ordered by last activity (most recent email first),
-- computed as MAX(sent_at) per contact in the contacts query. The composite
-- index lets that subquery run as a covering seek instead of fetching every
-- row for its date. Its (contact_id) prefix serves every lookup the old
-- single-column index served, so idx_email_contact is dropped as redundant.
--
-- Apply locally:
--   npx wrangler d1 execute DB --local --file db/migrations/009-contact-activity.sql
-- Apply remotely:
--   npx wrangler d1 execute mistflame-db --remote --file db/migrations/009-contact-activity.sql
--
-- IF NOT EXISTS / IF EXISTS make this file safe to rerun.

CREATE INDEX IF NOT EXISTS idx_email_contact_sent ON email (contact_id, sent_at);
DROP INDEX IF EXISTS idx_email_contact;
