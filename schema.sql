CREATE TABLE contact (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE,
    description    TEXT
);

CREATE TABLE tag (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    color          TEXT NOT NULL DEFAULT '#888888',
    UNIQUE(name)
);

CREATE TABLE contact_tag (
    contact_id     INTEGER NOT NULL,
    tag_id         INTEGER NOT NULL,
    PRIMARY KEY (contact_id, tag_id),
    FOREIGN KEY (contact_id) REFERENCES contact(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tag(id)     ON DELETE CASCADE
);

CREATE TABLE email (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id     INTEGER NOT NULL,
    thread_id      INTEGER NOT NULL,
    parent_id      INTEGER,

    -- NULL = inbound from contact; address string = outgoing from mistflame
    sender         TEXT,
    sent_at        TEXT,
    subject        TEXT,
    body           TEXT    NOT NULL,
    message_id     TEXT,
    recipient      TEXT,
    cc             TEXT,
    FOREIGN KEY (contact_id) REFERENCES contact (id),
    FOREIGN KEY (parent_id) REFERENCES email (id) ON DELETE CASCADE
);

CREATE TABLE attachment (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id       INTEGER NOT NULL,
    file_name      TEXT    NOT NULL,
    content_type   TEXT    NOT NULL,
    r2_key         TEXT    NOT NULL,
    size           INTEGER NOT NULL,
    FOREIGN KEY (email_id) REFERENCES email (id) ON DELETE CASCADE
);
