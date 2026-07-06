import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
try { process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env")); } catch {}

import { listReviews } from "../src/gbp.js";
import { processReview } from "../src/pipeline.js";

const nashikStore = {
  code: "NSK",
  name: "Nashik",
  gbpLocationId: "16429597732094742362",
};

console.log("Fetching reviews...");
const reviews = await listReviews(nashikStore, { pageSize: 10 });
const unanswered = reviews.filter((r) => !r.hasReply);
console.log(`${reviews.length} reviews, ${unanswered.length} without replies\n`);

// Process up to 3 unanswered reviews in dry-run mode
for (const rev of unanswered.slice(0, 3)) {
  console.log(`--- ★${rev.rating} from ${rev.reviewerName} (${rev.createTime?.slice(0,10)}) ---`);
  console.log(`    "${rev.comment?.slice(0, 120)}"`);

  const result = await processReview(rev, nashikStore, { dryRun: true });
  console.log(`    → action: ${result.action}`);
  console.log(`    → language: ${result.analysis.language}`);
  console.log(`    → topics: ${result.analysis.topics?.join(", ")}`);
  console.log(`    → severity: ${result.analysis.severity}`);
  console.log(`    → draft reply: "${result.analysis.reply?.slice(0, 150)}"`);
  console.log();
}
