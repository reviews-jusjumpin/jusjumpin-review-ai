/**
 * One-time helper: obtain a Google OAuth refresh token with the Business
 * Profile + Sheets scopes, using the loopback flow.
 *
 *   1. In Google Cloud Console create an OAuth client of type "Desktop app".
 *   2. Put GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env.
 *   3. Run: npm run get-token
 *   4. Sign in with the Google account that owns/manages the location group.
 *   5. Copy the printed refresh token into .env as GOOGLE_REFRESH_TOKEN.
 */
import http from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";

try {
  process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env"));
} catch { /* fine */ }

const SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/spreadsheets",
];

const PORT = 53682;
const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `http://127.0.0.1:${PORT}`
);

const authUrl = client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // force a refresh token even if previously consented
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const code = url.searchParams.get("code");
  if (!code) { res.end("Waiting for Google redirect..."); return; }
  const { tokens } = await client.getToken(code);
  res.end("Done — you can close this tab and return to the terminal.");
  server.close();
  const token = tokens.refresh_token;
  console.log("\nAdd this to your .env:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${token}\n`);
  // also save to temp file so it can be read programmatically
  import("node:fs").then(({ writeFileSync }) =>
    writeFileSync("C:\\Users\\admin\\AppData\\Local\\Temp\\jj-token.txt", token || "")
  );
});

server.listen(PORT, () => {
  console.log("Open this URL in your browser and sign in:\n");
  console.log(authUrl + "\n");
});
