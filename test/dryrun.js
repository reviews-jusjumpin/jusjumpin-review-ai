/**
 * Dry run: pushes the mock reviews through the full pipeline with all side
 * effects disabled. With ANTHROPIC_API_KEY set you see real Claude replies;
 * without it, a rating-based heuristic shows the routing only.
 *
 *   npm run dryrun
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { storeByName } from "../src/config.js";
import { analyzeReview, analyzeReviewHeuristic } from "../src/ai.js";
import { processReview } from "../src/pipeline.js";

const here = dirname(fileURLToPath(import.meta.url));
const reviews = JSON.parse(readFileSync(join(here, "mock-reviews.json"), "utf8"));

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const analyze = hasKey ? analyzeReview : async (r) => analyzeReviewHeuristic(r);

console.log("═".repeat(78));
console.log("  JUS JUMPIN REVIEW-AI — DRY RUN");
console.log(hasKey
  ? "  Mode: LIVE CLAUDE (replies below are real model output)"
  : "  Mode: HEURISTIC FALLBACK — set ANTHROPIC_API_KEY to see real AI replies");
console.log("═".repeat(78));

let tickets = 0, autos = 0;

for (const review of reviews) {
  const store = storeByName(review.storeName) || { name: review.storeName, code: review.storeCode };
  const result = await processReview({ ...review, hasReply: false }, store, { dryRun: true, analyze });
  const a = result.analysis;

  console.log(`\n${"─".repeat(78)}`);
  console.log(`${review.rating}★  ${review.storeName}  —  ${review.reviewerName || "(anonymous)"}`);
  if (review.comment) console.log(`"${review.comment.slice(0, 140)}${review.comment.length > 140 ? "…" : ""}"`);
  console.log(`   sentiment=${a.sentiment}  severity=${a.severity}  lang=${a.language}  topics=${a.topics.join(",")}`);

  if (result.action === "auto_reply") {
    autos++;
    console.log(`   ✅ AUTO-REPLY (would post immediately):`);
  } else {
    tickets++;
    console.log(`   🎫 TICKET ${result.ticket.ticketId}  →  Sheet row + WhatsApp to ${store.name} manager + ops`);
    console.log(`   📋 ${a.summary}`);
    console.log(`   ✍️  DRAFT REPLY (posts only after manager sets Status=APPROVED):`);
  }
  console.log(`      ${a.reply.split("\n").join("\n      ")}`);
}

console.log(`\n${"═".repeat(78)}`);
console.log(`  ${autos} auto-replies, ${tickets} tickets — no live calls were made.`);
console.log("═".repeat(78));
