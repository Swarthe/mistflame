-- Reply headers and bounce attribution. Three inbound-only columns on email:
--
-- reply_to:       the Reply-To address, stored only when it differs from the
--                 From address. The send path delivers replies there instead
--                 of the contact address.
-- references_hdr: the message IDs from the References header, normalised to
--                 "<a> <b>" form with the most recent last, so an outgoing
--                 reply can extend the chain per RFC 5322 and the receiver
--                 can thread on References when In-Reply-To finds nothing.
-- from_addr:      the actual From address when the row was not written by the
--                 contact it is filed under; set for delivery-status
--                 notifications (bounces) threaded onto the message that
--                 bounced, so the UI does not attribute them to the contact.
--
-- Apply locally:
--   npx wrangler d1 execute DB --local --file db/migrations/005-reply-headers.sql
-- Apply remotely:
--   npx wrangler d1 execute mistflame-db --remote --file db/migrations/005-reply-headers.sql
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file is NOT safe to rerun
-- (same caveat as 001); check with PRAGMA table_info(email) first.

ALTER TABLE email ADD COLUMN reply_to TEXT;
ALTER TABLE email ADD COLUMN references_hdr TEXT;
ALTER TABLE email ADD COLUMN from_addr TEXT;
