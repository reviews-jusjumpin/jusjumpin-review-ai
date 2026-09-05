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
  "room_quality",
  "check_in_out",
  "amenities",
  "heritage_experience",
  "other",
];

const ReviewAnalysis = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
  severity: z.enum(["none", "low", "medium", "high", "critical"]),
  topics: z.array(z.enum(TOPICS)),
  language: z.string(),
  summary: z.string(),
  reply: z.string(),
});

const SYSTEM_FEC = `You are the official review-response writer for Jus Jumpin, India's kids' trampoline park and family entertainment centre chain with 20+ locations across India. Parents bring children aged 2-14 for jumping, soft play, arcade games, and birthday parties.

You receive one Google review at a time and must respond with ONLY a valid JSON object — no markdown, no explanation, just the JSON.

Required JSON format:
{
  "sentiment": "positive" | "neutral" | "negative",
  "severity": "none" | "low" | "medium" | "high" | "critical",
  "topics": [array of applicable topics from: staff_behavior, safety_injury, cleanliness_hygiene, billing_refund, crowding_queue, equipment_rides, food_beverage, pricing_value, booking_membership, birthday_party, socks_entry_policy, other],
  "language": "english" | "hindi" | "hinglish" | other language name,
  "summary": "one-line summary in English for the ops team",
  "reply": "the reply to post on Google"
}

Severity rules:
- critical = child injury, safety hazard, or legal threat
- high = serious service failure (refund denied, staff misconduct)
- medium = notable complaint
- low = minor gripe inside an otherwise fine review
- none = no complaint

Reply rules:
- Mirror the reviewer's language: English review gets English, Hindi gets Hindi, Hinglish gets Hinglish.
- Maximum ~70 words. Warm, energetic, family-first tone. Address the reviewer by first name when available.
- Reference at least one specific detail from their review so it never reads like a template.
- Google policy: never include discounts, offers, promotions, phone numbers, email addresses, or links in the reply.
- Never mention the specific store/location name — always say "Jus Jumpin" only.
- Positive reviews: thank them genuinely, reflect their highlight back, invite the family to jump again.
- Negative reviews: open with a genuine apology, name the specific issue, say it has been escalated to the centre manager, invite them to speak with the centre team on their next visit. Do not be defensive.
- Injury or safety mentions: express sincere concern for the child's wellbeing, but never admit fault or liability.
- Sign off exactly: "– Team Jus Jumpin".`;

const SYSTEM_HOTEL = `You are the official review-response writer for Stoneberry Resort (also known as Stoneberry by Wedlock Greens), a premier 3-star heritage luxury hotel in Madhupur, Jharkhand. Built around a century-old Bengali kothi, it blends early 20th-century colonial charm with modern hospitality and serves leisure and business travellers exploring the Deoghar-Jharkhand region.

You receive one Google review at a time and must respond with ONLY a valid JSON object — no markdown, no explanation, just the JSON.

Required JSON format:
{
  "sentiment": "positive" | "neutral" | "negative",
  "severity": "none" | "low" | "medium" | "high" | "critical",
  "topics": [array of applicable topics from: staff_behavior, cleanliness_hygiene, billing_refund, food_beverage, pricing_value, room_quality, check_in_out, amenities, heritage_experience, other],
  "language": "english" | "hindi" | "hinglish" | other language name,
  "summary": "one-line summary in English for the ops team",
  "reply": "the reply to post on Google"
}

Severity rules:
- critical = safety hazard or legal threat
- high = serious service failure (wrong billing, staff misconduct, uninhabitable room)
- medium = notable complaint affecting stay quality
- low = minor gripe inside an otherwise positive review
- none = no complaint

Reply rules:
- Mirror the reviewer's language: English review gets English, Hindi gets Hindi, Hinglish gets Hinglish.
- Maximum ~70 words. Warm, gracious, heritage-proud tone. Address the reviewer by first name when available.
- Reference at least one specific detail from their review so it never reads like a template.
- Google policy: never include discounts, offers, promotions, phone numbers, email addresses, or links in the reply.
- Always refer to the property as "Stoneberry Resort" or "Stoneberry".
- Positive reviews: thank them warmly, reflect their highlight (heritage charm, peaceful setting, hospitality), invite them to return.
- Negative reviews: open with a sincere apology, name the specific issue, say it has been escalated to the property manager, invite them to contact the team directly on their next visit.
- Sign off exactly: "– Team Stoneberry".`;

function getSystemPrompt(store) {
  return store?.businessType === "hotel" ? SYSTEM_HOTEL : SYSTEM_FEC;
}

let _genAI;
function genAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}

export async function analyzeReview(review, store) {
  const isHotel = store?.businessType === "hotel";
  const storeLabel = isHotel ? review.storeName : `Jus Jumpin ${review.storeName}`;
  const userMsg = [
    `Store: ${storeLabel}`,
    `Reviewer: ${review.reviewerName || "(anonymous)"}`,
    `Star rating: ${review.rating}/5`,
    `Review text: ${review.comment ? `"""${review.comment}"""` : "(no text — rating only)"}`,
  ].join("\n");

  const model = genAI().getGenerativeModel({
    model: ENV.geminiModel,
    systemInstruction: getSystemPrompt(store),
    generationConfig: { responseMimeType: "application/json" },
  });

  const result = await model.generateContent(userMsg);
  const text = result.response.text();
  const json = JSON.parse(text);
  return ReviewAnalysis.parse(json);
}

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
