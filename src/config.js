import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env if present (no-op on Cloud Run where env vars are injected)
try {
  process.loadEnvFile(join(ROOT, ".env"));
} catch {
  /* no .env file — rely on real environment */
}

const storesFile = JSON.parse(readFileSync(join(ROOT, "config", "stores.json"), "utf8"));

export const STORES = storesFile.stores;
export const ACTIVE_STORES = STORES.filter((s) => s.active);

export function storeByLocationId(locationId) {
  return STORES.find((s) => s.gbpLocationId === String(locationId));
}

export function storeByName(name) {
  const n = String(name || "").trim().toLowerCase();
  return STORES.find((s) => s.name.toLowerCase() === n || s.code.toLowerCase() === n);
}

export const ENV = {
  claudeModel: process.env.CLAUDE_MODEL || "claude-opus-4-8",
  gbpAccountId: process.env.GBP_ACCOUNT_ID,
  spreadsheetId: process.env.TICKET_SPREADSHEET_ID,
  sheetName: process.env.TICKET_SHEET_NAME || "Tickets",
  opsWhatsApp: process.env.OPS_WHATSAPP,
  tasksSecret: process.env.TASKS_SECRET,
  dryRun: process.env.DRY_RUN === "1",
};
