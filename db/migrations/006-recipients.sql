-- Multiple recipients and BCC. Two columns on email:
--
-- to_addrs: comma-separated To addresses. Meaning depends on state:
--           inbound rows hold every address in the parsed To: header
--           (the envelope address that received the mail stays in
--           `recipient`); outgoing drafts hold the *extra* To addresses
--           beyond the contact; sent rows hold the full delivered To
--           list, written by the send-time claim so history survives
--           later edits to the contact's address.
-- bcc:      comma-separated BCC addresses, outgoing only; delivered as
--           separate copies and never emitted in any header.
--
-- Apply locally:
--   npx wrangler d1 execute DB --local --file db/migrations/006-recipients.sql
-- Apply remotely:
--   npx wrangler d1 execute mistflame-db --remote --file db/migrations/006-recipients.sql
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file is NOT safe to rerun
-- (same caveat as 001 and 005); check with PRAGMA table_info(email) first.

ALTER TABLE email ADD COLUMN to_addrs TEXT;
ALTER TABLE email ADD COLUMN bcc TEXT;
