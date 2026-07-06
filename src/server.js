import express from "express";
import { ENV, storeByLocationId } from "./config.js";
import { getReview } from "./gbp.js";
import { processReview, pollAllStores, postApprovedReplies } from "./pipeline.js";

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => res.json({ ok: true }));

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
app.post("/tasks/poll", requireSecret, async (_req, res) => {
  try {
    const results = await pollAllStores();
    console.log(`poll: processed ${results.length} reviews`);
    res.json({ processed: results.length, results: results.map((r) => r.action) });
  } catch (err) {
    console.error("poll error:", err);
    res.status(500).json({ error: String(err) });
  }
});

/** Post manager-approved drafts. Run every 10-15 minutes. */
app.post("/tasks/approvals", requireSecret, async (_req, res) => {
  try {
    const results = await postApprovedReplies();
    console.log(`approvals: posted ${results.filter((r) => r.action === "posted").length}`);
    res.json({ results });
  } catch (err) {
    console.error("approvals error:", err);
    res.status(500).json({ error: String(err) });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`jusjumpin-review-ai listening on :${port}`));
