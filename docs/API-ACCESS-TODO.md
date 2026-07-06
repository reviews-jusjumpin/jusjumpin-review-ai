# ✅ SUBMITTED 2026-06-11 — Google support case **9-1598000041772**
# Review time quoted: 7–10 working days. Watch reviews.jusjumpin@gmail.com for
# Google's reply (they sometimes ask follow-up questions — answer fast to avoid
# restarting the queue). Approved = quotas on mybusiness APIs change 0 → 300/min.
#
# Submitted with: project 762255370518 (jusjumpin-review-ai), site
# https://www.jusjumpin.com, verified profile "Jus Jumpin Axis Mall".
# Note: mybusiness.googleapis.com (v4) could NOT be enabled pre-approval
# ("Enabling failed") — retry enabling it right after the approval email.

# Do-this-today checklist — GBP API access (≈45 minutes of clicking)

You have manager access to 15 stores on the central account. That's enough.
The API approval is per-PROJECT, not per-store — the remaining stores simply
appear automatically once they're added to the same account later.

---

## Step 1 — Tidy Business Profile Manager (10 min)

1. Go to <https://business.google.com> signed in as the **central account**.
2. You should see all 15 locations listed.
3. If they're loose (not in a group): left menu → **Businesses** → "Create group"
   → name it `Jus Jumpin India` → select all 15 → Actions → Transfer to group.
   (If Google doesn't offer groups on your account UI, skip — loose is fine too.)
4. Note your **account ID**: it's in the URL or under Settings. You'll need it later.

## Step 2 — Create the Google Cloud project (10 min)

1. Go to <https://console.cloud.google.com> — sign in with the **same central account**.
2. Top bar → project dropdown → **New Project** → name: `jusjumpin-review-ai` → Create.
3. Note the **Project ID** and **Project Number** (shown on the dashboard) —
   the access form asks for the project number.

## Step 3 — Enable the APIs (5 min)

In the new project: left menu → **APIs & Services → Library**, search and click
**Enable** on each of these:

- [ ] Google My Business API          ← reviews live here (v4)
- [ ] My Business Account Management API
- [ ] My Business Business Information API
- [ ] My Business Notifications API
- [ ] Google Sheets API
- [ ] Cloud Pub/Sub API

## Step 4 — Submit the access request form (15 min) ← THE LONG POLE

Form: <https://support.google.com/business/workflow/16726127>
(also reachable from <https://developers.google.com/my-business/content/prereqs> → "Request access")

Eligibility you already meet: profiles verified + active 60 days, business website live.

Copy-paste answers (edit the email/website to the real ones):

| Form field | Answer |
|---|---|
| Company name | Jus Jumpin (legal entity name as on GST/registration) |
| Website | https://www.jusjumpin.in |
| Contact email | the central account Gmail |
| Google Cloud Project Number | from Step 2 |
| Do you manage profiles for your own business or for clients? | **Own business only** (first-party) |
| Number of locations | 20 (15 connected today, remaining being transferred) |
| Use case / why the dashboard is not enough | see paragraph below |
| Which APIs/workflows | Reviews read + reply, business information read, notifications |

**Use-case paragraph (paste as-is):**

> We operate Jus Jumpin, a chain of 20 children's indoor trampoline parks /
> family entertainment centres across India, all managed under this single
> Business Profile account. We are building an internal customer-service tool
> that (1) monitors new Google reviews across all locations in real time,
> (2) posts owner replies to reviews, and (3) escalates negative reviews to
> the relevant centre manager as support tickets. With 20 locations the web
> dashboard does not scale: managers miss negative reviews for days. We need
> the Reviews endpoints (list/get/updateReply), Account Management and
> Business Information APIs for location discovery, and the Notifications
> API (Cloud Pub/Sub) for new-review alerts. This is strictly first-party
> usage for our own verified locations; no client or third-party data access.

Then wait for the approval email (typically 3–14 days).

**How to know you're approved:** APIs & Services → enabled API → Quotas.
Quota 0 = pending. Quota 300 QPM = approved.

## Step 5 — While you wait (any day this week)

- [ ] Get an Anthropic API key (<https://console.anthropic.com> → API Keys),
      then in PowerShell:
      `setx ANTHROPIC_API_KEY "sk-ant-..."` → reopen terminal → `npm run dryrun`
      → review the real AI reply quality and tell Claude what to change.
- [ ] Chase the remaining ~5-6 store profiles into the central account.
- [ ] Create the ticket Google Sheet (one tab named `Tickets`), share-with-edit
      to the managers, copy its spreadsheet ID into `.env`.
- [ ] Collect each store manager's WhatsApp number into `config/stores.json`.
