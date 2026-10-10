import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ENV, storeByLocationId, ACTIVE_STORES } from "./config.js";
import { getReview } from "./gbp.js";
import { processReview, pollAllStores, postApprovedReplies } from "./pipeline.js";
import { getStats, getRatingDropLog, getSetting, setSetting } from "./sheets.js";
import { fetchLiveRatings, checkForDrops } from "./ratings.js";
import { collectNegativeReviews, formatDigest, yesterdayIST, istDate } from "./digest.js";
import { reportCards, REPORT_CARD_CSS } from "./report-card.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory state for monitoring
const state = {
  startTime: Date.now(),
  lastPoll: null,
  lastPollCount: 0,
  lastApprovals: null,
  lastApprovalsPosted: 0,
  totalPolls: 0,
  totalPosted: 0,
};

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ── Installable as a phone app (Chrome "Install" needs a manifest with ≥192px PNG icons) ──
app.use("/assets", express.static(join(dirname(fileURLToPath(import.meta.url)), "assets"), { maxAge: "7d" }));

const APPS = {
  "negative-reviews": { name: "JJ Negative Reviews", short_name: "Neg Reviews", start_url: "/negative-reviews" },
  ratings: { name: "JJ Ratings Dashboard", short_name: "JJ Ratings", start_url: "/ratings" },
  status: { name: "JJ Review AI Monitor", short_name: "Review AI", start_url: "/status" },
};

app.get("/manifest.webmanifest", (req, res) => {
  const app = APPS[req.query.page] || APPS.status;
  res.type("application/manifest+json").json({
    id: app.start_url,
    ...app,
    scope: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/assets/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/assets/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/assets/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  });
});

const appHead = (page) => `<link rel="manifest" href="/manifest.webmanifest?page=${page}">
<meta name="theme-color" content="#0f172a">
<link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">`;

app.get("/status", async (_req, res) => {
  let stats = { open: 0, approved: 0, posted: 0, total: 0, recent: [] };
  try { stats = await getStats(); } catch {}
  const uptimeSec = Math.floor((Date.now() - state.startTime) / 1000);
  const fmt = (ms) => ms ? new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "Never";
  const ago = (ms) => {
    if (!ms) return "Never";
    const m = Math.floor((Date.now() - ms) / 60000);
    return m < 1 ? "Just now" : m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ${m%60}m ago`;
  };
  const stars = (r) => "⭐".repeat(Math.min(5, Math.max(0, Number(r) || 0)));
  const statusColor = { OPEN: "#f59e0b", APPROVED: "#6366f1", POSTED: "#22c55e" };
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JJ Review AI — Monitor</title>
${appHead("status")}
<meta http-equiv="refresh" content="60">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:20px;min-height:100vh}
h1{font-size:22px;font-weight:700;margin-bottom:4px}
.sub{font-size:13px;color:#64748b;margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
.card{background:#1e293b;border-radius:10px;padding:16px;text-align:center}
.card .val{font-size:32px;font-weight:800;margin:6px 0}
.card .lbl{font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.green{color:#22c55e}.yellow{color:#f59e0b}.purple{color:#6366f1}.blue{color:#38bdf8}
.section{background:#1e293b;border-radius:10px;padding:16px;margin-bottom:16px}
.section h2{font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px}
.row{display:grid;grid-template-columns:80px 60px 130px 1fr 90px;gap:8px;align-items:center;font-size:13px;padding:8px 0;border-bottom:1px solid #334155}
.row:last-child{border-bottom:none}
.row-hdr{font-weight:700;color:#64748b;font-size:11px}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700}
.links{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.btn{display:inline-block;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;background:#1e293b;color:#e2e8f0;border:1px solid #334155}
.btn:hover{border-color:#6366f1}
.pulse{display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;margin-right:6px;box-shadow:0 0 0 3px #22c55e33}
.info-row{display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid #334155}
.info-row:last-child{border-bottom:none}
.info-row span:last-child{color:#94a3b8}
</style>
</head>
<body>
<h1><span class="pulse"></span>Jus Jumpin Review AI</h1>
<div class="sub">Auto-refreshes every 60s &nbsp;·&nbsp; All times in IST &nbsp;·&nbsp; ${ACTIVE_STORES.length} active outlets monitored</div>

<div class="grid">
  <div class="card"><div class="lbl">Pending Approval</div><div class="val yellow">${stats.open}</div></div>
  <div class="card"><div class="lbl">Ready to Post</div><div class="val purple">${stats.approved}</div></div>
  <div class="card"><div class="lbl">Total Posted</div><div class="val green">${stats.posted}</div></div>
  <div class="card"><div class="lbl">Total Tickets</div><div class="val blue">${stats.total}</div></div>
  <div class="card"><div class="lbl">Server Uptime</div><div class="val" style="font-size:20px;color:#e2e8f0">${Math.floor(uptimeSec/3600)}h ${Math.floor((uptimeSec%3600)/60)}m</div></div>
</div>

<div class="section">
  <h2>System Status</h2>
  <div class="info-row"><span>Service</span><span class="green">● LIVE</span></div>
  <div class="info-row"><span>Last poll (all stores)</span><span>${ago(state.lastPoll)} &nbsp;·&nbsp; ${state.lastPollCount} reviews processed</span></div>
  <div class="info-row"><span>Last approval run</span><span>${ago(state.lastApprovals)} &nbsp;·&nbsp; ${state.lastApprovalsPosted} posted</span></div>
  <div class="info-row"><span>Total polls this session</span><span>${state.totalPolls}</span></div>
  <div class="info-row"><span>Total replies posted this session</span><span>${state.totalPosted}</span></div>
</div>

<div class="section">
  <h2>Recent Tickets (last 8)</h2>
  ${stats.recent.length === 0 ? '<p style="color:#64748b;font-size:13px">No tickets yet — polls run every hour.</p>' : `
  <div class="row row-hdr"><span>ID</span><span>Rating</span><span>Store</span><span>Summary</span><span>Status</span></div>
  ${stats.recent.map(t => `
  <div class="row">
    <span style="color:#64748b">${String(t.id).slice(-6)}</span>
    <span>${stars(t.rating)}</span>
    <span style="color:#94a3b8">${t.store}</span>
    <span>${t.summary || "—"}</span>
    <span><span class="badge" style="background:${statusColor[t.status] || "#334155"}22;color:${statusColor[t.status] || "#94a3b8"}">${t.status}</span></span>
  </div>`).join("")}`}
</div>

<div class="section">
  <h2>Quick Links</h2>
  <div class="links">
    <a class="btn" href="/ratings">⭐ Ratings Dashboard</a>
    <a class="btn" href="/negative-reviews">🔴 Daily Negative Review Report</a>
    <a class="btn" href="https://docs.google.com/spreadsheets/d/${ENV.spreadsheetId}" target="_blank">📋 Google Sheets — Ticket Log</a>
    <a class="btn" href="https://dashboard.render.com/web/srv-d95np94vikkc73dvb25g/logs" target="_blank">📜 Render Logs</a>
    <a class="btn" href="https://console.cron-job.org/jobs" target="_blank">⏰ Cron Jobs</a>
    <a class="btn" href="/healthz" target="_blank">❤️ Health Check</a>
  </div>
</div>

<div style="text-align:center;font-size:11px;color:#334155;margin-top:20px">
  Jus Jumpin Review AI &nbsp;·&nbsp; Powered by Gemini &nbsp;·&nbsp; Built by Souvik Kundu
</div>
</body></html>`;
  res.send(html);
});

app.get("/api/ratings", async (req, res) => {
  try {
    let target = req.query.target ? parseFloat(req.query.target) : undefined;
    if (target === undefined) {
      const saved = await getSetting("targetRating").catch(() => null);
      if (saved != null) target = parseFloat(saved);
    }
    const ratings = await fetchLiveRatings({ target });
    res.json({ ratings, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/rating-drops", async (_req, res) => {
  try {
    const drops = await getRatingDropLog();
    res.json({ drops });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/ratings/target", async (req, res) => {
  const value = parseFloat(req.body?.target);
  if (Number.isFinite(value) && value >= 1 && value <= 5) {
    try { await setSetting("targetRating", String(value)); } catch (err) { console.error("save target failed:", err); }
  }
  res.redirect("/ratings");
});

app.get("/ratings", async (_req, res) => {
  let savedTarget = null;
  try { savedTarget = await getSetting("targetRating"); } catch {}
  const target = savedTarget != null ? parseFloat(savedTarget) : undefined;

  let ratings = [];
  let drops = [];
  let fetchError = null;
  try {
    [ratings, drops] = await Promise.all([fetchLiveRatings({ target }), getRatingDropLog({ limit: 30 })]);
  } catch (err) {
    fetchError = String(err);
  }

  const displayTarget = target ?? ENV.targetRating;
  const withRating = ratings.filter((r) => r.rating != null);
  const totalReviews = withRating.reduce((sum, r) => sum + (r.reviewCount || 0), 0);
  const chainAvg = totalReviews
    ? withRating.reduce((sum, r) => sum + r.rating * r.reviewCount, 0) / totalReviews
    : 0;
  const meetingTarget = withRating.filter((r) => r.meetsTarget).length;
  const missingTarget = withRating.length - meetingTarget;
  const totalFiveStarsNeeded = withRating.reduce((sum, r) => sum + (r.fiveStarsNeeded || 0), 0);

  // Worst-vs-their-own-target first, so the stores furthest off track bubble to the top.
  const sorted = [...ratings].sort((a, b) => {
    const da = a.rating == null ? -99 : a.rating - a.target;
    const db = b.rating == null ? -99 : b.rating - b.target;
    return da - db;
  });
  const ratingColor = (r, t) => (r == null ? "#64748b" : r >= t ? "#22c55e" : r >= t - 0.3 ? "#f59e0b" : "#ef4444");
  const stars = (r) => {
    if (r == null) return '<span style="color:#64748b">—</span>';
    const full = Math.round(r);
    return "★".repeat(full) + "☆".repeat(5 - full);
  };
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JJ Review AI — Ratings Dashboard</title>
${appHead("ratings")}
<meta http-equiv="refresh" content="300">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:20px;min-height:100vh}
h1{font-size:22px;font-weight:700;margin-bottom:4px}
.sub{font-size:13px;color:#64748b;margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
.card{background:#1e293b;border-radius:10px;padding:16px;text-align:center}
.card .val{font-size:32px;font-weight:800;margin:6px 0}
.card .lbl{font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.green{color:#22c55e}.yellow{color:#f59e0b}.red{color:#ef4444}.blue{color:#38bdf8}
.section{background:#1e293b;border-radius:10px;padding:16px;margin-bottom:16px}
.section h2{font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.03em;padding:6px 8px;border-bottom:1px solid #334155}
td{padding:8px;border-bottom:1px solid #334155}
tr:last-child td{border-bottom:none}
.stars{letter-spacing:1px}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700}
.btn{display:inline-block;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;background:#1e293b;color:#e2e8f0;border:1px solid #334155;margin-top:4px}
.btn:hover{border-color:#6366f1}
.warn{background:#7f1d1d33;border:1px solid #ef444455;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;color:#fca5a5}
.arrow{color:#64748b;margin:0 6px}
.target-form{display:flex;align-items:center;gap:10px;margin-bottom:20px;background:#1e293b;border-radius:10px;padding:12px 16px}
.target-form label{font-size:13px;color:#94a3b8}
.target-form input{width:80px;padding:6px 10px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px}
.target-form button{padding:7px 16px;border-radius:6px;border:none;background:#6366f1;color:#fff;font-weight:600;font-size:13px;cursor:pointer}
.target-form button:hover{background:#4f46e5}
.target-form .hint{font-size:12px;color:#64748b;margin-left:auto}
.miss{color:#ef4444;font-weight:600}
.hit{color:#22c55e;font-weight:600}
</style>
</head>
<body>
<h1>⭐ Jus Jumpin — Ratings Dashboard</h1>
<div class="sub">Live from Google Business Profile &nbsp;·&nbsp; Auto-refreshes every 5 min &nbsp;·&nbsp; ${ratings.length} stores tracked</div>

${fetchError ? `<div class="warn">⚠️ Could not fetch live ratings: ${fetchError}</div>` : ""}

<form class="target-form" method="post" action="/ratings/target">
  <label for="target">Target rating</label>
  <input type="number" step="0.1" min="1" max="5" name="target" id="target" value="${displayTarget}">
  <button type="submit">Set Target</button>
  <span class="hint">Saved to the sheet — applies chain-wide until changed again.${savedTarget == null ? " (currently using default 4.8)" : ""}</span>
</form>

<div class="grid">
  <div class="card"><div class="lbl">Chain Avg Rating</div><div class="val ${chainAvg >= displayTarget ? "green" : chainAvg >= displayTarget - 0.3 ? "yellow" : "red"}">${chainAvg ? chainAvg.toFixed(2) : "—"}</div></div>
  <div class="card"><div class="lbl">Target</div><div class="val" style="color:#e2e8f0">${displayTarget.toFixed(1)}★</div></div>
  <div class="card"><div class="lbl">Meeting Target</div><div class="val green">${meetingTarget}</div></div>
  <div class="card"><div class="lbl">Below Target</div><div class="val red">${missingTarget}</div></div>
  <div class="card"><div class="lbl">Total Reviews</div><div class="val blue">${totalReviews.toLocaleString("en-IN")}</div></div>
  <div class="card"><div class="lbl">5★ Needed (chain)</div><div class="val yellow">${totalFiveStarsNeeded.toLocaleString("en-IN")}</div></div>
</div>

<div class="section">
  <h2>Live Store Ratings — worst vs. target first</h2>
  <p style="color:#64748b;font-size:12px;margin-bottom:10px">"5★ needed" = additional 5-star reviews required (holding everything else fixed) to pull the average up to target: <code style="color:#94a3b8">reviews × (target − rating) ÷ (5 − target)</code>, rounded up.</p>
  <table>
    <tr><th>Store</th><th>State</th><th>Rating</th><th></th><th>Target</th><th>vs Target</th><th>Reviews</th><th>5★ Needed</th></tr>
    ${sorted.map((r) => `
    <tr>
      <td><b>${r.code}</b> &nbsp;${r.name}</td>
      <td style="color:#94a3b8">${r.state || "—"}</td>
      <td style="color:${ratingColor(r.rating, r.target)};font-weight:700">${r.rating != null ? r.rating.toFixed(2) : "—"}</td>
      <td class="stars" style="color:${ratingColor(r.rating, r.target)}">${stars(r.rating)}</td>
      <td style="color:#64748b">${r.target.toFixed(1)}</td>
      <td class="${r.meetsTarget ? "hit" : r.meetsTarget === false ? "miss" : ""}">${r.rating != null ? (r.rating - r.target >= 0 ? "+" : "") + (r.rating - r.target).toFixed(2) : "—"}</td>
      <td style="color:#94a3b8">${(r.reviewCount || 0).toLocaleString("en-IN")}</td>
      <td style="${r.fiveStarsNeeded === 0 ? "color:#22c55e;font-weight:700" : r.fiveStarsNeeded ? "color:#f59e0b;font-weight:700" : "color:#64748b"}">${r.fiveStarsNeeded === 0 ? "✓ Met" : r.fiveStarsNeeded != null ? r.fiveStarsNeeded.toLocaleString("en-IN") : "—"}</td>
    </tr>`).join("")}
  </table>
</div>

<div class="section">
  <h2>Rating Drop Log (last 30)</h2>
  ${drops.length === 0 ? '<p style="color:#64748b;font-size:13px">No drops logged yet. The background checker (POST /tasks/ratings) needs to run at least twice to detect a change — set it up on cron-job.org like the other tasks.</p>' : `
  <table>
    <tr><th>Detected</th><th>Store</th><th>Change</th><th>Reviews</th></tr>
    ${drops.map((d) => `
    <tr>
      <td style="color:#94a3b8">${fmtTime(d.detectedAt)}</td>
      <td><b>${d.code}</b> &nbsp;${d.name}</td>
      <td><span style="color:#94a3b8">${d.oldRating.toFixed(2)}</span><span class="arrow">→</span><span style="color:#ef4444;font-weight:700">${d.newRating.toFixed(2)}</span></td>
      <td style="color:#94a3b8">${d.oldReviewCount} → ${d.newReviewCount}</td>
    </tr>`).join("")}
  </table>`}
</div>

<a class="btn" href="/status">← Back to Monitor</a>

<div style="text-align:center;font-size:11px;color:#334155;margin-top:20px">
  Jus Jumpin Review AI &nbsp;·&nbsp; Ratings pulled live from Google Business Profile
</div>
</body></html>`;
  res.send(html);
});

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Ready-to-send daily negative-review report — copied into the boss's WhatsApp group by hand until the API is set up. */
app.get("/negative-reviews", async (req, res) => {
  const today = istDate();
  const asked = String(req.query.date || "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : yesterdayIST();
  const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const prev = shift(date, -1);
  const next = shift(date, 1);

  let data = null;
  let messages = [];
  let cards = [];
  let captions = [];
  let error = null;
  try {
    data = await collectNegativeReviews(date);
    messages = formatDigest(data);
    ({ cards, captions } = reportCards(data));
  } catch (err) {
    error = String(err);
  }
  const pending = data ? data.reviews.filter((r) => !r.replied).length : 0;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JJ Review AI — Negative Review Report</title>
${appHead("negative-reviews")}
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:20px;min-height:100vh;max-width:760px;margin:0 auto}
h1{font-size:22px;font-weight:700;margin-bottom:4px}
.sub{font-size:13px;color:#64748b;margin-bottom:18px}
.nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#1e293b;border-radius:10px;padding:10px 14px;margin-bottom:14px}
.nav a,.nav button{padding:7px 12px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:13px;text-decoration:none;cursor:pointer}
.nav a.off{opacity:.35;pointer-events:none}
.nav input{padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
.card{background:#1e293b;border-radius:10px;padding:12px;text-align:center}
.card .val{font-size:26px;font-weight:800;margin-top:4px}
.card .lbl{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.red{color:#ef4444}.yellow{color:#f59e0b}.blue{color:#38bdf8}
.msg{background:#1e293b;border-radius:10px;padding:14px;margin-bottom:14px}
textarea{width:100%;background:#0b1220;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:12px;font:13px/1.5 'Segoe UI',system-ui,sans-serif;resize:vertical}
.actions{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
.actions button,.actions a{flex:1;min-width:150px;text-align:center;padding:11px 16px;border-radius:8px;font-weight:700;font-size:14px;border:none;cursor:pointer;text-decoration:none}
.copy{background:#6366f1;color:#fff}
.wa{background:#22c55e;color:#062e16}
.warn{background:#7f1d1d33;border:1px solid #ef444455;border-radius:8px;padding:12px;margin-bottom:14px;font-size:13px;color:#fca5a5}
.btn{display:inline-block;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;background:#1e293b;color:#e2e8f0;border:1px solid #334155}
.hint{font-size:12px;color:#64748b;margin-bottom:14px}
.sec{font-size:13px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:22px 0 8px}
.rc-wrap{overflow-x:auto;border-radius:14px;margin-bottom:10px}
.dl{background:#334155;color:#e2e8f0}
${REPORT_CARD_CSS}
</style>
</head>
<body>
<h1>🔴 Daily Negative Review Report</h1>
<div class="sub">Every 1★–3★ Google review across all outlets for one day (IST), pulled live · for the boss's WhatsApp group</div>

<form class="nav" method="get" action="/negative-reviews">
  <a href="/negative-reviews?date=${prev}">← Prev day</a>
  <input type="date" name="date" value="${date}" max="${today}">
  <button type="submit">Go</button>
  <a class="${next > today ? "off" : ""}" href="/negative-reviews?date=${next}">Next day →</a>
</form>

${error ? `<div class="warn">⚠️ Could not build the report: ${escapeHtml(error)}</div>` : `
<div class="kpis">
  <div class="card"><div class="lbl">Negative reviews</div><div class="val red">${data.reviews.length}</div></div>
  <div class="card"><div class="lbl">Awaiting reply</div><div class="val yellow">${pending}</div></div>
  <div class="card"><div class="lbl">Outlets checked</div><div class="val blue">${data.storeCount}</div></div>
</div>
${data.failedStores.length ? `<div class="warn">⚠️ Could not check: ${escapeHtml(data.failedStores.join(", "))} — reload to retry before sending.</div>` : ""}

<div class="sec">📸 Screenshot version</div>
<div class="hint">Phone: tap <b>Share image</b> → WhatsApp → pick the group. PC: <b>Copy image</b>, then Ctrl+V in the WhatsApp group.${cards.length > 1 ? ` Busy day — send all ${cards.length} images in order.` : ""}</div>
${cards.map((c, i) => `
<div class="rc-wrap">${c}</div>
<div class="actions" style="margin-bottom:16px">
  <button class="copy" type="button" onclick="copyImg(${i}, this)">📋 Copy image${cards.length > 1 ? ` ${i + 1}` : ""}</button>
  <button class="wa" type="button" onclick="shareImg(${i}, this)">📤 Share image${cards.length > 1 ? ` ${i + 1}` : ""}</button>
  <button class="dl" type="button" onclick="downloadImg(${i}, this)">⬇ Download</button>
</div>`).join("")}

<div class="sec">💬 Text version</div>
<div class="hint">Tap <b>Send via WhatsApp</b>, choose the boss group, send. Or <b>Copy</b> and paste it in.${messages.length > 1 ? ` Long day — send all ${messages.length} parts in order.` : ""}</div>
${messages.map((m, i) => `
<div class="msg">
  <textarea id="m${i}" readonly rows="${Math.min(40, m.split("\n").length + 1)}">${escapeHtml(m)}</textarea>
  <div class="actions">
    <button class="copy" type="button" onclick="copyMsg('m${i}', this)">📋 Copy${messages.length > 1 ? ` part ${i + 1}` : ""}</button>
    <a class="wa" href="https://wa.me/?text=${encodeURIComponent(m)}" target="_blank" rel="noopener">Send via WhatsApp${messages.length > 1 ? ` (part ${i + 1})` : ""}</a>
  </div>
</div>`).join("")}`}

<a class="btn" href="/status">← Back to Monitor</a>

<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script>
const CAPTIONS = ${JSON.stringify(captions).replace(/</g, "\\u003c")};
const FILE_BASE = 'negative-reviews-${date}';
const fileName = (i) => FILE_BASE + (CAPTIONS.length > 1 ? '-' + (i + 1) : '') + '.png';
function renderCard(i) {
  // the on-screen preview is zoomed to fit small screens; the image is always rendered at full size
  const opts = { scale: 2, backgroundColor: '#ffffff', onclone: (doc) => { doc.getElementById('rc' + i).style.zoom = 1; } };
  return html2canvas(document.getElementById('rc' + i), opts).then((c) => new Promise((r) => c.toBlob(r, 'image/png')));
}
function fitCards() {
  document.querySelectorAll('.rc').forEach((el) => { el.style.zoom = Math.min(1, el.parentElement.clientWidth / 600); });
}
fitCards();
window.addEventListener('resize', fitCards);
function flash(btn, msg) { const old = btn.textContent; btn.textContent = msg; setTimeout(() => (btn.textContent = old), 2500); }
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function copyImg(i, btn) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderCard(i) })]);
    flash(btn, '✅ Copied — paste in WhatsApp');
  } catch (e) { flash(btn, 'Copy blocked here — use Download'); }
}
async function shareImg(i, btn) {
  const blob = await renderCard(i);
  const file = new File([blob], fileName(i), { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: CAPTIONS[i] }); } catch (e) { /* user closed the share sheet */ }
  } else { saveBlob(blob, file.name); flash(btn, 'Sharing not supported — downloaded'); }
}
async function downloadImg(i, btn) { saveBlob(await renderCard(i), fileName(i)); flash(btn, '✅ Downloaded'); }
function copyMsg(id, btn) {
  const t = document.getElementById(id);
  const done = () => { const old = btn.textContent; btn.textContent = '✅ Copied'; setTimeout(() => (btn.textContent = old), 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(t.value).then(done, () => { t.select(); document.execCommand('copy'); done(); });
  else { t.select(); document.execCommand('copy'); done(); }
}
</script>
</body></html>`;
  res.send(html);
});

/**
 * GBP Pub/Sub push endpoint. Configure the My Business Notifications API to
 * publish NEW_REVIEW / UPDATED_REVIEW to a topic with a push subscription
 * pointing here. Pub/Sub wraps the notification in { message: { data } }.
 */
app.post("/pubsub", async (req, res) => {
  try {
    const data = req.body?.message?.data;
    if (!data) return res.status(204).end(); // keep-alive / malformed — ack so it isn't retried
    const note = JSON.parse(Buffer.from(data, "base64").toString("utf8"));

    // Review notifications carry the full review resource name:
    // accounts/{a}/locations/{l}/reviews/{r}
    const reviewName = note.review || note.resourceName || "";
    const locationId = (reviewName.match(/locations\/([^/]+)/) || [])[1];
    const store = storeByLocationId(locationId);

    if (!reviewName.includes("/reviews/") || !store) {
      console.log("pubsub: ignoring notification", note.notificationType || "(unknown)");
      return res.status(204).end();
    }

    const review = await getReview(reviewName, store);
    if (review.hasReply) return res.status(204).end(); // already handled

    const result = await processReview(review, store);
    console.log(`pubsub: ${result.action} for ${reviewName}`);
    res.status(204).end();
  } catch (err) {
    console.error("pubsub error:", err);
    res.status(500).json({ error: String(err) }); // nack → Pub/Sub retries
  }
});

// Cloud Scheduler endpoints (protected by a shared secret header)
function requireSecret(req, res, next) {
  if (ENV.tasksSecret && req.get("X-Tasks-Secret") !== ENV.tasksSecret) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

/** Reconciliation sweep — catches anything Pub/Sub missed. Run hourly. */
let pollRunning = false; // overlapping sweeps double-reply the same reviews and waste Gemini quota
app.post("/tasks/poll", requireSecret, (_req, res) => {
  if (pollRunning) return res.json({ ok: true, message: "poll already running — skipped" });
  pollRunning = true;
  res.json({ ok: true, message: "poll started" }); // respond immediately so cron-job.org doesn't time out
  pollAllStores()
    .then((results) => {
      state.lastPoll = Date.now();
      state.lastPollCount = results.length;
      state.totalPolls++;
      console.log(`poll: processed ${results.length} reviews`);
    })
    .catch((err) => console.error("poll error:", err))
    .finally(() => { pollRunning = false; });
});

/** Post manager-approved drafts. Run every 10-15 minutes. */
app.post("/tasks/approvals", requireSecret, (_req, res) => {
  res.json({ ok: true, message: "approvals started" }); // respond immediately
  postApprovedReplies()
    .then((results) => {
      const posted = results.filter((r) => r.action === "posted").length;
      state.lastApprovals = Date.now();
      state.lastApprovalsPosted = posted;
      state.totalPosted += posted;
      console.log(`approvals: posted ${posted}`);
    })
    .catch((err) => console.error("approvals error:", err));
});

/** Live rating snapshot + drop detection. Run every few hours. */
app.post("/tasks/ratings", requireSecret, (_req, res) => {
  res.json({ ok: true, message: "rating check started" }); // respond immediately
  checkForDrops()
    .then(({ drops }) => console.log(`ratings: checked ${ACTIVE_STORES.length} stores, ${drops.length} drop(s) detected`))
    .catch((err) => console.error("ratings check error:", err));
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`jusjumpin-review-ai listening on :${port}`));

// Free Render sleeps after 15 idle min, and a cold boot outlasts cron-job.org's 30 s timeout — self-ping via the public URL to stay warm.
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => fetch(`${process.env.RENDER_EXTERNAL_URL}/healthz`).catch(() => {}), 10 * 60 * 1000);
}
