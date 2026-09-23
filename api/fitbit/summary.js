// GET /api/fitbit/summary — called by the dashboard's Fitness tab. Returns today's steps,
// sleep, and resting heart rate, or { connected: false } if Fitbit hasn't been linked yet.
//
// Every call refreshes the access token first (Fitbit access tokens are short-lived, ~8h)
// and Fitbit rotates the refresh token each time one is used, so the stored cookie gets
// re-saved with the new one on every request — an old refresh token stops working the
// moment a newer one has been issued.

const { getStoredRefreshToken, setRefreshTokenCookie, clearRefreshTokenCookie, refreshAccessToken } = require("./_lib");

async function fitbitGet(path, accessToken) {
  const response = await fetch(`https://api.fitbit.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fitbit API ${path} failed (${response.status}): ${body}`);
  }
  return response.json();
}

module.exports = async (req, res) => {
  const storedRefreshToken = getStoredRefreshToken(req);
  if (!storedRefreshToken) {
    res.status(200).json({ connected: false });
    return;
  }

  try {
    const tokens = await refreshAccessToken(storedRefreshToken);
    setRefreshTokenCookie(res, tokens.refresh_token);

    const [activity, sleep, heart] = await Promise.all([
      fitbitGet("/1/user/-/activities/date/today.json", tokens.access_token),
      fitbitGet("/1.2/user/-/sleep/date/today.json", tokens.access_token),
      fitbitGet("/1/user/-/activities/heart/date/today/1d.json", tokens.access_token),
    ]);

    const restingHeartRate = heart["activities-heart"]?.[0]?.value?.restingHeartRate ?? null;
    const sleepMinutes = sleep.summary?.totalMinutesAsleep ?? null;

    res.status(200).json({
      connected: true,
      steps: activity.summary?.steps ?? 0,
      caloriesOut: activity.summary?.caloriesOut ?? 0,
      activeMinutes: (activity.summary?.fairlyActiveMinutes ?? 0) + (activity.summary?.veryActiveMinutes ?? 0),
      sleepHours: sleepMinutes !== null ? Math.round((sleepMinutes / 60) * 10) / 10 : null,
      restingHeartRate,
    });
  } catch (err) {
    // A refresh failure usually means the token was revoked (e.g. Daniel disconnected the
    // app from Fitbit's own settings) — clear the dead cookie so the UI offers to reconnect
    // instead of erroring forever.
    clearRefreshTokenCookie(res);
    res.status(502).json({ connected: false, error: err.message });
  }
};
