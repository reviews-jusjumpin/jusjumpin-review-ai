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
const range = (a1) => `${sheet()}/values/${encodeURIComponent(`${ENV.sheetName}!${a1}`)}`;

async function getValues(a1) {
  const data = await gfetch(range(a1));
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

export async function markPosted(rowNumber) {
  await gfetch(
    `${range(`${COL.status}${rowNumber}:${COL.postedAt}${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", data: { values: [["POSTED", null, new Date().toISOString()]] } }
  );
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
    else stats.open++;
    if (stats.recent.length < 8) {
      stats.recent.push({
        id: r[0], created: r[1], store: r[2], rating: r[3],
        reviewer: r[4], summary: r[8] || "", status,
      });
    }
  });
  return stats;
}
