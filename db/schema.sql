CREATE TABLE contact (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE,
    description    TEXT
);

-- LOWER() defeats the UNIQUE index, so the receiver's case-insensitive lookup
-- needs an expression index of its own.
CREATE INDEX idx_contact_email_lower ON contact (LOWER(email));
CREATE INDEX idx_contact_name ON contact (name);

CREATE TABLE tag (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    color          TEXT    NOT NULL DEFAULT '#888888',
    UNIQUE(name)
);

CREATE INDEX idx_tag_name_lower ON tag (LOWER(name));

-- Tags are global; orphan tags (no contacts) are deleted after each contact update/delete.
CREATE TABLE contact_tag (
    contact_id     INTEGER NOT NULL,
    tag_id         INTEGER NOT NULL,
    PRIMARY KEY (contact_id, tag_id),
    FOREIGN KEY (contact_id) REFERENCES contact(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE
);

-- The PK covers contact_id lookups; the orphan-tag cleanup goes the other way.
CREATE INDEX idx_contact_tag_tag ON contact_tag (tag_id);

CREATE TABLE email (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id     INTEGER NOT NULL,
    parent_id      INTEGER,          -- NULL = thread root; thread grouping is derived via recursive CTE
    -- sender IS NULL means inbound from the contact.
    -- sender = address string means outgoing from Mistflame (that address was used to send).
    sender         TEXT,
    sent_at        TEXT,             -- NULL = unsent draft
    subject        TEXT,
    body           TEXT    NOT NULL, -- canonical plain-text rendition; always populated
    body_html      TEXT,             -- HTML body fragment; NULL = plain text only
    message_id     TEXT,             -- SMTP Message-ID; NULL for drafts, set on send/receive
    recipient      TEXT,             -- inbound only: the Mistflame address that received the email
    cc             TEXT,             -- comma-separated addresses
    FOREIGN KEY (contact_id) REFERENCES contact (id),
    FOREIGN KEY (parent_id) REFERENCES email (id) ON DELETE CASCADE
);

CREATE INDEX idx_email_contact ON email (contact_id);
CREATE INDEX idx_email_parent ON email (parent_id);

-- awaiting_reply tests, per contact, whether an inbound email has no children.
CREATE INDEX idx_email_inbound ON email (contact_id) WHERE sender IS NULL;

-- The pending-send count and the send query scan for unsent outgoing rows and
-- then join to the parent to check it has been sent.
CREATE INDEX idx_email_draft ON email (parent_id)
    WHERE sent_at IS NULL AND sender IS NOT NULL;

-- Inbound In-Reply-To matching. Drafts have no message_id, hence partial.
CREATE INDEX idx_email_message_id ON email (message_id)
    WHERE message_id IS NOT NULL;

CREATE TABLE attachment (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id       INTEGER NOT NULL,
    file_name      TEXT    NOT NULL,
    content_type   TEXT    NOT NULL,
    r2_key         TEXT    NOT NULL, -- R2 object key: "<email_id>/<uuid>-<filename>"
    size           INTEGER NOT NULL,
    content_id     TEXT,             -- Content-ID of an inline part, angle brackets stripped
    inline         INTEGER NOT NULL DEFAULT 0, -- 1 = referenced from body_html via cid:
    FOREIGN KEY (email_id) REFERENCES email (id) ON DELETE CASCADE
);

CREATE INDEX idx_attachment_email ON attachment (email_id);

-- Change counter for polling: the client reads this one row every 5 seconds and
-- only refetches the lists when it has moved. Maintained by the triggers below
-- rather than by the route handlers, because the receiver worker writes to D1
-- directly and never goes through the API. Nothing writes to meta except these
-- triggers, so there is no recursion.
CREATE TABLE meta (
    key   TEXT    PRIMARY KEY,
    value INTEGER NOT NULL
);

INSERT INTO meta (key, value) VALUES ('revision', 1);

CREATE TRIGGER trg_email_insert_revision AFTER INSERT ON email
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER trg_email_update_revision AFTER UPDATE ON email
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER trg_email_delete_revision AFTER DELETE ON email
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;

CREATE TRIGGER trg_contact_insert_revision AFTER INSERT ON contact
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER trg_contact_update_revision AFTER UPDATE ON contact
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER trg_contact_delete_revision AFTER DELETE ON contact
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;

CREATE TRIGGER trg_tag_insert_revision AFTER INSERT ON tag
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER trg_tag_update_revision AFTER UPDATE ON tag
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER trg_tag_delete_revision AFTER DELETE ON tag
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;

CREATE TRIGGER trg_contact_tag_insert_revision AFTER INSERT ON contact_tag
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER trg_contact_tag_delete_revision AFTER DELETE ON contact_tag
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;

-- Attachment rows are inserted and deleted but never updated.
CREATE TRIGGER trg_attachment_insert_revision AFTER INSERT ON attachment
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
CREATE TRIGGER trg_attachment_delete_revision AFTER DELETE ON attachment
BEGIN UPDATE meta SET value = value + 1 WHERE key = 'revision'; END;
