-- Change counter for polling. The client reads this one row every 5 seconds and
-- only refetches the contact, email and pending-send lists when it has moved.
--
-- Apply locally:
--   npx wrangler d1 execute DB --local --file db/migrations/003-revision.sql
-- Apply remotely:
--   npx wrangler d1 execute mistflame-db --remote --file db/migrations/003-revision.sql
--
-- CREATE TABLE/TRIGGER IF NOT EXISTS and INSERT OR IGNORE make this file
-- safe to rerun.

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT    PRIMARY KEY,
    value INTEGER NOT NULL
);

INSERT OR IGNORE INTO meta (key, value) VALUES ('revision', 1);

-- Triggers rather than explicit bumps in the route handlers: the receiver
-- worker writes to D1 directly and never goes through the API, and a write path
-- added later would otherwise go unnoticed by the client until the fallback
-- refresh. Nothing writes to meta except these, so there is no recursion.
CREATE TRIGGER IF NOT EXISTS trg_email_insert_revision
AFTER INSERT ON email
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER IF NOT EXISTS trg_email_update_revision
AFTER UPDATE ON email
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER IF NOT EXISTS trg_email_delete_revision
AFTER DELETE ON email
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;

CREATE TRIGGER IF NOT EXISTS trg_contact_insert_revision
AFTER INSERT ON contact
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER IF NOT EXISTS trg_contact_update_revision
AFTER UPDATE ON contact
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER IF NOT EXISTS trg_contact_delete_revision
AFTER DELETE ON contact
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;

CREATE TRIGGER IF NOT EXISTS trg_tag_insert_revision
AFTER INSERT ON tag
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER IF NOT EXISTS trg_tag_update_revision
AFTER UPDATE ON tag
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER IF NOT EXISTS trg_tag_delete_revision
AFTER DELETE ON tag
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;

CREATE TRIGGER IF NOT EXISTS trg_contact_tag_insert_revision
AFTER INSERT ON contact_tag
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER IF NOT EXISTS trg_contact_tag_delete_revision
AFTER DELETE ON contact_tag
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;

-- Attachment rows are inserted and deleted but never updated.
CREATE TRIGGER IF NOT EXISTS trg_attachment_insert_revision
AFTER INSERT ON attachment
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER IF NOT EXISTS trg_attachment_delete_revision
AFTER DELETE ON attachment
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
