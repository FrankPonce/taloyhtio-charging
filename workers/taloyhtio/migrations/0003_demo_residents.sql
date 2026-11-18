-- Self-serve demo residents (SIMULATED), so anyone, judges included, can try the arbiter.
-- A demo resident is valid for one night only: expires_at is the end of the night it was
-- issued for. Board residents (kind 'board') never expire.
ALTER TABLE residents ADD COLUMN kind TEXT NOT NULL DEFAULT 'board' CHECK (kind IN ('board', 'demo'));
ALTER TABLE residents ADD COLUMN night TEXT;          -- demo: the night it may request for
ALTER TABLE residents ADD COLUMN expires_at TEXT;     -- demo: ISO time after which the code is refused
CREATE INDEX residents_demo_by_night ON residents (kind, night);
