import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
try { process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env")); } catch {}

import { googleAuth } from "../src/google-auth.js";

const { GBP_ACCOUNT_ID } = process.env;
const auth = googleAuth();

// Fetch ALL locations with name + title
let pageToken = "";
let all = [];
do {
  const url = `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${GBP_ACCOUNT_ID}/locations?readMask=name,title,storefrontAddress&pageSize=100${pageToken ? "&pageToken=" + pageToken : ""}`;
  const res = await auth.request({ url, method: "GET" });
  const data = res.data;
  all.push(...(data.locations || []));
  pageToken = data.nextPageToken || "";
} while (pageToken);

console.log(`Total locations: ${all.length}\n`);
for (const loc of all) {
  const id = loc.name.split("/").pop();
  const city = loc.storefrontAddress?.locality || "";
  console.log(`${loc.title} | ${city} | ${loc.name}`);
}
