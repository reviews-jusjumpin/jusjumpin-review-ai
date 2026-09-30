import { writeFileSync } from "node:fs";
import { gfetch } from "../src/google-auth.js";
import { ACTIVE_STORES, ENV } from "../src/config.js";

const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const NEGATIVE_THRESHOLD = 3; // rating <= 3 counts as negative for this report

async function fetchWithRetry(url, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await gfetch(url);
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function fetchAllReviews(store) {
  const all = [];
  let pageToken;
  do {
    const url = new URL(
      `${REVIEWS_BASE}/accounts/${store.gbpAccountId || ENV.gbpAccountId}/locations/${store.gbpLocationId}/reviews`
    );
    url.searchParams.set("pageSize", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await fetchWithRetry(url.toString());
    all.push(...(data.reviews || []));
    pageToken = data.nextPageToken;
    if (pageToken) await new Promise((r) => setTimeout(r, 300)); // gentle pacing
  } while (pageToken);
  return all;
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const filterCode = process.env.STORE_FILTER;
  let stores = ACTIVE_STORES.filter((s) => s.gbpLocationId);
  if (filterCode) stores = stores.filter((s) => filterCode.split(",").includes(s.code));
  const rows = [];
  let storeCount = 0;

  for (const store of stores) {
    storeCount++;
    process.stderr.write(`[${storeCount}/${stores.length}] ${store.code} (${store.name})... `);
    let reviews;
    try {
      reviews = await fetchAllReviews(store);
    } catch (err) {
      process.stderr.write(`ERROR: ${err}\n`);
      continue;
    }
    const negative = reviews.filter((r) => (STARS[r.starRating] ?? 5) <= NEGATIVE_THRESHOLD);
    process.stderr.write(`${reviews.length} total, ${negative.length} negative\n`);

    for (const r of negative) {
      rows.push({
        storeCode: store.code,
        storeName: store.name,
        state: store.state || "",
        rating: STARS[r.starRating] ?? "",
        reviewer: r.reviewer?.displayName || "(anonymous)",
        reviewDate: r.createTime ? new Date(r.createTime).toISOString().slice(0, 10) : "",
        reviewText: r.comment || "",
        hasReply: r.reviewReply ? "Yes" : "No",
        replyText: r.reviewReply?.comment || "",
        replyDate: r.reviewReply?.updateTime ? new Date(r.reviewReply.updateTime).toISOString().slice(0, 10) : "",
      });
    }
    if (storeCount < stores.length) await new Promise((r) => setTimeout(r, 1000)); // between-store pacing
  }

  rows.sort((a, b) => (a.reviewDate < b.reviewDate ? 1 : a.reviewDate > b.reviewDate ? -1 : 0));

  const headers = [
    "Store Code", "Store Name", "State", "Rating", "Reviewer", "Review Date",
    "Review Text", "Has Reply", "Reply Text", "Reply Date",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push([
      row.storeCode, row.storeName, row.state, row.rating, row.reviewer, row.reviewDate,
      row.reviewText, row.hasReply, row.replyText, row.replyDate,
    ].map(csvEscape).join(","));
  }

  const outPath = process.argv[2] || "negative-reviews.csv";
  writeFileSync(outPath, "﻿" + lines.join("\n"), "utf8"); // BOM for Excel
  process.stderr.write(`\nDone. ${rows.length} negative reviews (rating <= ${NEGATIVE_THRESHOLD}) across ${stores.length} stores written to ${outPath}\n`);

  // Per-store summary
  const byStore = {};
  for (const row of rows) byStore[row.storeCode] = (byStore[row.storeCode] || 0) + 1;
  process.stderr.write("\nPer-store negative review counts:\n");
  for (const [code, count] of Object.entries(byStore).sort((a, b) => b[1] - a[1])) {
    process.stderr.write(`  ${code}: ${count}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
