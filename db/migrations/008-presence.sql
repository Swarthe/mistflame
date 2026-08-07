-- Session presence, one row per active session token (hashed). Refreshed from
-- the /api/revision poll so the header can say when another session is using
-- the app at the same time.
--
-- Apply locally:
--   npx wrangler d1 execute DB --local --file db/migrations/008-presence.sql
-- Apply remotely:
--   npx wrangler d1 execute mistflame-db --remote --file db/migrations/008-presence.sql
--
-- CREATE TABLE IF NOT EXISTS makes this file safe to rerun.
--
-- Deliberately NO revision triggers on this table: presence rows are written
-- by the poll itself, so bumping the revision here would make every poll read
-- as a data change and force a full refetch on every tick.
CREATE TABLE IF NOT EXISTS presence (
    token_hash TEXT    PRIMARY KEY, -- SHA-256 of the session token, never the token itself
    last_seen  INTEGER NOT NULL     -- unix seconds
);
