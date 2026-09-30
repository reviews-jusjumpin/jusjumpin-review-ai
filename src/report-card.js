import { istTime, prettyDate } from "./digest.js";

const PER_IMAGE = 8; // taller than this and WhatsApp's image compression makes the text hard to read
const AVATAR_COLORS = ["#1a73e8", "#e8710a", "#188038", "#a142f4", "#d93025", "#12b5cb", "#e52592", "#5f6368"];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function avatarColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function status(r) {
  if (r.replied) return { cls: "ok", label: "✅ Replied on Google" };
  if (r.ticket?.status === "APPROVED") return { cls: "info", label: "🕐 Reply approved, posting shortly" };
  if (r.ticket) return { cls: "warn", label: "⏳ Draft reply waiting for approval" };
  return { cls: "bad", label: "❗ Not yet picked up" };
}

export const REPORT_CARD_CSS = `
.rc{width:600px;background:#fff;color:#202124;font-family:Roboto,'Segoe UI',Arial,sans-serif;border-radius:14px;overflow:hidden;margin:0 auto}
.rc-head{background:linear-gradient(135deg,#c5221f,#e8453c);color:#fff;padding:20px 24px}
.rc-title{font-size:22px;font-weight:800}
.rc-date{font-size:14px;opacity:.9;margin-top:2px}
.rc-stats{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.rc-stats span{background:rgba(255,255,255,.18);border-radius:999px;padding:4px 11px;font-size:13px}
.rc-body{padding:6px 24px 4px}
.rc-review{padding:16px 0;border-bottom:1px solid #e8eaed}
.rc-review:last-child{border-bottom:none}
.rc-top{display:flex;align-items:center;gap:12px}
.rc-av{width:40px;height:40px;border-radius:50%;color:#fff;font-weight:700;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.rc-name{font-size:15px;font-weight:600}
.rc-meta{font-size:13px;color:#5f6368}
.rc-store{display:inline-block;background:#e8f0fe;color:#1967d2;border-radius:6px;padding:1px 7px;font-weight:600;font-size:12px;margin-right:4px}
.rc-stars{margin:8px 0 4px;font-size:18px;letter-spacing:1px}
.rc-stars .on{color:#fbbc04}.rc-stars .off{color:#dadce0}
.rc-text{font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
.rc-text.empty{color:#80868b;font-style:italic}
.rc-ai{margin-top:8px;font-size:13px;color:#3c4043;background:#f1f3f4;border-radius:8px;padding:7px 10px}
.rc-status{display:inline-block;margin-top:9px;font-size:12.5px;font-weight:600;border-radius:999px;padding:4px 11px}
.rc-status.ok{background:#e6f4ea;color:#137333}.rc-status.info{background:#e8f0fe;color:#1967d2}
.rc-status.warn{background:#fef7e0;color:#b06000}.rc-status.bad{background:#fce8e6;color:#c5221f}
.rc-clear{padding:34px 24px;text-align:center;font-size:18px;color:#137333;font-weight:600}
.rc-foot{background:#f8f9fa;color:#80868b;font-size:11.5px;padding:10px 24px;text-align:right}
`;

function reviewHtml(r) {
  const s = status(r);
  const stars = `<span class="on">${"★".repeat(r.rating)}</span><span class="off">${"★".repeat(5 - r.rating)}</span>`;
  const text = r.comment
    ? `<div class="rc-text">${esc(r.comment.trim().slice(0, 400))}${r.comment.length > 400 ? "…" : ""}</div>`
    : `<div class="rc-text empty">Rating only — no written review</div>`;
  return `<div class="rc-review">
  <div class="rc-top">
    <div class="rc-av" style="background:${avatarColor(r.reviewer)}">${esc([...r.reviewer.trim()][0]?.toUpperCase() || "?")}</div>
    <div><div class="rc-name">${esc(r.reviewer)}</div><div class="rc-meta"><span class="rc-store">${esc(r.store)}</span>${esc(istTime(r.createTime))}</div></div>
  </div>
  <div class="rc-stars">${stars}</div>
  ${text}
  ${r.ticket?.summary ? `<div class="rc-ai">📝 ${esc(r.ticket.summary)}</div>` : ""}
  <div class="rc-status ${s.cls}">${s.label}</div>
</div>`;
}

/** Image-ready report cards (one per ≤PER_IMAGE reviews) plus a short WhatsApp caption for each. */
export function reportCards({ date, storeCount, reviews, failedStores }) {
  const day = prettyDate(date);
  const counts = [1, 2, 3].map((n) => reviews.filter((r) => r.rating === n).length);
  const pending = reviews.filter((r) => !r.replied).length;
  const chunks = [];
  for (let i = 0; i < reviews.length; i += PER_IMAGE) chunks.push(reviews.slice(i, i + PER_IMAGE));
  if (!chunks.length) chunks.push([]);

  const cards = chunks.map((chunk, i) => {
    const part = chunks.length > 1 ? ` · part ${i + 1}/${chunks.length}` : "";
    const head = `<div class="rc-head">
  <div class="rc-title">🔴 Negative Google Reviews</div>
  <div class="rc-date">${esc(day)} · ${storeCount} outlets checked${part}</div>
  <div class="rc-stats"><span><b>${reviews.length}</b> total</span><span>${counts[0]}× 1★</span><span>${counts[1]}× 2★</span><span>${counts[2]}× 3★</span><span><b>${pending}</b> awaiting reply</span></div>
</div>`;
    const body = chunk.length
      ? `<div class="rc-body">${chunk.map(reviewHtml).join("")}</div>`
      : `<div class="rc-clear">✅ No negative reviews on ${esc(day)}</div>`;
    const warn = failedStores.length ? `⚠️ Could not check: ${esc(failedStores.join(", "))} · ` : "";
    return `<div class="rc" id="rc${i}">${head}${body}<div class="rc-foot">${warn}Jus Jumpin Review AI · live from Google Business Profile</div></div>`;
  });

  const captions = chunks.map((_, i) => `🔴 Negative Google Reviews — ${day}: ${reviews.length} total, ${pending} awaiting reply${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ""}`);
  return { cards, captions };
}
