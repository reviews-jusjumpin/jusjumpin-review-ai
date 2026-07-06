import { gfetch } from "./google-auth.js";
import { ENV } from "./config.js";

// GBP split APIs: location info + account mgmt migrated to new domains;
// reviews/replies are still on the approved "Google My Business API (Private)" v4.
const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";
const INFO_BASE    = "https://mybusinessbusinessinformation.googleapis.com/v1";
const ACCT_BASE    = "https://mybusinessaccountmanagement.googleapis.com/v1";

const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** List GBP accounts visible to the authorized user (used during setup). */
export function listAccounts() {
  return gfetch(`${ACCT_BASE}/accounts`);
}

/** List locations under the account (used during setup to fill gbpLocationId). */
export function listLocations(accountId = ENV.gbpAccountId) {
  return gfetch(
    `${INFO_BASE}/accounts/${accountId}/locations?readMask=name,title,storefrontAddress&pageSize=100`
  );
}

/** Normalize a GBP review resource into the shape the pipeline uses. */
export function normalizeReview(raw, store) {
  return {
    name:         raw.name,   // accounts/{a}/locations/{l}/reviews/{r}
    reviewId:     raw.reviewId,
    rating:       STARS[raw.starRating] ?? 0,
    comment:      raw.comment || "",
    reviewerName: raw.reviewer?.displayName || "",
    createTime:   raw.createTime,
    updateTime:   raw.updateTime,
    hasReply:     Boolean(raw.reviewReply),
    storeName:    store?.name || "",
    storeCode:    store?.code || "",
  };
}

/** Fetch recent reviews for one location (newest first). */
export async function listReviews(store, { pageSize = 50 } = {}) {
  const data = await gfetch(
    `${REVIEWS_BASE}/accounts/${ENV.gbpAccountId}/locations/${store.gbpLocationId}/reviews?pageSize=${pageSize}`
  );
  return (data.reviews || []).map((r) => normalizeReview(r, store));
}

/** Fetch a single review by its full resource name (from a Pub/Sub notification). */
export async function getReview(reviewName, store) {
  // reviewName is already the full path: accounts/{a}/locations/{l}/reviews/{r}
  const raw = await gfetch(`${REVIEWS_BASE}/${reviewName}`);
  return normalizeReview(raw, store);
}

/** Post (or overwrite) the owner reply on a review. */
export function postReply(reviewName, comment) {
  // reviewName: accounts/{a}/locations/{l}/reviews/{r}
  return gfetch(`${REVIEWS_BASE}/${reviewName}/reply`, {
    method: "PUT",
    data: { comment },
  });
}
