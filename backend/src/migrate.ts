// Tiny migration runner: applies every db/migrations/*.sql file, in
// filename order, against DATABASE_URL. Every migration statement uses
// IF NOT EXISTS, so this is safe to re-run (no migrations-ledger table
// needed at this scale).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../db/migrations");

async function main() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log(`No .sql migrations found in ${migrationsDir}`);
    return;
  }

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = readFileSync(fullPath, "utf8");
    console.log(`Applying ${file}...`);
    await pool.query(sql);
  }

  console.log("Migrations complete.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
