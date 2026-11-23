/**
 * Runs on every Vercel build (package.json "vercel-build"), before `next build`:
 * applies any new database migrations (prisma/migrations) to the database.
 *
 * - Only ever applies migrations that haven't run yet; already-applied ones are skipped.
 * - If a migration fails, this exits non-zero, the build fails, and the current
 *   live deployment stays untouched.
 * - Neon's pooled connection (host "...-pooler...") can't run migrations, so the
 *   direct host is used for this step only: DIRECT_URL / DATABASE_URL_UNPOOLED if
 *   set, otherwise DATABASE_URL with "-pooler" removed. The URL is never printed.
 */
import { spawnSync } from "node:child_process";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] DATABASE_URL is not set - skipping database migrations.");
  process.exit(0);
}

const direct = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || url.replace(/-pooler\./, ".");
console.log(`[migrate] Applying pending database migrations (${direct === url ? "same connection" : "direct connection"})...`);

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: direct },
  shell: process.platform === "win32",
});
if (result.status !== 0) {
  console.error("[migrate] Database migration failed - stopping the build so the live site is not affected.");
  process.exit(result.status ?? 1);
}
console.log("[migrate] Database is up to date.");
