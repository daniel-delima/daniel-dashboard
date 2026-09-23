// Shared helpers for the Fitness routes — talks to the Google Health API (the successor to
// the legacy Fitbit Web API, which Google is retiring; see developers.google.com/health).
//
// Auth is now standard Google OAuth 2.0, not a Fitbit-issued token. Why a cookie instead of
// a database: this is a single-user personal dashboard, so there's no need for a real
// datastore. The refresh token is encrypted (AES-256-GCM) and kept in an httpOnly, Secure,
// SameSite=Lax cookie — never exposed to the page's own JS, never sent to any origin but
// this one.
//
// Known limitation: while the Google Cloud OAuth client is in "Testing" publishing status
// (the default, and fine for a single personal user), Google issues refresh tokens that
// expire after 7 days — so Daniel will need to click "Connect" again about once a week.
// That's expected, not a bug; moving to "In Production" would need Google's app-verification
// review, which isn't worth it for a personal project touching sensitive health scopes.

const crypto = require("crypto");

const COOKIE_NAME = "gh_rt";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const HEALTH_API_BASE = "https://health.googleapis.com/v4";

const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
].join(" ");

function getKey() {
  const secret = process.env.HEALTH_TOKEN_SECRET;
  if (!secret) throw new Error("HEALTH_TOKEN_SECRET env var is not set");
  return crypto.createHash("sha256").update(secret).digest(); // 32 bytes for AES-256
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

function decrypt(payload) {
  const raw = Buffer.from(payload, "base64url");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header.split(";").filter(Boolean).map((pair) => {
      const [k, ...v] = pair.trim().split("=");
      return [k, decodeURIComponent(v.join("="))];
    })
  );
}

function setRefreshTokenCookie(res, refreshToken) {
  const encrypted = encrypt(refreshToken);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encrypted}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800` // 7 days, matches Testing-mode token life
  );
}

function clearRefreshTokenCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

function getStoredRefreshToken(req) {
  const cookies = parseCookies(req);
  if (!cookies[COOKIE_NAME]) return null;
  try {
    return decrypt(cookies[COOKIE_NAME]);
  } catch (e) {
    return null; // corrupt/old-key cookie — treat as not connected
  }
}

function clientCreds() {
  const id = process.env.GOOGLE_HEALTH_CLIENT_ID;
  const secret = process.env.GOOGLE_HEALTH_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_HEALTH_CLIENT_ID / GOOGLE_HEALTH_CLIENT_SECRET env vars are not set");
  return { id, secret };
}

// Exchanges a refresh token for a new access token. Google does NOT rotate refresh tokens
// on every use (unlike Fitbit's old API) — the same refresh token keeps working until it
// expires (7 days in Testing mode) or is revoked, so we don't need to re-save the cookie
// after every refresh, only after the initial login.
async function refreshAccessToken(refreshToken) {
  const { id, secret } = clientCreds();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google token refresh failed (${response.status}): ${body}`);
  }

  return response.json(); // { access_token, expires_in, scope, token_type }
}

// Fixed, not derived from the request host — Vercel serves the same deployment from several
// URLs (the stable production domain, a per-deployment alias with a random hash, a git-branch
// alias, ...), and Google only accepts the exact redirect URI registered in Cloud Console.
// Deriving this from req.headers.host broke as soon as Daniel visited via a non-canonical
// alias (e.g. the Vercel dashboard's "Visit" button, which can land on the per-deployment
// URL). Keep this in sync with the "Authorized redirect URIs" entry in Google Cloud Console.
const CANONICAL_HOST = "daniel-dashboard-orpin.vercel.app";

function redirectUriFor() {
  return `https://${CANONICAL_HOST}/api/fitbit/callback`;
}

// True if this request did NOT come in on the canonical host — e.g. Daniel followed a Vercel
// per-deployment link instead of the stable URL. login.js uses this to bounce over to the
// canonical host *before* setting the CSRF state cookie, so the cookie that gets set and the
// cookie the callback checks are always on the same origin (cookies don't cross hostnames,
// even between aliases of the same deployment).
function isNonCanonicalHost(req) {
  return req.headers.host !== CANONICAL_HOST;
}

// YYYY-MM-DD in a given timezone offset (minutes), defaulting to UTC — good enough for
// "today"/"yesterday" boundaries without pulling in a date library.
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = {
  COOKIE_NAME,
  GOOGLE_TOKEN_URL,
  GOOGLE_AUTH_URL,
  HEALTH_API_BASE,
  SCOPES,
  parseCookies,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  getStoredRefreshToken,
  clientCreds,
  refreshAccessToken,
  redirectUriFor,
  isNonCanonicalHost,
  CANONICAL_HOST,
  isoDate,
};
