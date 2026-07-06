import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
try { process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env")); } catch {}

import { listReviews } from "../src/gbp.js";
import { appendTicket } from "../src/sheets.js";

// Nashik store object
const nashikStore = {
  code: "NSK",
  name: "Nashik",
  gbpLocationId: "16429597732094742362",
};

console.log("=== REVIEWS TEST ===");
const reviews = await listReviews(nashikStore, { pageSize: 5 });
console.log(`Got ${reviews.length} reviews\n`);

const r0 = reviews[0];
console.log("Sample review:");
console.log("  name:", r0.name);
console.log("  rating:", r0.rating);
console.log("  reviewer:", r0.reviewerName);
console.log("  comment:", r0.comment?.slice(0, 80));
console.log("  hasReply:", r0.hasReply);

console.log("\n=== SHEETS TEST ===");
if (process.env.DRY_RUN === "1") {
  console.log("DRY_RUN=1 → skipping Sheet write (set DRY_RUN=0 to test)");
} else {
  const row = await appendTicket({
    ticketId: "TEST-001",
    store: nashikStore,
    review: r0,
    draft: "Test draft reply — ignore this row",
  });
  console.log("Appended row:", row);
}
