// Open-Meteo client. One request per coordinate; the caller decides how often.
// No API key, no proxy: the API sends `access-control-allow-origin: *`.

import { SITE } from './config.js';

export const ERROR_CODES = Object.freeze({
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  HTTP: 'http',
  PARSE: 'parse',
  NODATA: 'nodata',
});

const MESSAGES = {
  [ERROR_CODES.NETWORK]:
    'Could not reach the wind data service. Check your internet connection.',
  [ERROR_CODES.TIMEOUT]: 'The wind data service did not answer in time.',
  [ERROR_CODES.HTTP]: 'The wind data service refused the request.',
  [ERROR_CODES.PARSE]: 'The wind data service sent something unreadable.',
  [ERROR_CODES.NODATA]: 'No wind data was returned for that coordinate.',
};

const fail = (code, detail) => ({
  hours: null,
  error: code,
  message: detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code],
});

export function buildUrl(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: SITE.hourlyVars.join(','),
    wind_speed_unit: SITE.windSpeedUnit,
    timeformat: 'unixtime', // unambiguous: seconds since epoch, no local-time guessing
    past_days: String(SITE.pastDays),
    forecast_days: String(SITE.forecastDays),
    timezone: 'UTC',
  });
  return `${SITE.apiBase}?${params.toString()}`;
}

/**
 * Read the hourly wind series for a coordinate.
 * Resolves to { hours: [{t, v100, dir, gust}], error: null, message: null } on success,
 * or { hours: null, error: <code>, message: <human text> } on failure. Never throws.
 */
export async function fetchWind(lat, lon, { fetchImpl = fetch } = {}) {
  const url = buildUrl(lat, lon);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SITE.fetchTimeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) {
        if (res.status >= 500 && attempt === 0) continue; // one retry on server errors
        return fail(ERROR_CODES.HTTP, `HTTP ${res.status}`);
      }
      let payload;
      try {
        payload = await res.json();
      } catch {
        return fail(ERROR_CODES.PARSE);
      }
      const hours = normalise(payload);
      if (!hours || hours.length === 0) return fail(ERROR_CODES.NODATA);
      return { hours, error: null, message: null };
    } catch (err) {
      const timedOut = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
      if (attempt === 0 && !timedOut) continue; // one retry on network failure
      return fail(timedOut ? ERROR_CODES.TIMEOUT : ERROR_CODES.NETWORK);
    } finally {
      clearTimeout(timer);
    }
  }
  return fail(ERROR_CODES.NETWORK);
}

function normalise(payload) {
  const hourly = payload && payload.hourly;
  if (!hourly || !Array.isArray(hourly.time)) return null;
  const speed = hourly.wind_speed_100m || [];
  const dir = hourly.wind_direction_10m || [];
  const gust = hourly.wind_gusts_10m || [];
  const numeric = (value) => (Number.isFinite(value) ? value : null);

  return hourly.time.map((seconds, i) => ({
    t: seconds * 1000,
    v100: numeric(speed[i]),
    dir: numeric(dir[i]),
    gust: numeric(gust[i]),
  }));
}
