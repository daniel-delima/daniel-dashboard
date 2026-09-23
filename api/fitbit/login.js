// GET /api/fitbit/login — starts the Fitbit OAuth flow. The dashboard's "Connect Fitbit"
// button just links here directly (a normal navigation, not a fetch), since this needs to
// redirect the whole page to Fitbit's own login/consent screen.

const crypto = require("crypto");
const { redirectUriFor } = require("./_lib");

module.exports = (req, res) => {
  const clientId = process.env.FITBIT_CLIENT_ID;
  if (!clientId) {
    res.status(500).send("Server is missing FITBIT_CLIENT_ID — set it in the Vercel project's environment variables.");
    return;
  }

  // CSRF guard: a random value we can check matches when Fitbit redirects back.
  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `fb_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
  );

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUriFor(req),
    scope: "activity heartrate sleep profile",
    state,
  });

  res.writeHead(302, { Location: `https://www.fitbit.com/oauth2/authorize?${params.toString()}` });
  res.end();
};
