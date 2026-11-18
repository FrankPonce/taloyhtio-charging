// Create the SIMULATED residents of As Oy Koivurinne for the demo.
// Codes go to ../.secrets/taloyhtio/resident-codes.json (never committed); the database
// gets only their SHA-256. Writes the SQL to the path given, for:
//   npx wrangler d1 execute taloyhtio-arbiter --remote --file <sql>   (from workers/taloyhtio)
// Refuses to overwrite existing codes.
//
//   node scripts/seed-residents.mjs <out.sql>

import { access, mkdir, writeFile } from "node:fs/promises";
import { sha256Hex } from "agent-trust-kit";

const CODES = "../.secrets/taloyhtio/resident-codes.json";
const FLATS = ["A1", "A4", "B2", "C3"];
const out = process.argv[2];
if (!out) {
  console.error("Usage: node scripts/seed-residents.mjs <out.sql>");
  process.exit(1);
}
if (await access(CODES).then(() => true, () => false)) {
  console.error(`${CODES} already exists. Not overwriting it.`);
  process.exit(1);
}

// Unambiguous characters only (no 0/O, 1/l/I).
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const part = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => ALPHABET[b % ALPHABET.length]).join("");
const residents = FLATS.map((id) => ({ id, code: `koivu-${part()}-${part()}`, label: `Simulated resident ${id}` }));

await mkdir("../.secrets/taloyhtio", { recursive: true });
await writeFile(CODES, `${JSON.stringify({ note: "SIMULATED demo residents. Keep private.", residents }, null, 2)}\n`, { mode: 0o600 });
const now = new Date().toISOString();
const rows = await Promise.all(residents.map(async (r) => `('${r.id}', '${await sha256Hex(r.code)}', '${r.label}', 1, '${now}')`));
await writeFile(out, `INSERT INTO residents (id, code_sha256, label, simulated, created_at) VALUES\n${rows.join(",\n")};\n`);
console.log(`${residents.length} simulated residents: codes in ${CODES}, SQL (hashes only) in ${out}.`);
