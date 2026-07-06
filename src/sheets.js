import { gfetch } from "./google-auth.js";
import { ENV } from "./config.js";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export const HEADER = [
  "Ticket ID", "Created", "Store", "Rating", "Reviewer", "Language", "Topics",
  "Severity", "Summary", "Review text", "Draft reply (edit me)", "Status",
  "Review resource name", "Posted at",
];

// Column letters for the fields the workers read/write
const COL = { reply: "K", status: "L", reviewName: "M", postedAt: "N" };

const sheet = () => `${BASE}/${ENV.spreadsheetId}`;
const range = (a1) => `${sheet()}/values/${encodeURIComponent(`${ENV.sheetName}!${a1}`)}`;

async function getValues(a1) {
  const data = await gfetch(range(a1));
  return data.values || [];
}

export async function ensureHeader() {
  const first = await getValues("A1:N1");
  if (first.length === 0) {
    await gfetch(`${range("A1:N1")}?valueInputOption=RAW`, {
      method: "PUT",
      data: { values: [HEADER] },
    });
  }
}

/** Append one ticket row. ticket fields mirror HEADER order. */
export async function appendTicket(t) {
  await ensureHeader();
  await gfetch(`${range("A:N")}:append?valueInputOption=USER_ENTERED`, {
    method: "POST",
    data: {
      values: [[
        t.ticketId, t.created, t.store, t.rating, t.reviewer, t.language,
        t.topics.join(", "), t.severity, t.summary, t.reviewText, t.draftReply,
        "OPEN", t.reviewName, "",
      ]],
    },
  });
}

/** Review resource names that already have a ticket — the idempotency check. */
export async function ticketedReviewNames() {
  const rows = await getValues(`${COL.reviewName}2:${COL.reviewName}`);
  return new Set(rows.map((r) => r[0]).filter(Boolean));
}

/** Rows a manager has set to APPROVED — ready to post. */
export async function approvedDrafts() {
  const rows = await getValues("A2:N");
  const out = [];
  rows.forEach((r, i) => {
    if ((r[11] || "").trim().toUpperCase() === "APPROVED") {
      out.push({
        rowNumber: i + 2, // 1-based, +1 for header
        ticketId: r[0],
        reply: r[10] || "",
        reviewName: r[12] || "",
      });
    }
  });
  return out.filter((d) => d.reviewName && d.reply.trim());
}

export async function markPosted(rowNumber) {
  // null skips the cell in between (M, the review resource name) — it must stay intact
  await gfetch(
    `${range(`${COL.status}${rowNumber}:${COL.postedAt}${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", data: { values: [["POSTED", null, new Date().toISOString()]] } }
  );
}
