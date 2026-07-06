import express from "express";
import { ENV, storeByLocationId, ACTIVE_STORES } from "./config.js";
import { getReview } from "./gbp.js";
import { processReview, pollAllStores, postApprovedReplies } from "./pipeline.js";
import { getStats } from "./sheets.js";

const app = express();
app.use(express.json());

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
    <a class="btn" href="https://docs.google.com/spreadsheets/d/${ENV.spreadsheetId}" target="_blank">📋 Google Sheets — Ticket Log</a>
    <a class="btn" href="https://dashboard.render.com/web/srv-d95np94vikkc73dvb25g/logs" target="_blank">📜 Render Logs</a>
    <a class="btn" href="https://console.cron-job.org/jobs" target="_blank">⏰ Cron Jobs</a>
    <a class="btn" href="/healthz" target="_blank">❤️ Health Check</a>
  </div>
</div>

<div style="text-align:center;font-size:11px;color:#334155;margin-top:20px">
  Jus Jumpin Review AI &nbsp;·&nbsp; Powered by Claude Sonnet &nbsp;·&nbsp; Built by Souvik Kundu
</div>
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
app.post("/tasks/poll", requireSecret, (_req, res) => {
  res.json({ ok: true, message: "poll started" }); // respond immediately so cron-job.org doesn't time out
  pollAllStores()
    .then((results) => {
      state.lastPoll = Date.now();
      state.lastPollCount = results.length;
      state.totalPolls++;
      console.log(`poll: processed ${results.length} reviews`);
    })
    .catch((err) => console.error("poll error:", err));
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

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`jusjumpin-review-ai listening on :${port}`));
