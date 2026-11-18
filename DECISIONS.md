# Decisions

One line per decision: date, decision, reason. See ../DECISIONS.md for project-wide decisions.

- 2026-11-18 · Arbiter scheduler (`src/arbiter/scheduler.js`, rule `koivurinne-fair-share/1`) works in integer W and Wh, so the shared limit holds exactly; floats only for prices and euros.
- 2026-11-18 · An infeasible request gets everything still free in its window and a reported shortfall; nothing is taken back from requests planned earlier (EDF order is the published rule).
- 2026-11-18 · Two different prices for one slot are refused rather than picking one, since either choice would depend on input order.
- 2026-11-18 · Commitment = SHA-256 of the sealed request plus a 128-bit server nonce, so the tie-break order can't be chosen by the resident.
- 2026-11-18 · Receipts and scheduled nights are append-only in D1 (triggers refuse UPDATE/DELETE); a receipt names only its own request.
- 2026-11-18 · Arbiter served as MCP at POST /mcp on the housing Worker (own entry `workers/taloyhtio/src/index.js`; Charge's shared Worker code untouched). Tools: get_rules, submit_charging_request, get_receipt, get_night_load. No CORS: same-origin page and servers only; cross-site callers come through their server with RFC 9421 (M5b).
- 2026-11-18 · A night is scheduled lazily by the first receipt lookup after 18:00, once, in one atomic D1 batch (night + all signed receipts); a resident can read only their own receipt, and "not yours" looks the same as "no such request".
- 2026-11-18 · Receipts get their own signing key (secret RECEIPT_SIGNING_JWK), separate from the network-signing key that stays offline; its public part goes in the same key directory.
- 2026-11-18 · `nodejs_compat` on the housing Worker: agent-trust-kit's RFC 9421 library needs Node's crypto, and the M5b admission check uses it.
