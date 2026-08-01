-- Full-text search over email subjects and bodies.
--
-- Apply locally:
--   npx wrangler d1 execute DB --local --file db/migrations/004-email-fts.sql
-- Apply remotely:
--   npx wrangler d1 execute mistflame-db --remote --file db/migrations/004-email-fts.sql
--
-- Safe to rerun: the table and triggers use IF NOT EXISTS, and 'rebuild'
-- discards the existing index before repopulating it.
--
-- NOTE: `wrangler d1 export` does not support databases containing virtual
-- tables. To take a backup, drop this table, export, then reapply this file:
--   npx wrangler d1 execute <db> --remote --command "DROP TABLE email_fts"
-- Nothing is lost by that: content='email' means the index stores no original
-- text of its own and is rebuilt from the email table.

-- External content: the index points at email rather than duplicating the
-- bodies, which for HTML mail are the largest thing in the database.
-- remove_diacritics 2 so a search for "rene" matches "René".
CREATE VIRTUAL TABLE IF NOT EXISTS email_fts USING fts5(
    subject,
    body,
    content='email',
    content_rowid='id',
    tokenize="unicode61 remove_diacritics 2"
);

-- An external-content index goes stale if a write reaches email without these
-- firing, and a stale index returns wrong rows rather than an error. Every
-- write path is covered: the API routes, the receiver worker, and manual SQL.
CREATE TRIGGER IF NOT EXISTS trg_email_fts_insert AFTER INSERT ON email
BEGIN
    INSERT INTO email_fts (rowid, subject, body)
        VALUES (new.id, new.subject, new.body);
END;

-- The 'delete' command has to be given the values as they were indexed, or the
-- index keeps entries for text that is no longer there; hence old.*, and hence
-- the update trigger deleting before it reinserts.
CREATE TRIGGER IF NOT EXISTS trg_email_fts_delete AFTER DELETE ON email
BEGIN
    INSERT INTO email_fts (email_fts, rowid, subject, body)
        VALUES ('delete', old.id, old.subject, old.body);
END;

CREATE TRIGGER IF NOT EXISTS trg_email_fts_update AFTER UPDATE ON email
BEGIN
    INSERT INTO email_fts (email_fts, rowid, subject, body)
        VALUES ('delete', old.id, old.subject, old.body);
    INSERT INTO email_fts (rowid, subject, body)
        VALUES (new.id, new.subject, new.body);
END;

-- Populate from the existing rows. Also the repair for an index that drifted.
INSERT INTO email_fts (email_fts) VALUES ('rebuild');
