# Decisions

One line per decision: date, decision, reason. See ../DECISIONS.md for project-wide decisions.

- 2026-11-18 · Arbiter scheduler (`src/arbiter/scheduler.js`, rule `koivurinne-fair-share/1`) works in integer W and Wh, so the shared limit holds exactly; floats only for prices and euros.
- 2026-11-18 · An infeasible request gets everything still free in its window and a reported shortfall; nothing is taken back from requests planned earlier (EDF order is the published rule).
- 2026-11-18 · Two different prices for one slot are refused rather than picking one, since either choice would depend on input order.
- 2026-11-18 · Commitment = SHA-256 of the sealed request plus a 128-bit server nonce, so the tie-break order can't be chosen by the resident.
- 2026-11-18 · Receipts and scheduled nights are append-only in D1 (triggers refuse UPDATE/DELETE); a receipt names only its own request.
