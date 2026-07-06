import { ENV } from "./config.js";

const GRAPH = "https://graph.facebook.com/v21.0";

async function send(to, payload) {
  const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
  });
  if (!res.ok) {
    throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/**
 * Alert the store manager + central ops about a negative-review ticket.
 * Uses the pre-approved template if WHATSAPP_TEMPLATE is set (required for
 * business-initiated messages outside a 24h session); falls back to text.
 *
 * Template "review_alert" should be created in Meta Business Manager with body:
 *   "⚠️ New {{1}}★ review at Jus Jumpin {{2}} — Ticket {{3}}: {{4}}.
 *    Open the ticket sheet, edit the draft reply and set Status=APPROVED."
 */
export async function alertTicket(store, ticket) {
  const recipients = [store.managerWhatsApp, ENV.opsWhatsApp].filter(Boolean);
  if (recipients.length === 0) return { skipped: "no recipients configured" };

  const template = process.env.WHATSAPP_TEMPLATE;
  const results = [];
  for (const to of recipients) {
    const payload = template
      ? {
          type: "template",
          template: {
            name: template,
            language: { code: "en" },
            components: [{
              type: "body",
              parameters: [
                { type: "text", text: String(ticket.rating) },
                { type: "text", text: ticket.store },
                { type: "text", text: ticket.ticketId },
                { type: "text", text: ticket.summary.slice(0, 200) },
              ],
            }],
          },
        }
      : {
          type: "text",
          text: {
            body:
              `⚠️ New ${ticket.rating}★ review at Jus Jumpin ${ticket.store}\n` +
              `Ticket ${ticket.ticketId} (${ticket.severity})\n${ticket.summary}\n\n` +
              `Edit the draft reply in the ticket sheet and set Status=APPROVED to post it.`,
          },
        };
    results.push(await send(to, payload));
  }
  return results;
}
