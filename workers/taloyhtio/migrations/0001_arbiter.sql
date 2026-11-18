-- Arbiter database (D1) for As Oy Koivurinne's shared chargers (SIMULATED housing company).
-- M5a. Database created 18 Nov 2026 in WEUR (binding ARBITER_DB in wrangler.jsonc).
-- Apply from workers/taloyhtio: npx wrangler d1 migrations apply taloyhtio-arbiter --remote
--
-- requests:  one row per sealed request. Only the arbiter reads energy and ready-by times;
--            residents see their own result, everyone else sees only the total load.
-- receipts:  append-only. A night is scheduled once, after the 18:00 deadline; each request
--            gets one signed receipt (compact JWS). Rows can't be changed or removed.
-- admissions: why each submission was accepted or refused (signature, attestation,
--            resident token), for the health page and for disputes.

CREATE TABLE requests (
  id            TEXT PRIMARY KEY,               -- opaque, random; what agents see
  night         TEXT NOT NULL,                  -- YYYY-MM-DD, the evening the night starts
  resident      TEXT NOT NULL,                  -- resident ID from the invite token
  energy_kwh    REAL NOT NULL,
  charger_kw    REAL NOT NULL,
  from_ms       INTEGER NOT NULL,
  ready_by_ms   INTEGER NOT NULL,
  nonce         TEXT NOT NULL,                  -- server nonce in the commitment
  commitment    TEXT NOT NULL UNIQUE,           -- SHA-256, returned at once
  caller_network_sha256 TEXT,                   -- network hash from the admission check
  created_at    TEXT NOT NULL,
  UNIQUE (night, resident)                      -- one request per resident per night
);

CREATE INDEX requests_by_night ON requests (night);

CREATE TABLE nights (
  night                  TEXT PRIMARY KEY,
  rule_version           TEXT NOT NULL,
  limit_kw               REAL NOT NULL,
  fee_cents_per_kwh      REAL NOT NULL,
  prices_snapshot_sha256 TEXT NOT NULL,
  prices_json            TEXT NOT NULL,         -- the exact slots used, for re-checking
  load_json              TEXT NOT NULL,         -- total kW per slot, no resident data
  scheduled_at           TEXT NOT NULL
);

CREATE TABLE receipts (
  request_id  TEXT PRIMARY KEY REFERENCES requests (id),
  night       TEXT NOT NULL REFERENCES nights (night),
  jws         TEXT NOT NULL,
  issued_at   TEXT NOT NULL
);

CREATE TRIGGER receipts_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'receipts are append-only'); END;
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT, 'receipts are append-only'); END;
CREATE TRIGGER nights_no_update BEFORE UPDATE ON nights BEGIN SELECT RAISE(ABORT, 'a scheduled night is final'); END;
CREATE TRIGGER nights_no_delete BEFORE DELETE ON nights BEGIN SELECT RAISE(ABORT, 'a scheduled night is final'); END;

CREATE TABLE admissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL,
  caller_origin TEXT,
  caller_network_url    TEXT,
  caller_network_sha256 TEXT,
  outcome       TEXT NOT NULL CHECK (outcome IN ('admitted', 'refused')),
  reason        TEXT NOT NULL                   -- e.g. 'no valid request signature', 'no fresh attestation'
);

CREATE INDEX admissions_by_time ON admissions (at);
