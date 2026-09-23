// GET /api/fitbit/callback — where Fitbit redirects back to after you approve the login.
// Exchanges the one-time code for tokens, stores the refresh token, sends you back to the
// dashboard itself.

const { parseCookies, setRefreshTokenCookie, basicAuthHeader, redirectUriFor, FITBIT_TOKEN_URL } = require("./_lib");

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    res.status(400).send(`Fitbit sign-in was cancelled or failed: ${error}`);
    return;
  }

  const cookies = parseCookies(req);
  if (!code || !state || state !== cookies.fb_state) {
    res.status(400).send("Fitbit sign-in failed a security check (missing/mismatched state). Try connecting again.");
    return;
  }

  try {
    const tokenResponse = await fetch(FITBIT_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUriFor(req),
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      throw new Error(`Fitbit token exchange failed (${tokenResponse.status}): ${body}`);
    }

    const tokens = await tokenResponse.json();
    setRefreshTokenCookie(res, tokens.refresh_token);

    // Clear the one-time state cookie now that it's served its purpose.
    res.setHeader("Set-Cookie", [
      res.getHeader("Set-Cookie"),
      "fb_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
    ]);

    res.writeHead(302, { Location: "/?fitbit=connected" });
    res.end();
  } catch (err) {
    res.status(500).send(`Something went wrong connecting Fitbit: ${err.message}`);
  }
};
