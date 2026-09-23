// GET /api/fitbit/summary — called by the dashboard's Fitness tab. Returns today's steps,
// floors, distance, active zone minutes, last night's sleep (+ efficiency), today's resting
// heart rate and HRV, and this week's (Mon-Sun) total steps — or { connected: false } if not
// linked.
//
// Endpoints/fields below were confirmed directly against the Google Health API reference
// (developers.google.com/health/reference/rest/v4) on 2026-09-23 — this is a brand new API
// (replacing the retiring Fitbit Web API), so nothing here could be verified against prior
// knowledge, only the live docs. Deliberately NOT included: a "readiness" score — that's
// Fitbit's own proprietary Premium-only computed metric and isn't exposed by this API at all
// (confirmed by searching the full data-types list); Daniel was asked whether he wanted an
// unofficial estimate built from the other numbers instead and didn't opt in, so it's just
// left out rather than faked. Also not included: total-calories — its rollup has an unusual
// extra required-filter quirk noted in its own docs page that the other rollups don't have,
// skipped for now to avoid another guess-and-fix round; worth adding properly later if wanted.
//
// Known limitation: "today"/"this week" are computed from the server's UTC clock, not
// Daniel's actual timezone — close enough for now, but could be off by a few hours right
// around midnight UK time. Revisit if that turns out to matter in practice.

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

function dailyRollup(dataType, accessToken, start, end, windowSizeDays) {
  return healthApi(`/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      range: { start: { date: civilDate(start) }, end: { date: civilDate(end) } },
      windowSizeDays,
    }),
  });
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

    // This week's Monday-Sunday range (UTC day-of-week: 0=Sun..6=Sat).
    const daysSinceMonday = (today.getUTCDay() + 6) % 7;
    const monday = new Date(today);
    monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
    const nextMonday = new Date(monday);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);

    const [stepsData, floorsData, distanceData, azmData, sleepData, heartData, hrvData, weekStepsData] = await Promise.all([
      dailyRollup("steps", accessToken, today, tomorrow, 1),
      dailyRollup("floors", accessToken, today, tomorrow, 1),
      dailyRollup("distance", accessToken, today, tomorrow, 1),
      dailyRollup("active-zone-minutes", accessToken, today, tomorrow, 1),
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
      healthApi(
        `/users/me/dataTypes/daily-heart-rate-variability/dataPoints?filter=${encodeURIComponent(
          `daily_heart_rate_variability.date >= "${todayStr}" AND daily_heart_rate_variability.date < "${tomorrowStr}"`
        )}`,
        accessToken
      ),
      dailyRollup("steps", accessToken, monday, nextMonday, 7),
    ]);

    const steps = Number(stepsData.rollupDataPoints?.[0]?.steps?.countSum ?? 0);
    const floors = Number(floorsData.rollupDataPoints?.[0]?.floors?.countSum ?? 0);
    const distanceKm = Math.round((Number(distanceData.rollupDataPoints?.[0]?.distance?.millimetersSum ?? 0) / 1e6) * 100) / 100;

    const azm = azmData.rollupDataPoints?.[0]?.activeZoneMinutes;
    const activeZoneMinutes = azm
      ? Number(azm.sumInCardioHeartZone ?? 0) + Number(azm.sumInPeakHeartZone ?? 0) + Number(azm.sumInFatBurnHeartZone ?? 0)
      : 0;

    const sleepSummary = sleepData.dataPoints?.[0]?.sleep?.summary;
    const minutesAsleep = sleepSummary?.minutesAsleep;
    const sleepHours = minutesAsleep !== undefined ? Math.round((Number(minutesAsleep) / 60) * 10) / 10 : null;
    const sleepEfficiency =
      sleepSummary?.minutesInSleepPeriod && Number(sleepSummary.minutesInSleepPeriod) > 0
        ? Math.round((Number(minutesAsleep) / Number(sleepSummary.minutesInSleepPeriod)) * 100)
        : null;

    const restingHeartRateRaw = heartData.dataPoints?.[0]?.dailyRestingHeartRate?.beatsPerMinute;
    const restingHeartRate = restingHeartRateRaw !== undefined ? Number(restingHeartRateRaw) : null;

    const hrvRaw = hrvData.dataPoints?.[0]?.dailyHeartRateVariability?.averageHeartRateVariabilityMilliseconds;
    const hrv = hrvRaw !== undefined ? Math.round(Number(hrvRaw)) : null;

    const weeklySteps = Number(weekStepsData.rollupDataPoints?.[0]?.steps?.countSum ?? 0);

    res.status(200).json({
      connected: true,
      steps,
      floors,
      distanceKm,
      activeZoneMinutes,
      sleepHours,
      sleepEfficiency,
      restingHeartRate,
      hrv,
      weeklySteps,
    });
  } catch (err) {
    // A data-query failure (bad filter, transient API error, etc.) — the login itself is
    // still good, so don't clear the cookie here, just report the error and let the user
    // retry without having to reconnect.
    res.status(502).json({ connected: true, error: err.message });
  }
};
