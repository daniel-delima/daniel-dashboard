// GET /api/fitbit/login — starts the Google Health API OAuth flow (Google login, not Fitbit's
// own login page — Fitbit's Web API is being retired, see _lib.js).

const crypto = require("crypto");
const { redirectUriFor, clientCreds, GOOGLE_AUTH_URL, SCOPES } = require("./_lib");

module.exports = (req, res) => {
  let clientId;
  try {
    ({ id: clientId } = clientCreds());
  } catch (e) {
    res.status(500).send("Server is missing GOOGLE_HEALTH_CLIENT_ID — set it in the Vercel project's environment variables.");
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `gh_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor(),
    response_type: "code",
    access_type: "offline", // required to get a refresh token back
    prompt: "consent",      // forces a refresh token every time (needed since Testing-mode tokens expire weekly)
    scope: SCOPES,
    state,
  });

  res.writeHead(302, { Location: `${GOOGLE_AUTH_URL}?${params.toString()}` });
  res.end();
};
