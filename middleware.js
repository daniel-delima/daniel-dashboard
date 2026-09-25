// Runs on every request to this deployment (Vercel Edge Middleware — auto-detected because
// this file sits at the project root, no config needed). Blocks the entire site — every page
// and every /api route, including the Fitbit ones — behind a single shared password, so
// finding the URL alone isn't enough to see anything.
//
// The cookie holds a SHA-256 hash derived from SITE_PASSWORD + SITE_AUTH_SECRET, not the
// password itself — same pattern as the Fitbit refresh-token cookie in api/fitbit/_lib.js,
// just simpler since there's nothing to decrypt, only to compare.

const COOKIE_NAME = "site_auth";

async function expectedToken() {
  const data = new TextEncoder().encode(`${process.env.SITE_PASSWORD}:${process.env.SITE_AUTH_SECRET}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default async function middleware(req) {
  const url = new URL(req.url);

  // The login page itself and the endpoint that checks the password must stay reachable,
  // or nobody could ever get past the gate.
  if (url.pathname === "/login.html" || url.pathname === "/api/site-login") {
    return;
  }

  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/site_auth=([^;]+)/);
  const token = match ? match[1] : null;

  if (token && token === (await expectedToken())) {
    return; // correct cookie — let the request through
  }

  return Response.redirect(new URL("/login.html", req.url), 302);
}
