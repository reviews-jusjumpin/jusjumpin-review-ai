import { gfetch } from "./google-auth.js";
import { ACTIVE_STORES, ENV } from "./config.js";
import { ticketsByReviewId } from "./sheets.js";

const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const IST_MS = 5.5 * 3600 * 1000;
const NEGATIVE_MAX_STARS = 3;
const CHUNK_LIMIT = 3500; // WhatsApp caps a text message at 4096 chars

export const istDate = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
export const yesterdayIST = () => istDate(Date.now() - 86_400_000);

export function istTime(iso) {
  const d = new Date(Date.parse(iso) + IST_MS);
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

export function prettyDate(date) {
  const [y, mo, d] = date.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[mo - 1]} ${y}`;
}

/** ≤3★ reviews created on `date` (IST) at one store. List is newest-updated first, so stop once past the day. */
async function negativeReviewsOn(store, start, end) {
  const out = [];
  let pageToken;
  for (let page = 0; page < 20; page++) {
    const data = await gfetch(
      `${REVIEWS_BASE}/accounts/${store.gbpAccountId || ENV.gbpAccountId}/locations/${store.gbpLocationId}/reviews?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ""}`
    );
    const reviews = data.reviews || [];
    for (const r of reviews) {
      const created = Date.parse(r.createTime);
      const rating = STARS[r.starRating] ?? 5;
      if (created >= start && created < end && rating <= NEGATIVE_MAX_STARS) {
        out.push({
          reviewId: r.reviewId,
          store: store.name,
          storeCode: store.code,
          rating,
          reviewer: r.reviewer?.displayName || "Anonymous",
          createTime: r.createTime,
          comment: r.comment || "",
          replied: Boolean(r.reviewReply),
        });
      }
    }
    pageToken = data.nextPageToken;
    const oldestUpdate = reviews.length ? Date.parse(reviews[reviews.length - 1].updateTime) : 0;
    if (!pageToken || oldestUpdate < start) break; // updateTime >= createTime, so nothing older can match
  }
  return out;
}

export async function collectNegativeReviews(date) {
  const start = Date.parse(`${date}T00:00:00+05:30`);
  const end = start + 86_400_000;
  const stores = ACTIVE_STORES.filter((s) => s.gbpLocationId);
  const reviews = [];
  const failedStores = [];
  let next = 0;
  async function worker() {
    while (next < stores.length) {
      const store = stores[next++];
      try {
        reviews.push(...(await negativeReviewsOn(store, start, end)));
      } catch (err) {
        failedStores.push(store.name);
        console.error(`digest: fetch failed [${store.code}]: ${err}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  let tickets = new Map();
  try {
    tickets = await ticketsByReviewId();
  } catch (err) {
    console.error("digest: ticket lookup failed:", err);
  }
  for (const r of reviews) r.ticket = tickets.get(r.reviewId) || null;
  reviews.sort((a, b) => a.rating - b.rating || Date.parse(a.createTime) - Date.parse(b.createTime));
  return { date, storeCount: stores.length, reviews, failedStores };
}

function statusLine(r) {
  if (r.replied) return "✅ Replied on Google";
  if (r.ticket?.status === "APPROVED") return `🕐 Reply approved, posting shortly (${r.ticket.ticketId})`;
  if (r.ticket) return `⏳ Draft reply waiting for manager approval (${r.ticket.ticketId})`;
  return "❗ Not yet picked up by the system";
}

/** WhatsApp-formatted text, split into ≤CHUNK_LIMIT messages at review boundaries. */
export function formatDigest({ date, storeCount, reviews, failedStores }) {
  const header = [`🔴 *Negative Google Reviews — ${prettyDate(date)}*`, `All 1★–3★ reviews posted that day · ${storeCount} outlets checked`, ""];

  if (!reviews.length) {
    header.push(`✅ No negative reviews on ${prettyDate(date)}.`);
    if (failedStores.length) header.push(`\n⚠️ Could not check: ${failedStores.join(", ")}`);
    return [header.join("\n")];
  }

  const byStore = {};
  for (const r of reviews) byStore[r.store] = (byStore[r.store] || 0) + 1;
  const storeList = Object.entries(byStore)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s} ${n}`)
    .join(" · ");
  const pending = reviews.filter((r) => !r.replied).length;
  header.push(`*Total: ${reviews.length}* (${reviews.filter((r) => r.rating === 1).length}× 1★, ${reviews.filter((r) => r.rating === 2).length}× 2★, ${reviews.filter((r) => r.rating === 3).length}× 3★)`);
  header.push(storeList);
  header.push(`Awaiting reply: ${pending}`);
  if (failedStores.length) header.push(`⚠️ Could not check: ${failedStores.join(", ")}`);

  const blocks = reviews.map((r, i) => {
    const text = r.comment ? `"${r.comment.replace(/\s+/g, " ").trim().slice(0, 300)}${r.comment.length > 300 ? "…" : ""}"` : "_(rating only, no text)_";
    const lines = [
      `*${i + 1}. ${r.store}* — ${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}`,
      `👤 ${r.reviewer} · ${istTime(r.createTime)}`,
      text,
    ];
    const severe = ["medium", "high", "critical"].includes(r.ticket?.severity);
    if (r.ticket?.summary) lines.push(`📝 ${r.ticket.summary}${severe ? ` (*${r.ticket.severity}*)` : ""}`);
    lines.push(statusLine(r));
    return lines.join("\n");
  });

  const messages = [];
  let current = header.join("\n");
  for (const block of blocks) {
    const next = `${current}\n━━━━━━━━━━━━\n${block}`;
    if (next.length > CHUNK_LIMIT && current !== header.join("\n")) {
      messages.push(current);
      current = `🔴 *Negative reviews ${prettyDate(date)} (contd.)*\n━━━━━━━━━━━━\n${block}`;
    } else {
      current = next;
    }
  }
  messages.push(current);
  if (messages.length > 1) messages.forEach((m, i) => (messages[i] = `${m}\n\n_(${i + 1}/${messages.length})_`));
  return messages;
}
