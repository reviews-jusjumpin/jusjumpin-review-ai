import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
try { process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env")); } catch {}

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
console.log("client_id:", GOOGLE_CLIENT_ID?.slice(0, 20) + "...");
console.log("client_secret:", GOOGLE_CLIENT_SECRET?.slice(0, 10) + "...");
console.log("refresh_token:", GOOGLE_REFRESH_TOKEN?.slice(0, 20) + "...");

const body = new URLSearchParams({
  client_id: GOOGLE_CLIENT_ID,
  client_secret: GOOGLE_CLIENT_SECRET,
  refresh_token: GOOGLE_REFRESH_TOKEN,
  grant_type: "refresh_token",
});

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  body,
});
const json = await res.json();
console.log("\nResponse status:", res.status);
console.log("Response body:", JSON.stringify(json, null, 2));
