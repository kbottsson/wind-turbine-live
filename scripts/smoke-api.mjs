// Live smoke test for the Open-Meteo client. Hits the real API — needs internet.
//   npm run smoke:api
// Prints the normalised series for a land coordinate and for a mid-ocean coordinate,
// because the second one is a case the UI must survive rather than crash on.

import { fetchWind } from '../src/api.js';
import { rotorStateForWind, sampleHourly } from '../src/wind-model.js';

const CASES = [
  { label: 'Berlin (land)', lat: 52.52, lon: 13.405 },
  { label: 'mid-Pacific (ocean)', lat: 0, lon: -140 },
  { label: 'mid-Atlantic offshore', lat: 47.0, lon: -20.0 },
];

let failures = 0;

for (const c of CASES) {
  const result = await fetchWind(c.lat, c.lon);
  if (result.error) {
    failures += 1;
    console.log(`${c.label}: FAILED — ${result.error}: ${result.message}`);
    continue;
  }
  const now = sampleHourly(result.hours, new Date());
  const state = rotorStateForWind(now ? now.v100 : null);
  console.log(
    `${c.label}: ${result.hours.length} hourly samples | ` +
      `now v100=${now.v100} m/s dir=${now.dir}° gust=${now.gust} m/s | ` +
      `-> ${state.rpm.toFixed(2)} rpm, ${(state.power / 1e6).toFixed(2)} MW, ${state.state}`,
  );
}

console.log(failures === 0 ? '\nOK: every case returned usable data.' : `\n${failures} case(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
