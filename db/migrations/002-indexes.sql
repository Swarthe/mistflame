-- Indexes for the query paths the client polls and the receiver runs on every
-- inbound message. The schema had none, so each of those was a full table scan.
--
-- Apply locally:
--   npx wrangler d1 execute DB --local --file db/migrations/002-indexes.sql
-- Apply remotely:
--   npx wrangler d1 execute mistflame-db --remote --file db/migrations/002-indexes.sql
--
-- IF NOT EXISTS makes this file safe to rerun.

-- Thread and history reads: every email query filters on contact_id, and the
-- recursive CTE walks parent_id.
CREATE INDEX IF NOT EXISTS idx_email_contact ON email (contact_id);
CREATE INDEX IF NOT EXISTS idx_email_parent ON email (parent_id);

-- awaiting_reply in the contacts query tests, per contact, whether an inbound
-- email has no children. Partial, so it holds only the inbound rows.
CREATE INDEX IF NOT EXISTS idx_email_inbound ON email (contact_id)
    WHERE sender IS NULL;

-- The pending-send count and the send query both scan for unsent outgoing rows
-- and then join to the parent to check it has been sent.
CREATE INDEX IF NOT EXISTS idx_email_draft ON email (parent_id)
    WHERE sent_at IS NULL AND sender IS NOT NULL;

-- Inbound In-Reply-To matching. Drafts have no message_id, hence partial.
CREATE INDEX IF NOT EXISTS idx_email_message_id ON email (message_id)
    WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attachment_email ON attachment (email_id);

-- The contact_tag PK covers contact_id lookups but not the reverse direction,
-- which the orphan-tag cleanup uses.
CREATE INDEX IF NOT EXISTS idx_contact_tag_tag ON contact_tag (tag_id);

-- The receiver looks contacts up case-insensitively, and upsertTags does the
-- same for tags. LOWER() defeats the UNIQUE indexes, so both need an
-- expression index to avoid a scan.
CREATE INDEX IF NOT EXISTS idx_contact_email_lower ON contact (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_tag_name_lower ON tag (LOWER(name));

-- The contacts list is always returned ORDER BY name.
CREATE INDEX IF NOT EXISTS idx_contact_name ON contact (name);
