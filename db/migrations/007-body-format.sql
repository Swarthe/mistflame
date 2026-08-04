-- Composing format for outgoing email: 'text' (default) or 'markdown'.
-- A markdown draft keeps its source in body (which stays the canonical
-- plain-text rendition and goes out as the text/plain part); the HTML
-- rendition is generated at send time and for display, never stored.
-- Inbound rows are always 'text': the receiver does not set this column,
-- and inbound formatting lives in body_html.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so rerunning this file errors
-- rather than doing nothing; check with PRAGMA table_info(email) first.

ALTER TABLE email ADD COLUMN body_format TEXT NOT NULL DEFAULT 'text';
