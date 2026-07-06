# Jus Jumpin Review-AI

AI responder + escalation system for Google reviews across all Jus Jumpin locations.

**How it works**

```
New Google review
   │  (Pub/Sub push — instant, plus hourly reconciliation poll)
   ▼
Claude analyzes: sentiment, severity, topics, language + writes a reply
   │
   ├── 4–5★ & not negative ──► reply posted to Google automatically
   │
   └── 1–3★ / negative / high severity
          ├── Ticket row in the Google Sheet (draft reply included, editable)
          ├── WhatsApp alert → store manager + central ops
          └── Manager edits draft, sets Status = APPROVED
                 └── approvals worker posts it to Google (every 10–15 min)
```

Safety rails: auto-replies follow Google's review policy (no offers, no links),
injury/safety mentions are flagged `critical` and never auto-posted, and the
poll loop is idempotent (skips reviews that already have a reply or a ticket).

---

## Try it right now (no Google access needed)

```powershell
npm install
$env:ANTHROPIC_API_KEY = "sk-ant-..."   # from console.anthropic.com
npm run dryrun
```

This runs 8 realistic mock reviews (English / Hindi / Hinglish, including an
injury complaint and a billing dispute) through the real pipeline and prints
the replies + tickets it *would* create. Without an API key it still runs in
heuristic mode so you can see the routing.

---

## Phase 0 — Consolidate the 20 profiles (start this week, blocks everything)

The locations are currently spread across multiple Google accounts. The API
can only manage locations one authorized account can see.

1. Create/choose one central Google account (e.g. `gmb@jusjumpin.in`).
2. At [business.google.com](https://business.google.com) with that account, create a
   **location group** (Business Profile Manager → Create group), e.g. "Jus Jumpin India".
3. For each store: have its current owner open the profile → Settings → Managers →
   add the central account as **Owner**, then (after the 7-day Google cooldown for
   new owners) transfer it into the location group.
4. Franchisee-owned profiles you can't take over: have them add the central
   account as a **Manager** — that's enough to read and reply to reviews.

## Phase 0.5 — Apply for Business Profile API access (do in parallel, takes days–2 weeks)

1. Create a Google Cloud project (e.g. `jusjumpin-review-ai`).
2. Enable these APIs in the project: **My Business Account Management API**,
   **My Business Business Information API**, **My Business Notifications API**,
   **Google My Business API** (v4 — reviews live here), **Google Sheets API**, **Pub/Sub**.
3. Business Profile APIs start with **quota 0** — you must request access:
   <https://developers.google.com/my-business/content/prereqs> → "Request access"
   form. Use the central account's email, describe the use case as
   *"first-party: automated review responses and customer-service escalation
   for our own 20 family-entertainment-centre locations"*. First-party use is
   normally approved.
4. When approved, check that quotas for `mybusiness.googleapis.com` are > 0.

## Phase 1 — Credentials & config

1. **OAuth**: Cloud Console → Credentials → Create OAuth client → type **Desktop app**.
   Put client ID/secret in `.env` (copy from `.env.example`), then:
   ```powershell
   npm run get-token     # sign in as the central account, paste token into .env
   ```
2. **Account + location IDs**: with the token in place, run a one-liner to list them:
   ```powershell
   node -e "import('./src/gbp.js').then(async m => { console.log(JSON.stringify(await m.listAccounts(), null, 2)) })"
   ```
   Put the account ID in `.env` (`GBP_ACCOUNT_ID`), then `listLocations()` the same
   way and fill `gbpLocationId` for each store in `config/stores.json`.
3. **Ticket sheet**: create a Google Sheet, add a tab named `Tickets`, put its
   spreadsheet ID in `.env`. The header row is created automatically.
   Fill `managerWhatsApp` / `managerEmail` per store in `config/stores.json`.
4. **WhatsApp Cloud API** (Meta for Developers → Business app → WhatsApp):
   put the permanent token + phone number ID in `.env`, and create a template
   named `review_alert` (body text is documented in `src/whatsapp.js`).

## Phase 2 — Deploy to Cloud Run

```bash
gcloud run deploy jusjumpin-review-ai --source . --region asia-south1 \
  --set-env-vars "$(paste your .env values)" --allow-unauthenticated
```

Then wire the schedulers and notifications:

```bash
# Hourly reconciliation poll
gcloud scheduler jobs create http review-poll --schedule "0 * * * *" \
  --uri https://<service-url>/tasks/poll --http-method POST \
  --headers X-Tasks-Secret=<TASKS_SECRET>

# Approval worker every 10 minutes
gcloud scheduler jobs create http review-approvals --schedule "*/10 * * * *" \
  --uri https://<service-url>/tasks/approvals --http-method POST \
  --headers X-Tasks-Secret=<TASKS_SECRET>

# Real-time new-review notifications
gcloud pubsub topics create gbp-reviews
# Grant publish rights to GBP's service account on the topic:
#   mybusiness-api-pubsub@system.gserviceaccount.com  → role: Pub/Sub Publisher
gcloud pubsub subscriptions create gbp-reviews-push --topic gbp-reviews \
  --push-endpoint https://<service-url>/pubsub
# Finally link the GBP account to the topic (one authorized call):
#   PUT https://mybusinessnotifications.googleapis.com/v1/accounts/{GBP_ACCOUNT_ID}/notificationSetting
#   body: { "pubsubTopic": "projects/<project>/topics/gbp-reviews",
#           "notificationTypes": ["NEW_REVIEW", "UPDATED_REVIEW"] }
```

The hourly poll alone is enough to go live — Pub/Sub just makes replies near-instant.

## Running costs (approx.)

| Item | Monthly |
|---|---|
| Claude (Opus, ~500 reviews/mo across 20 stores) | ~$5 |
| Cloud Run + Pub/Sub + Scheduler (free tier covers this volume) | ~$0 |
| WhatsApp utility templates (~100 alerts) | ~₹15–30 |

## Manager workflow (the only thing humans do)

1. WhatsApp alert arrives → open the ticket sheet.
2. Read the review + AI draft in column K, edit if needed.
3. Set Status (column L) to `APPROVED` → reply posts within 15 minutes.
4. After resolving offline, set Status to `RESOLVED` for the ops log.
