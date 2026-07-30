CREATE TABLE contact (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE,
    description    TEXT
);

CREATE TABLE tag (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    color          TEXT    NOT NULL DEFAULT '#888888',
    UNIQUE(name)
);

-- Tags are global; orphan tags (no contacts) are deleted after each contact update/delete.
CREATE TABLE contact_tag (
    contact_id     INTEGER NOT NULL,
    tag_id         INTEGER NOT NULL,
    PRIMARY KEY (contact_id, tag_id),
    FOREIGN KEY (contact_id) REFERENCES contact(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE
);

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
