// GET /api/fitbit/summary — called by the dashboard's Fitness tab. Returns today's steps,
// last night's sleep, and today's resting heart rate, or { connected: false } if not linked.
//
// Endpoints/fields below were confirmed directly against the Google Health API reference
// (developers.google.com/health/reference/rest/v4) on 2026-09-23 — this is a brand new API
// (replacing the retiring Fitbit Web API), so nothing here could be verified against prior
// knowledge, only the live docs.
//
// Known limitation: "today" is computed from the server's UTC clock, not Daniel's actual
// timezone — close enough for now, but could be off by a few hours right around midnight UK
// time. Revisit if that turns out to matter in practice.

const { getStoredRefreshToken, clearRefreshTokenCookie, refreshAccessToken, HEALTH_API_BASE } = require("./_lib");

function civilDate(d) {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

async function healthApi(path, accessToken, options = {}) {
  const response = await fetch(`${HEALTH_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Health API ${path} failed (${response.status}): ${body}`);
  }
  return response.json();
}

module.exports = async (req, res) => {
  const storedRefreshToken = getStoredRefreshToken(req);
  if (!storedRefreshToken) {
    res.status(200).json({ connected: false });
    return;
  }

  let accessToken;
  try {
    ({ access_token: accessToken } = await refreshAccessToken(storedRefreshToken));
  } catch (err) {
    // This specifically means the login itself is dead (expired/revoked) — only here is it
    // correct to clear the cookie and send the user back to "Connect Fitbit".
    clearRefreshTokenCookie(res);
    res.status(502).json({ connected: false, error: err.message });
    return;
  }

  try {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const todayStr = today.toISOString().slice(0, 10);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const [stepsData, sleepData, heartData] = await Promise.all([
      healthApi("/users/me/dataTypes/steps/dataPoints:dailyRollUp", accessToken, {
        method: "POST",
        body: JSON.stringify({
          range: { start: { date: civilDate(today) }, end: { date: civilDate(tomorrow) } },
          windowSizeDays: 1,
        }),
      }),
      healthApi(
        `/users/me/dataTypes/sleep/dataPoints?pageSize=5&filter=${encodeURIComponent(
          `sleep.interval.civil_end_time >= "${todayStr}" AND sleep.interval.civil_end_time < "${tomorrowStr}"`
        )}`,
        accessToken
      ),
      healthApi(
        `/users/me/dataTypes/daily-resting-heart-rate/dataPoints?filter=${encodeURIComponent(
          `daily_resting_heart_rate.date >= "${todayStr}" AND daily_resting_heart_rate.date < "${tomorrowStr}"`
        )}`,
        accessToken
      ),
    ]);

    const steps = Number(stepsData.rollupDataPoints?.[0]?.steps?.countSum ?? 0);
    const minutesAsleep = sleepData.dataPoints?.[0]?.sleep?.summary?.minutesAsleep;
    const sleepHours = minutesAsleep !== undefined ? Math.round((Number(minutesAsleep) / 60) * 10) / 10 : null;
    const restingHeartRateRaw = heartData.dataPoints?.[0]?.dailyRestingHeartRate?.beatsPerMinute;
    const restingHeartRate = restingHeartRateRaw !== undefined ? Number(restingHeartRateRaw) : null;

    res.status(200).json({ connected: true, steps, sleepHours, restingHeartRate });
  } catch (err) {
    // A data-query failure (bad filter, transient API error, etc.) — the login itself is
    // still good, so don't clear the cookie here, just report the error and let the user
    // retry without having to reconnect.
    res.status(502).json({ connected: true, error: err.message });
  }
};
