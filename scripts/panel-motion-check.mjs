// The panel's motion, asserted rather than eyeballed.
//
// lite.html paints into a canvas, so its DOM says nothing about whether the rotor turned, and the
// two ways this panel has actually failed are both invisible in a single screenshot:
//
//   1. The platform's "reduce motion" preference stopped the loop, so the rotor never moved while
//      the readings still refreshed on the hour (a kiosk tablet with its UI animations switched off
//      reports that preference, and Chromium derives it from exactly that setting).
//   2. The drawn angle was in radians while the drawing code wanted degrees, so the rotor turned 57x
//      too slowly — about one revolution every seven minutes, which reads as standing still.
//
// This runs tests/panel-motion.html in headless Chrome twice — once with the reduced-motion
// preference forced on — and fails unless the rotor turns and the panel repaints in both runs, at
// the cadence the code documents.
//
//   node scripts/panel-motion-check.mjs [port] [page]
//
// Requires the local server (./run.sh) to be running, as scripts/shots.sh does.

import { execFileSync } from 'node:child_process';

const PORT = process.argv[2] || '8080';
const PAGE = process.argv[3] || 'lite.html?px=2&wind=8&dir=260';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = `http://localhost:${PORT}`;
const HARNESS = `${BASE}/tests/panel-motion.html?page=${encodeURIComponent(PAGE)}`;

/**
 * The rotor's expected turn comes from the rpm the page reports, not from the demo wind speed: 8 m/s
 * gives 11.03 rpm, and deriving the expectation from the wrong one is the same class of mistake that
 * let a 57x-too-slow rotor pass earlier checks.
 */
const SAMPLE_SECONDS = 1.4;
const RUNS = [
  { name: 'normal', flags: [], reduced: false, cadenceMs: 1000 / 12 },
  { name: 'reduced motion', flags: ['--force-prefers-reduced-motion'], reduced: true, cadenceMs: 1000 / 4 },
];

function domWithFlags(flags) {
  return execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      ...flags,
      '--virtual-time-budget=8000',
      '--window-size=900,700',
      '--dump-dom',
      HARNESS,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
}

function reportFrom(dom) {
  const match = dom.match(/panel-motion (\{[^\n]*\})/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

let failures = 0;
const lines = [];

for (const run of RUNS) {
  let report = null;
  try {
    report = reportFrom(domWithFlags(run.flags));
  } catch (err) {
    report = null;
  }

  const problems = [];
  if (!report) {
    problems.push('the harness reported nothing');
  } else if (report.error) {
    problems.push(report.error);
  } else {
    const turned = report.moved;
    const expectedTurn = report.second.rpm * 6 * SAMPLE_SECONDS;
    if (!(report.second.rpm > 0.5)) {
      problems.push(`the machine was not turning at all (${report.second.rpm.toFixed(2)} rpm)`);
    }
    if (!(Math.abs(turned - expectedTurn) < Math.max(2, expectedTurn * 0.4))) {
      problems.push(
        `rotor turned ${turned.toFixed(1)}°, expected about ${expectedTurn.toFixed(1)}° at ${report.second.rpm.toFixed(2)} rpm`,
      );
    }
    if (!(report.painted > 1)) problems.push(`panel repainted ${report.painted} times in 1.4 s`);
    if (report.second.still) problems.push('the panel parked the rotor on its own');
    if (report.second.reduced !== run.reduced) {
      problems.push(`reduced-motion read as ${report.second.reduced}, expected ${run.reduced}`);
    }
    if (Math.abs(report.second.movingMs - run.cadenceMs) > 1) {
      problems.push(`cadence ${report.second.movingMs.toFixed(1)} ms, expected ${run.cadenceMs.toFixed(1)} ms`);
    }
  }

  if (problems.length) failures += 1;
  lines.push(
    [
      problems.length ? 'FAIL' : 'PASS',
      run.name.padEnd(15),
      report && !report.error
        ? `turned ${report.moved.toFixed(1)}°  repainted ${report.painted}x  cadence ${report.second.movingMs.toFixed(0)}ms  rpm ${report.second.rpm.toFixed(2)}`
        : '—',
    ].join('  '),
  );
  for (const p of problems) lines.push(`      ${p}`);
}

console.log(lines.join('\n'));
console.log(failures ? `\n${failures} of ${RUNS.length} runs failed` : `\nall ${RUNS.length} runs passed`);
process.exit(failures ? 1 : 0);
