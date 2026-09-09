import { gfetch } from "./google-auth.js";
import { ACTIVE_STORES, ENV } from "./config.js";
import { getRatingSnapshots, upsertRatingSnapshots, appendRatingDrops } from "./sheets.js";

const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";

/**
 * How many additional 5★ reviews (with everything else unchanged) would push
 * the average from `rating` up to `target`. Derived from
 *   (rating*count + 5*x) / (count + x) >= target  =>  x >= count*(target-rating) / (5-target)
 * Returns 0 if already at/above target, null if unratable (target is 5.0 and
 * rating isn't — no finite number of 5★ adds can move a mixed average to a
 * perfect 5.0).
 */
function fiveStarsNeeded(rating, reviewCount, target) {
  if (rating == null) return null;
  if (rating >= target) return 0;
  if (target >= 5) return null;
  const needed = (reviewCount * (target - rating)) / (5 - target);
  return Math.max(0, Math.ceil(needed - 1e-9)); // tiny epsilon guards against float rounding pushing the ceil up by 1
}

/** pageSize=1 is enough — averageRating/totalReviewCount summarize the whole location. */
async function fetchStoreRating(store, target) {
  const data = await gfetch(
    `${REVIEWS_BASE}/accounts/${store.gbpAccountId || ENV.gbpAccountId}/locations/${store.gbpLocationId}/reviews?pageSize=1`
  );
  const rating = typeof data.averageRating === "number" ? data.averageRating : null;
  const reviewCount = data.totalReviewCount ?? 0;
  return {
    code: store.code,
    name: store.name,
    state: store.state,
    rating,
    reviewCount,
    target,
    meetsTarget: rating == null ? null : rating >= target,
    fiveStarsNeeded: fiveStarsNeeded(rating, reviewCount, target),
  };
}

/**
 * Live rating + review count for every active, GBP-linked store (limited concurrency).
 * `target` defaults to ENV.targetRating (e.g. 4.8) and can be overridden per store via
 * stores.json `targetRating`, or for this call only via the `target` option.
 */
export async function fetchLiveRatings({ concurrency = 5, target } = {}) {
  const stores = ACTIVE_STORES.filter((s) => s.gbpLocationId);
  const results = [];
  let i = 0;
  async function worker() {
    while (i < stores.length) {
      const store = stores[i++];
      const storeTarget = target ?? store.targetRating ?? ENV.targetRating;
      try {
        results.push(await fetchStoreRating(store, storeTarget));
      } catch (err) {
        results.push({ code: store.code, name: store.name, state: store.state, rating: null, reviewCount: 0, target: storeTarget, meetsTarget: null, fiveStarsNeeded: null, error: String(err) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, stores.length) }, worker));
  return results.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Fetch live ratings, compare against the last saved snapshot per store, log
 * any drop to the RatingDrops sheet, then overwrite the snapshot. Meant to
 * run on a schedule (see POST /tasks/ratings).
 */
export async function checkForDrops() {
  const live = await fetchLiveRatings();
  const snapshots = await getRatingSnapshots();
  const now = new Date().toISOString();
  const drops = [];

  for (const s of live) {
    if (s.rating == null) continue;
    const prev = snapshots.get(s.code);
    if (prev && prev.rating != null && s.rating < prev.rating - 0.001) {
      drops.push({
        detectedAt: now,
        code: s.code,
        name: s.name,
        oldRating: prev.rating,
        newRating: s.rating,
        oldReviewCount: prev.reviewCount,
        newReviewCount: s.reviewCount,
      });
    }
  }

  await upsertRatingSnapshots(live);
  if (drops.length) await appendRatingDrops(drops);
  return { ratings: live, drops };
}
