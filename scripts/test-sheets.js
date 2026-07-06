import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
try { process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env")); } catch {}

import { ensureHeader, appendTicket, ticketedReviewNames } from "../src/sheets.js";

console.log("Ensuring header row...");
await ensureHeader();
console.log("Header OK\n");

console.log("Writing test ticket row...");
await appendTicket({
  ticketId: "JJ-TEST-20260705-AAAA",
  created: new Date().toISOString(),
  store: "Nashik",
  rating: 2,
  reviewer: "Test Reviewer",
  language: "english",
  topics: ["safety", "cleanliness"],
  severity: "high",
  summary: "Guest complained about unclean socks and unhelpful staff.",
  reviewText: "Dirty place, staff was rude. Will not visit again.",
  draftReply: "Dear Test Reviewer, we sincerely apologize for your experience...",
  reviewName: "accounts/116275598253754757177/locations/16429597732094742362/reviews/TEST-ID",
});
console.log("Row written!\n");

console.log("Reading back ticketed names...");
const names = await ticketedReviewNames();
console.log("Ticketed count:", names.size);
console.log("Test row present:", names.has("accounts/116275598253754757177/locations/16429597732094742362/reviews/TEST-ID"));
