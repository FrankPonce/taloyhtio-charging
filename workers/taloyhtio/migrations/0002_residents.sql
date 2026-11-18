-- Residents who may send night-slot requests. SIMULATED for the demo: As Oy Koivurinne is
-- fictional. Only a SHA-256 of each resident's code is stored; the codes themselves are
-- handed out by the board (for the demo: kept in .secrets/, never committed).
CREATE TABLE residents (
  id          TEXT PRIMARY KEY,              -- e.g. "B12" (flat), shown only to its resident
  code_sha256 TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,                 -- e.g. "Simulated resident B12"
  simulated   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
