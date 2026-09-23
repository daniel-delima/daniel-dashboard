// GET /api/fitbit/callback — where Google redirects back to after you approve access.
// Exchanges the one-time code for tokens, stores the refresh token, sends you back to the
// dashboard's Fitness tab.

const { parseCookies, setRefreshTokenCookie, clientCreds, redirectUriFor, GOOGLE_TOKEN_URL } = require("./_lib");

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    res.status(400).send(`Google sign-in was cancelled or failed: ${error}`);
    return;
  }

  const cookies = parseCookies(req);
  if (!code || !state || state !== cookies.gh_state) {
    res.status(400).send("Sign-in failed a security check (missing/mismatched state). Try connecting again.");
    return;
  }

  try {
    const { id, secret } = clientCreds();
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        code,
        redirect_uri: redirectUriFor(req),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      throw new Error(`Google token exchange failed (${tokenResponse.status}): ${body}`);
    }

    const tokens = await tokenResponse.json();
    if (!tokens.refresh_token) {
      throw new Error("Google didn't return a refresh token — this can happen on a repeat login without prompt=consent. Try connecting again.");
    }
    setRefreshTokenCookie(res, tokens.refresh_token);

    res.setHeader("Set-Cookie", [
      res.getHeader("Set-Cookie"),
      "gh_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
    ]);

    res.writeHead(302, { Location: "/?fitbit=connected" });
    res.end();
  } catch (err) {
    res.status(500).send(`Something went wrong connecting your Google Health account: ${err.message}`);
  }
};
