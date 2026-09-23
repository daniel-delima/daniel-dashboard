// GET /api/fitbit/login — starts the Google Health API OAuth flow (Google login, not Fitbit's
// own login page — Fitbit's Web API is being retired, see _lib.js).

const crypto = require("crypto");
const { redirectUriFor, clientCreds, GOOGLE_AUTH_URL, SCOPES, isNonCanonicalHost, CANONICAL_HOST } = require("./_lib");

module.exports = (req, res) => {
  // Bounce to the canonical host first if we're not already on it — otherwise the CSRF state
  // cookie we're about to set would live on the wrong origin and the callback (which always
  // runs on the canonical host, see redirectUriFor) would never see it.
  if (isNonCanonicalHost(req)) {
    res.writeHead(302, { Location: `https://${CANONICAL_HOST}/api/fitbit/login` });
    res.end();
    return;
  }

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
