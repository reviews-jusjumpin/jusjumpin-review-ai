import { ACTIVE_STORES, ENV } from "./config.js";
import { analyzeReview } from "./ai.js";
import * as gbp from "./gbp.js";
import * as sheets from "./sheets.js";
import * as whatsapp from "./whatsapp.js";

/** A review needs a human-approved reply (= ticket) instead of an auto-post. */
export function needsTicket(review, analysis) {
  return (
    review.rating <= 3 ||
    analysis.sentiment === "negative" ||
    analysis.severity === "high" ||
    analysis.severity === "critical"
  );
}

export function makeTicketId(store) {
  const d = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `JJ-${store.code}-${d}-${rand}`;
}

/**
 * Process one review end-to-end. Returns an action record (used by the dry
 * run and by logs). Side effects are skipped when dryRun is true.
 */
export async function processReview(review, store, { dryRun = ENV.dryRun, analyze = analyzeReview } = {}) {
  const analysis = await analyze(review);

  if (!needsTicket(review, analysis)) {
    if (!dryRun) await gbp.postReply(review.name, analysis.reply);
    return { action: "auto_reply", review, analysis };
  }

  const ticket = {
    ticketId: makeTicketId(store),
    created: new Date().toISOString(),
    store: store.name,
    rating: review.rating,
    reviewer: review.reviewerName,
    language: analysis.language,
    topics: analysis.topics,
    severity: analysis.severity,
    summary: analysis.summary,
    reviewText: review.comment,
    draftReply: analysis.reply,
    reviewName: review.name,
  };

  if (!dryRun) {
    await sheets.appendTicket(ticket);
    await whatsapp.alertTicket(store, ticket);
  }
  return { action: "ticket", review, analysis, ticket };
}

// Gemini free tier = 5 req/min → pace to 1 per 13 s to stay safely under limit
const GEMINI_PACE_MS = 13_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reconciliation poll: sweep recent reviews on every active store, process
 * anything that has no owner reply yet and no existing ticket. Safe to run
 * on any schedule — both checks make it idempotent.
 */
export async function pollAllStores({ dryRun = ENV.dryRun } = {}) {
  const ticketed = await sheets.ticketedReviewNames();
  const results = [];
  let callCount = 0;
  for (const store of ACTIVE_STORES) {
    if (!store.gbpLocationId) continue;
    const reviews = await gbp.listReviews(store);
    for (const review of reviews) {
      if (review.hasReply || ticketed.has(review.name)) continue;
      if (callCount > 0) await sleep(GEMINI_PACE_MS);
      callCount++;
      try {
        const result = await processReview(review, store, { dryRun });
        console.log(`poll [${store.code}] #${callCount}: ${result.action} (${review.rating}★)`);
        results.push(result);
      } catch (err) {
        console.error(`poll error [${store.code}] ${review.reviewId}: ${err}`);
        results.push({ action: "error", review, error: String(err) });
      }
    }
  }
  return results;
}

/** Post manager-approved drafts from the ticket sheet back to Google. */
export async function postApprovedReplies({ dryRun = ENV.dryRun } = {}) {
  const drafts = await sheets.approvedDrafts();
  const results = [];
  for (const d of drafts) {
    try {
      if (!dryRun) {
        await gbp.postReply(d.reviewName, d.reply);
        await sheets.markPosted(d.rowNumber);
      }
      results.push({ action: "posted", ticketId: d.ticketId });
    } catch (err) {
      results.push({ action: "error", ticketId: d.ticketId, error: String(err) });
    }
  }
  return results;
}
