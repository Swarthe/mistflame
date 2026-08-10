-- Contact archiving: a finished conversation can be tucked away without
-- deleting its history. Archived contacts move to a collapsed section at the
-- bottom of the sidebar; the receiver clears the flag when new inbound mail
-- arrives, so a revived conversation resurfaces on its own.
--
-- Apply locally:
--   npx wrangler d1 execute DB --local --file db/migrations/010-contact-archive.sql
-- Apply remotely:
--   npx wrangler d1 execute mistflame-db --remote --file db/migrations/010-contact-archive.sql
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so rerunning this file errors
-- rather than doing nothing; check with PRAGMA table_info(contact) first.

ALTER TABLE contact ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
