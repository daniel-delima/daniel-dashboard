// POST /api/site-login — checks the shared site password (from login.html's form) and, if
// correct, sets the cookie that middleware.js checks on every other request. This is the
// site-wide gate, separate from and outside of Fitbit's own OAuth login.
//
// Lockout: 4+ wrong attempts locks out further tries for 15 minutes. This is cookie-based,
// not a real server-side rate limit (there's no database in this project) — it stops casual
// repeated guessing, but someone could reset their attempt count by clearing cookies or
// switching browsers. A real IP-based limit would need a shared store like Vercel KV; not
// worth the extra infrastructure for a personal dashboard's password gate.

const crypto = require("crypto");

const LOCK_THRESHOLD = 4;
const LOCK_MINUTES = 15;

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header.split(";").filter(Boolean).map((pair) => {
      const [k, ...v] = pair.trim().split("=");
      return [k, decodeURIComponent(v.join("="))];
    })
  );
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const cookies = parseCookies(req);
  const lockUntil = Number(cookies.site_lock_until || 0);

  if (lockUntil && Date.now() < lockUntil) {
    const minsLeft = Math.ceil((lockUntil - Date.now()) / 60000);
    res.writeHead(302, { Location: `/login.html?error=locked&mins=${minsLeft}` });
    res.end();
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  const submitted = new URLSearchParams(body).get("password") || "";

  if (submitted !== process.env.SITE_PASSWORD) {
    const failCount = Number(cookies.site_fail || 0) + 1;
    const cookiesToSet = [`site_fail=${failCount}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`];

    if (failCount >= LOCK_THRESHOLD) {
      const until = Date.now() + LOCK_MINUTES * 60 * 1000;
      cookiesToSet.push(`site_lock_until=${until}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${LOCK_MINUTES * 60}`);
    }

    res.setHeader("Set-Cookie", cookiesToSet);
    res.writeHead(302, {
      Location: failCount >= LOCK_THRESHOLD ? `/login.html?error=locked&mins=${LOCK_MINUTES}` : "/login.html?error=1",
    });
    res.end();
    return;
  }

  const token = crypto
    .createHash("sha256")
    .update(`${process.env.SITE_PASSWORD}:${process.env.SITE_AUTH_SECRET}`)
    .digest("hex");

  res.setHeader("Set-Cookie", [
    `site_auth=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`, // 30 days
    "site_fail=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
    "site_lock_until=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
  ]);
  res.writeHead(302, { Location: "/" });
  res.end();
};
