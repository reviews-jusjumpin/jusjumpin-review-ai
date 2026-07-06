import { OAuth2Client } from "google-auth-library";

let _auth;

/** Shared OAuth2 client (Business Profile + Sheets scopes on one refresh token). */
export function googleAuth() {
  if (!_auth) {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
      throw new Error("Google OAuth env vars missing — see .env.example and run `npm run get-token`");
    }
    _auth = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    _auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  }
  return _auth;
}

/** Authorized JSON request against any Google REST API. */
export async function gfetch(url, options = {}) {
  const res = await googleAuth().request({ url, ...options });
  return res.data;
}
