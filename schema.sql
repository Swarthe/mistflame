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
    -- thread_id is scoped per contact (not global); new threads get MAX(thread_id)+1 for that contact.
    thread_id      INTEGER NOT NULL,
    parent_id      INTEGER,          -- NULL = thread root
    -- sender IS NULL means inbound from the contact.
    -- sender = address string means outgoing from Mistflame (that address was used to send).
    sender         TEXT,
    sent_at        TEXT,             -- NULL = unsent draft
    subject        TEXT,
    body           TEXT    NOT NULL,
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
    FOREIGN KEY (email_id) REFERENCES email (id) ON DELETE CASCADE
);
