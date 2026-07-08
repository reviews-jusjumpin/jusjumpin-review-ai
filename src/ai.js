import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod/v4";
import { ENV } from "./config.js";

export const TOPICS = [
  "staff_behavior",
  "safety_injury",
  "cleanliness_hygiene",
  "billing_refund",
  "crowding_queue",
  "equipment_rides",
  "food_beverage",
  "pricing_value",
  "booking_membership",
  "birthday_party",
  "socks_entry_policy",
  "other",
];

const ReviewAnalysis = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
  severity: z
    .enum(["none", "low", "medium", "high", "critical"])
    .describe(
      "critical = child injury, safety hazard, or legal threat; high = serious service failure (refund denied, staff misconduct); medium = notable complaint; low = minor gripe inside an otherwise fine review; none = no complaint"
    ),
  topics: z.array(z.enum(TOPICS)).describe("every topic the review touches"),
  language: z
    .string()
    .describe("language of the review: 'english', 'hindi', 'hinglish', or other"),
  summary: z
    .string()
    .describe("one-line summary of the review for the ops ticket, in English"),
  reply: z.string().describe("the reply to post (or draft, if negative), following the brand rules"),
});

// Gemini native JSON schema — mirrors ReviewAnalysis above
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
    severity: { type: "string", enum: ["none", "low", "medium", "high", "critical"] },
    topics: { type: "array", items: { type: "string", enum: TOPICS } },
    language: { type: "string" },
    summary: { type: "string" },
    reply: { type: "string" },
  },
  required: ["sentiment", "severity", "topics", "language", "summary", "reply"],
};

const SYSTEM = `You are the official review-response writer for Jus Jumpin, India's kids' trampoline park and family entertainment centre chain with 20+ locations across India. Parents bring children aged 2-14 for jumping, soft play, arcade games, and birthday parties.

You receive one Google review at a time and produce a structured analysis plus a reply.

Reply rules:
- Mirror the reviewer's language: English review gets English, Hindi gets Hindi, Hinglish gets Hinglish.
- Maximum ~70 words. Warm, energetic, family-first tone. Address the reviewer by first name when available.
- Reference at least one specific detail from their review so it never reads like a template.
- Google policy: never include discounts, offers, promotions, phone numbers, email addresses, or links in the reply.
- Never mention the specific store/location name in the reply body — always say "Jus Jumpin" only, never "Jus Jumpin ABC" or any store suffix.
- Positive reviews: thank them genuinely for visiting Jus Jumpin, reflect their highlight back, invite the family to jump again.
- Negative reviews: open with a genuine apology, name the specific issue, say it has been escalated to the centre manager, and invite them to speak with the centre team on their next visit or via the contact details on our profile. Do not be defensive.
- Injury or safety mentions: express sincere concern for the child's wellbeing and urgency, but never admit fault or liability. Escalate tone of care, not blame.
- Sign off exactly: "– Team Jus Jumpin".

Severity rules: any mention of a child getting hurt, unsafe equipment, or legal action is "critical" regardless of star rating.`;

let _genAI;
function genAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}

/**
 * Classify a review and generate a reply in one structured call.
 * review: { rating: 1-5, comment, reviewerName, storeName }
 */
export async function analyzeReview(review) {
  const userMsg = [
    `Store: Jus Jumpin ${review.storeName}`,
    `Reviewer: ${review.reviewerName || "(anonymous)"}`,
    `Star rating: ${review.rating}/5`,
    `Review text: ${review.comment ? `"""${review.comment}"""` : "(no text — rating only)"}`,
  ].join("\n");

  const model = genAI().getGenerativeModel({
    model: ENV.geminiModel,
    systemInstruction: SYSTEM,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const result = await model.generateContent(userMsg);
  const json = JSON.parse(result.response.text());
  return ReviewAnalysis.parse(json);
}

/**
 * Offline fallback used by the dry run when no GEMINI_API_KEY is set —
 * rating-based routing with template replies, so the pipeline is testable
 * before any credentials exist. Not used in production.
 */
export function analyzeReviewHeuristic(review) {
  const negative = review.rating <= 3;
  return {
    sentiment: negative ? "negative" : "positive",
    severity: negative ? "medium" : "none",
    topics: ["other"],
    language: "english",
    summary: `(heuristic) ${review.rating}-star review`,
    reply: negative
      ? `We're really sorry your visit fell short. This has been escalated to our centre manager, and we'd love the chance to make it right on your next visit. – Team Jus Jumpin`
      : `Thank you so much for the wonderful rating! We can't wait to see the kids bouncing with us again soon. – Team Jus Jumpin`,
  };
}
