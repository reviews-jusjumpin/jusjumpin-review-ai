import { gfetch } from "./google-auth.js";
import { ENV } from "./config.js";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export const HEADER = [
  // Auto-populated by system (A–N)
  "Ticket ID", "Created", "Store", "Rating", "Reviewer", "Language", "Topics",
  "Severity", "Summary", "Review text", "Draft reply (edit me)", "Status",
  "Review resource name", "Posted at",
  // Auto-populated (O)
  "Review Date",
  // Manual — filled by CCTV/SOP team (P–S)
  "Client Phone", "Client Response", "Gift Given", "Review Deleted?",
];

// Column letters for fields the system reads/writes
const COL = { reply: "K", status: "L", reviewName: "M", postedAt: "N" };

const sheet = () => `${BASE}/${ENV.spreadsheetId}`;
const range = (a1, sheetName = ENV.sheetName) => `${sheet()}/values/${encodeURIComponent(`${sheetName}!${a1}`)}`;

async function getValues(a1, sheetName = ENV.sheetName) {
  const data = await gfetch(range(a1, sheetName));
  return data.values || [];
}

export async function ensureHeader() {
  const first = await getValues("A1:S1");
  if (first.length === 0) {
    // Empty sheet — write full header
    await gfetch(`${range("A1:S1")}?valueInputOption=RAW`, {
      method: "PUT",
      data: { values: [HEADER] },
    });
  } else if ((first[0] || []).length < HEADER.length) {
    // Existing sheet with old columns — append the new column headers only
    const existingCount = (first[0] || []).length;
    const startCol = String.fromCharCode(65 + existingCount); // e.g. O
    const endCol = String.fromCharCode(65 + HEADER.length - 1); // S
    await gfetch(`${range(`${startCol}1:${endCol}1`)}?valueInputOption=RAW`, {
      method: "PUT",
      data: { values: [HEADER.slice(existingCount)] },
    });
  }
}

/** Append one ticket row. */
export async function appendTicket(t) {
  await ensureHeader();
  await gfetch(`${range("A:S")}:append?valueInputOption=USER_ENTERED`, {
    method: "POST",
    data: {
      values: [[
        t.ticketId, t.created, t.store, t.rating, t.reviewer, t.language,
        t.topics.join(", "), t.severity, t.summary, t.reviewText, t.draftReply,
        "OPEN", t.reviewName, "",
        t.reviewCreateTime || "",  // O: Review Date (from Google)
        "", "", "", "",             // P–S: manual columns (blank)
      ]],
    },
  });
}

/** Review resource names that already have a ticket — the idempotency check. */
export async function ticketedReviewNames() {
  const rows = await getValues(`${COL.reviewName}2:${COL.reviewName}`);
  return new Set(rows.map((r) => r[0]).filter(Boolean));
}

/** reviewId -> ticket summary/status. Keyed on the id, not the full name, so it survives an account-id change. */
export async function ticketsByReviewId() {
  const rows = await getValues("A2:M");
  const map = new Map();
  for (const r of rows) {
    const reviewId = (r[12] || "").split("/").pop();
    if (!reviewId) continue;
    map.set(reviewId, {
      ticketId: r[0] || "",
      severity: r[7] || "",
      summary: r[8] || "",
      status: (r[11] || "OPEN").trim().toUpperCase(),
    });
  }
  return map;
}

/** Rows a manager has set to APPROVED — ready to post. */
export async function approvedDrafts() {
  const rows = await getValues("A2:S");
  const out = [];
  rows.forEach((r, i) => {
    if ((r[11] || "").trim().toUpperCase() === "APPROVED") {
      out.push({
        rowNumber: i + 2,
        ticketId: r[0],
        reply: r[10] || "",
        reviewName: r[12] || "",
      });
    }
  });
  return out.filter((d) => d.reviewName && d.reply.trim());
}

export async function markStatus(rowNumber, status) {
  await gfetch(`${range(`${COL.status}${rowNumber}`)}?valueInputOption=RAW`, {
    method: "PUT",
    data: { values: [[status]] },
  });
}

export async function markPosted(rowNumber) {
  await gfetch(
    `${range(`${COL.status}${rowNumber}:${COL.postedAt}${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", data: { values: [["POSTED", null, new Date().toISOString()]] } }
  );
}

// ── Rating dashboard: snapshot + drop log (separate tabs in the same sheet) ──
const RATING_SHEET = "RatingSnapshot";
const DROP_SHEET = "RatingDrops";
const RATING_HEADER = ["Store Code", "Store Name", "Rating", "Review Count", "Last Checked"];
const DROP_HEADER = ["Detected At", "Store Code", "Store Name", "Old Rating", "New Rating", "Old Review Count", "New Review Count"];

async function sheetTitles() {
  const meta = await gfetch(`${sheet()}?fields=sheets.properties.title`);
  return new Set((meta.sheets || []).map((s) => s.properties.title));
}

async function createSheetTab(title, header) {
  await gfetch(`${sheet()}:batchUpdate`, {
    method: "POST",
    data: { requests: [{ addSheet: { properties: { title } } }] },
  });
  await gfetch(`${range("A1", title)}?valueInputOption=RAW`, {
    method: "PUT",
    data: { values: [header] },
  });
}

let _ratingSheetsReady = false;
async function ensureRatingSheets() {
  if (_ratingSheetsReady) return;
  const titles = await sheetTitles();
  if (!titles.has(RATING_SHEET)) await createSheetTab(RATING_SHEET, RATING_HEADER);
  if (!titles.has(DROP_SHEET)) await createSheetTab(DROP_SHEET, DROP_HEADER);
  _ratingSheetsReady = true;
}

/** Map of store code -> last saved { rowNumber, name, rating, reviewCount, lastChecked }. */
export async function getRatingSnapshots() {
  await ensureRatingSheets();
  const rows = await getValues("A2:E", RATING_SHEET);
  const map = new Map();
  rows.forEach((r, i) => {
    if (!r[0]) return;
    map.set(r[0], {
      rowNumber: i + 2,
      name: r[1],
      rating: r[2] === "" || r[2] == null ? null : parseFloat(r[2]),
      reviewCount: parseInt(r[3], 10) || 0,
      lastChecked: r[4] || "",
    });
  });
  return map;
}

/** Upsert one row per store (by code) with its latest rating snapshot. */
export async function upsertRatingSnapshots(entries) {
  await ensureRatingSheets();
  const existing = await getRatingSnapshots();
  const now = new Date().toISOString();
  const updates = [];
  const appends = [];
  for (const e of entries) {
    if (e.rating == null) continue; // skip failed fetches — don't overwrite a good snapshot with a blank
    const row = [e.code, e.name, e.rating, e.reviewCount, now];
    const prev = existing.get(e.code);
    if (prev) {
      updates.push({ range: `${RATING_SHEET}!A${prev.rowNumber}:E${prev.rowNumber}`, values: [row] });
    } else {
      appends.push(row);
    }
  }
  if (updates.length) {
    await gfetch(`${sheet()}/values:batchUpdate`, {
      method: "POST",
      data: { valueInputOption: "RAW", data: updates },
    });
  }
  if (appends.length) {
    await gfetch(`${range("A:E", RATING_SHEET)}:append?valueInputOption=RAW`, {
      method: "POST",
      data: { values: appends },
    });
  }
}

/** Append rows to the drop log (called only when a store's rating has decreased). */
export async function appendRatingDrops(drops) {
  if (!drops.length) return;
  await ensureRatingSheets();
  await gfetch(`${range("A:G", DROP_SHEET)}:append?valueInputOption=RAW`, {
    method: "POST",
    data: {
      values: drops.map((d) => [d.detectedAt, d.code, d.name, d.oldRating, d.newRating, d.oldReviewCount, d.newReviewCount]),
    },
  });
}

/** Most recent drop-log entries, newest first. */
export async function getRatingDropLog({ limit = 50 } = {}) {
  await ensureRatingSheets();
  const rows = await getValues("A2:G", DROP_SHEET);
  return rows
    .filter((r) => r[0])
    .slice(-limit)
    .reverse()
    .map((r) => ({
      detectedAt: r[0], code: r[1], name: r[2],
      oldRating: parseFloat(r[3]), newRating: parseFloat(r[4]),
      oldReviewCount: parseInt(r[5], 10) || 0, newReviewCount: parseInt(r[6], 10) || 0,
    }));
}

// ── Reviews Google has hidden (spam-filtered): still listed by the API, but replies 404 ──
const HIDDEN_SHEET = "HiddenReviews";
const HIDDEN_HEADER = ["Review resource name", "Store", "Rating", "Review date", "Detected at"];

let _hiddenSheetReady = false;
async function ensureHiddenSheet() {
  if (_hiddenSheetReady) return;
  const titles = await sheetTitles();
  if (!titles.has(HIDDEN_SHEET)) await createSheetTab(HIDDEN_SHEET, HIDDEN_HEADER);
  _hiddenSheetReady = true;
}

export async function hiddenReviewNames() {
  await ensureHiddenSheet();
  const rows = await getValues("A2:A", HIDDEN_SHEET);
  return new Set(rows.map((r) => r[0]).filter(Boolean));
}

export async function appendHiddenReview({ reviewName, store, rating, reviewDate }) {
  await ensureHiddenSheet();
  await gfetch(`${range("A:E", HIDDEN_SHEET)}:append?valueInputOption=RAW`, {
    method: "POST",
    data: { values: [[reviewName, store, rating, reviewDate || "", new Date().toISOString()]] },
  });
}

// ── Settings tab: small key/value store (e.g. manually-set target rating) ──
const SETTINGS_SHEET = "Settings";
const SETTINGS_HEADER = ["Key", "Value"];

async function ensureSettingsSheet() {
  const titles = await sheetTitles();
  if (!titles.has(SETTINGS_SHEET)) await createSheetTab(SETTINGS_SHEET, SETTINGS_HEADER);
}

export async function getSetting(key) {
  await ensureSettingsSheet();
  const rows = await getValues("A2:B", SETTINGS_SHEET);
  const row = rows.find((r) => r[0] === key);
  return row ? row[1] : null;
}

export async function setSetting(key, value) {
  await ensureSettingsSheet();
  const rows = await getValues("A2:B", SETTINGS_SHEET);
  const idx = rows.findIndex((r) => r[0] === key);
  if (idx >= 0) {
    await gfetch(`${range(`B${idx + 2}`, SETTINGS_SHEET)}?valueInputOption=RAW`, {
      method: "PUT",
      data: { values: [[value]] },
    });
  } else {
    await gfetch(`${range("A:B", SETTINGS_SHEET)}:append?valueInputOption=RAW`, {
      method: "POST",
      data: { values: [[key, value]] },
    });
  }
}

export async function getStats() {
  const rows = await getValues("A2:S");
  const stats = { open: 0, approved: 0, posted: 0, total: 0, recent: [] };
  rows.forEach((r) => {
    if (!r[0]) return;
    stats.total++;
    const status = (r[11] || "OPEN").trim().toUpperCase();
    if (status === "POSTED") stats.posted++;
    else if (status === "APPROVED") stats.approved++;
    else if (status !== "HIDDEN BY GOOGLE") stats.open++;
    if (stats.recent.length < 8) {
      stats.recent.push({
        id: r[0], created: r[1], store: r[2], rating: r[3],
        reviewer: r[4], summary: r[8] || "", status,
      });
    }
  });
  return stats;
}
