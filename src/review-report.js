import { gfetch } from "./google-auth.js";
import { ACTIVE_STORES, ENV } from "./config.js";
import { ticketsByReviewId } from "./sheets.js";
import { istDate } from "./digest.js";

const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const CACHE_TTL_MS = 20 * 60 * 1000;
const MAX_PAGES_PER_STORE = 200;
const CONCURRENCY = 4; // GBP allows ~300 requests/min, shared with the hourly poll
export const MAX_DAYS_BACK = 400;

export const TOPIC_LABELS = {
  staff_behavior: "Staff behaviour",
  safety_injury: "Safety / injury",
  cleanliness_hygiene: "Cleanliness & hygiene",
  billing_refund: "Billing & refund",
  crowding_queue: "Crowding & queues",
  equipment_rides: "Equipment & rides",
  food_beverage: "Food & beverage",
  pricing_value: "Pricing & value",
  booking_membership: "Booking & membership",
  birthday_party: "Birthday party",
  socks_entry_policy: "Socks / entry policy",
  room_quality: "Room quality",
  check_in_out: "Check-in / check-out",
  amenities: "Amenities",
  heritage_experience: "Heritage experience",
  other: "Other / no detail",
  uncategorised: "Not categorised",
};
const LEGACY_TOPICS = { safety: "safety_injury", cleanliness: "cleanliness_hygiene" };

const cache = new Map(); // store code -> { fetchedAt, backTo, reviews }

async function fetchWithRetry(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await gfetch(url);
    } catch (err) {
      const status = err?.response?.status;
      const networkBlip = status === undefined; // ECONNRESET, DNS hiccup, timeout
      if (attempt >= 3 || !(networkBlip || [429, 500, 503].includes(status))) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

/** All ≤3★ reviews at one store created on/after `backTo` (ms). Cached for CACHE_TTL_MS. */
async function storeNegatives(store, backTo) {
  const hit = cache.get(store.code);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS && hit.backTo <= backTo) return hit.reviews;

  const reviews = [];
  let pageToken;
  for (let page = 0; page < MAX_PAGES_PER_STORE; page++) {
    const data = await fetchWithRetry(
      `${REVIEWS_BASE}/accounts/${store.gbpAccountId || ENV.gbpAccountId}/locations/${store.gbpLocationId}/reviews?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ""}`
    );
    const batch = data.reviews || [];
    for (const r of batch) {
      const rating = STARS[r.starRating] ?? 5;
      if (rating > 3 || Date.parse(r.createTime) < backTo) continue;
      reviews.push({
        id: r.reviewId,
        store: store.name,
        code: store.code,
        rating,
        createTime: r.createTime,
        day: istDate(Date.parse(r.createTime)),
        reviewer: r.reviewer?.displayName || "Anonymous",
        text: (r.comment || "").replace(/\s+/g, " ").trim().slice(0, 400),
        replied: Boolean(r.reviewReply),
      });
    }
    pageToken = data.nextPageToken;
    const oldestUpdate = batch.length ? Date.parse(batch[batch.length - 1].updateTime) : 0;
    if (!pageToken || oldestUpdate < backTo) break; // list is newest-updated first
  }
  cache.set(store.code, { fetchedAt: Date.now(), backTo, reviews });
  return reviews;
}

const normaliseTopics = (ticket) => {
  if (!ticket) return ["uncategorised"];
  const topics = [...new Set(ticket.topics.map((t) => LEGACY_TOPICS[t] || t))];
  return topics.length ? topics : ["other"];
};

/** Negative reviews for the current and previous period (inclusive IST dates), with AI categories joined from the ticket sheet. */
export async function negativeReviewReport({ from, to, pfrom, pto }) {
  const backTo = Date.parse(`${pfrom < from ? pfrom : from}T00:00:00+05:30`);
  const stores = ACTIVE_STORES.filter((s) => s.gbpLocationId);
  const all = [];
  const failedStores = [];
  let next = 0;
  async function worker() {
    while (next < stores.length) {
      const store = stores[next++];
      try {
        all.push(...(await storeNegatives(store, backTo)));
      } catch (err) {
        failedStores.push(store.name);
        console.error(`review-report: fetch failed [${store.code}]: ${err}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failedStores.length === stores.length) {
    throw new Error("Couldn't reach Google for any store. Try again in a minute.");
  }

  let tickets = new Map();
  try {
    tickets = await ticketsByReviewId();
  } catch (err) {
    console.error("review-report: ticket lookup failed:", err);
  }

  const reviews = [];
  for (const r of all) {
    const period = r.day >= from && r.day <= to ? "cur" : r.day >= pfrom && r.day <= pto ? "prev" : null;
    if (!period) continue;
    const t = tickets.get(r.id);
    reviews.push({
      ...r,
      text: period === "cur" ? r.text : "",
      period,
      topics: normaliseTopics(t),
      summary: period === "cur" ? t?.summary || "" : "",
      severity: t?.severity || "",
      ticketStatus: t?.status || "",
    });
  }
  reviews.sort((a, b) => Date.parse(b.createTime) - Date.parse(a.createTime));
  return { labels: TOPIC_LABELS, cur: { from, to }, prev: { from: pfrom, to: pto }, storeCount: stores.length, failedStores, reviews };
}
