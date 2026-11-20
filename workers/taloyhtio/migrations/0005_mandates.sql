-- The resident's mandate: the limits within which another site's assistant may send a
-- request for them. Set only on the housing company's own page, with the resident code; an
-- agent can't set or widen it. A request from another site is refused without one, or when
-- it asks for more. Requests the resident sends on this page need none (they are the
-- resident's own act).
CREATE TABLE mandates (
  resident         TEXT PRIMARY KEY,
  max_energy_kwh   REAL NOT NULL,
  max_price_cents  REAL,                -- spot-price limit, c/kWh incl. VAT; NULL = none
  set_at           TEXT NOT NULL
);

-- What admitted a cross-site request, so its receipt can say so: the caller's origin, the
-- model it declared, and the digest of the admission policy that was applied.
ALTER TABLE requests ADD COLUMN caller_origin TEXT;
ALTER TABLE requests ADD COLUMN caller_model TEXT;
ALTER TABLE requests ADD COLUMN caller_policy_sha256 TEXT;
