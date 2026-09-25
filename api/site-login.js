// POST /api/site-login — checks the shared site password (from login.html's form) and, if
// correct, sets the cookie that middleware.js checks on every other request. This is the
// site-wide gate, separate from and outside of Fitbit's own OAuth login.

const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  const submitted = new URLSearchParams(body).get("password") || "";

  if (submitted !== process.env.SITE_PASSWORD) {
    res.writeHead(302, { Location: "/login.html?error=1" });
    res.end();
    return;
  }

  const token = crypto
    .createHash("sha256")
    .update(`${process.env.SITE_PASSWORD}:${process.env.SITE_AUTH_SECRET}`)
    .digest("hex");

  res.setHeader(
    "Set-Cookie",
    `site_auth=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` // 30 days
  );
  res.writeHead(302, { Location: "/" });
  res.end();
};
