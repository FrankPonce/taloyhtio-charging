// A small D1-compatible database over node:sqlite, so the arbiter SQL runs in tests (copied from crash-test).
// Covers what the Worker uses: prepare().bind().first()/all()/run(), batch() (in one
// transaction, like D1) and exec(). Results come back as plain objects, like D1's.
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";

class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new Statement(this.db, this.sql, args);
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.args);
    if (!row) return null;
    const plain = { ...row };
    return column ? plain[column] : plain;
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r }));
    return { success: true, results, meta: {} };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

export class D1Sqlite {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }

  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const out = [];
      for (const s of statements) out.push(await s.run());
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql) {
    this.db.exec(sql);
  }
}

/** A fresh database with every arbiter migration (workers/taloyhtio/migrations) applied, in order. */
export async function migratedDb() {
  const db = new D1Sqlite();
  const dir = new URL("../workers/taloyhtio/migrations/", import.meta.url);
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(f, dir), "utf8"));
  }
  return db;
}
