// One-time backlog clear: replies to unreplied reviews OLDER than the newest
// ~50 that the hourly poller already covers. Dry run unless --live.
//   node --env-file=.env scripts/reply-backlog.js M5,UDR --live
//   node --env-file=.env scripts/reply-backlog.js CC2,GIP --since=2026-04-08 --max=800 --live
import { ACTIVE_STORES, ENV } from "../src/config.js";
import { gfetch } from "../src/google-auth.js";
import { normalizeReview } from "../src/gbp.js";
import { processReview } from "../src/pipeline.js";
import { ensureHeader, ticketedReviewNames, hiddenReviewNames } from "../src/sheets.js";

const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";
const args = process.argv.slice(2);
const argVal = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const SKIP_NEWEST = 60; // the poller only reads page 1 (newest 50) — stay clear of it so the two never race
const MAX = parseInt(argVal("max") || process.env.MAX_REVIEWS || "500", 10); // Gemini free tier is 1000/day, shared with the poller
const SINCE = argVal("since") || ""; // YYYY-MM-DD: only reviews posted on/after this date
const LIMIT_PER_STORE = parseInt(process.env.LIMIT_PER_STORE || "0", 10) || Infinity;
const PACE_MS = 5000;
const live = args.includes("--live") || process.env.LIVE === "1";
const storeArg = args.find((a) => !a.startsWith("--")) || process.env.STORE_FILTER || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await gfetch(url);
    } catch (err) {
      if (i >= attempts) throw err;
      await sleep(2000 * i); // GBP throws occasional 503s mid-pagination on big listings
    }
  }
}

async function allReviews(store) {
  const out = [];
  let pageToken;
  do {
    const data = await fetchWithRetry(
      `${REVIEWS_BASE}/accounts/${store.gbpAccountId || ENV.gbpAccountId}/locations/${store.gbpLocationId}/reviews?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ""}`
    );
    out.push(...(data.reviews || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

async function main() {
  const codes = storeArg.split(",").map((s) => s.trim()).filter(Boolean);
  if (!codes.length) throw new Error("Pass store codes, e.g. node --env-file=.env scripts/reply-backlog.js M5,UDR --live");
  const stores = ACTIVE_STORES.filter((s) => s.gbpLocationId && codes.includes(s.code));
  if (SINCE && !/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) throw new Error(`--since must be YYYY-MM-DD, got "${SINCE}"`);
  console.log(`${live ? "LIVE — replies WILL be posted" : "DRY RUN — nothing posted (add --live)"} · stores: ${stores.map((s) => s.code).join(", ")} · cap ${MAX}${SINCE ? ` · since ${SINCE}` : ""}`);

  if (live) await ensureHeader();
  const ticketed = await ticketedReviewNames();
  const hidden = await hiddenReviewNames();
  let done = 0;
  const tally = { auto_reply: 0, ticket: 0, hidden: 0, error: 0 };

  for (const store of stores) {
    const raw = await allReviews(store);
    const backlog = raw
      .slice(SKIP_NEWEST)
      .filter((r) => !r.reviewReply && !ticketed.has(r.name) && !hidden.has(r.name) && (!SINCE || r.createTime >= SINCE));
    const todo = backlog.slice(0, LIMIT_PER_STORE);
    console.log(`[${store.code}] ${raw.length} reviews · ${backlog.length} unreplied beyond newest ${SKIP_NEWEST} · processing ${Math.min(todo.length, MAX - done)}`);

    for (const r of todo) {
      if (done >= MAX) break;
      const review = normalizeReview(r, store);
      let attempt = 0;
      while (true) {
        try {
          const result = await processReview(review, store, { dryRun: !live });
          tally[result.action]++;
          done++;
          const preview = live ? "" : `\n    reply: ${result.analysis.reply.replace(/\s+/g, " ").slice(0, 220)}`;
          console.log(`  #${done} ${result.action} (${review.rating}★, ${review.createTime.slice(0, 10)})${preview}`);
          break;
        } catch (err) {
          const msg = String(err);
          if (/per day|PerDay|daily/i.test(msg)) {
            console.log(`  Gemini DAILY quota reached — stopping. Re-run tomorrow to continue.`);
            return summary();
          }
          if (/429|RESOURCE_EXHAUSTED/i.test(msg) && attempt++ < 3) {
            await sleep(60_000);
            continue;
          }
          tally.error++;
          console.log(`  error on ${review.reviewId}: ${msg.slice(0, 200)}`);
          break;
        }
      }
      await sleep(PACE_MS);
    }
  }
  summary();

  function summary() {
    console.log(`\nDone. ${done} processed — auto-replied ${tally.auto_reply}, tickets ${tally.ticket}, hidden by Google ${tally.hidden}, errors ${tally.error}${live ? "" : " (dry run)"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
