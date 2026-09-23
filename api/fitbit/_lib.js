// Shared helpers for the Fitbit OAuth routes.
//
// Why a cookie instead of a database: this is a single-user personal dashboard, so there's
// no need for a real datastore. The refresh token is encrypted (AES-256-GCM) and kept in an
// httpOnly, Secure, SameSite=Lax cookie — never exposed to the page's own JS, never sent to
// any origin but this one. Fitbit rotates refresh tokens on every use (the old one stops
// working the moment a new one is issued), so every route that uses the refresh token must
// re-encrypt and re-set the cookie with whatever new one Fitbit returns.

const crypto = require("crypto");

const COOKIE_NAME = "fb_rt";
const FITBIT_TOKEN_URL = "https://api.fitbit.com/oauth2/token";

function getKey() {
  const secret = process.env.FITBIT_TOKEN_SECRET;
  if (!secret) throw new Error("FITBIT_TOKEN_SECRET env var is not set");
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
  // 1 year — Fitbit refresh tokens don't expire on their own, only on revoke/rotation failure.
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encrypted}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`
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

function basicAuthHeader() {
  const id = process.env.FITBIT_CLIENT_ID;
  const secret = process.env.FITBIT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET env vars are not set");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

// Exchanges a refresh token for a new access token, and returns the (rotated) refresh token
// too — the caller is responsible for re-saving it via setRefreshTokenCookie.
async function refreshAccessToken(refreshToken) {
  const response = await fetch(FITBIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fitbit token refresh failed (${response.status}): ${body}`);
  }

  return response.json(); // { access_token, refresh_token, expires_in, ... }
}

function redirectUriFor(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}/api/fitbit/callback`;
}

module.exports = {
  COOKIE_NAME,
  FITBIT_TOKEN_URL,
  parseCookies,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  getStoredRefreshToken,
  basicAuthHeader,
  refreshAccessToken,
  redirectUriFor,
};
