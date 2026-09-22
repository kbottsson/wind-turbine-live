# Live wind turbine

A web page that renders a 3D wind turbine and turns its blades at the speed the real wind at a
given GPS coordinate would drive a 2.5 MW machine — re-read once an hour.

Enter a coordinate, and the page reads the wind at 100 m (normal hub height) from the Open-Meteo
forecast API, then sets the rotor speed with a real turbine control law: proportional to wind
below the rated speed, flat above it, and stopped outside the operating range.

**Live at <https://kbottsson.github.io/wind-turbine-live/>** — deployed by GitHub Pages from this
repository on every push to `main`, so the site cannot drift from the code.

```
npm test              # 30 unit tests for the coordinate parser, control law and motion maths
./run.sh              # serve locally at http://localhost:8080/
./scripts/shots.sh    # render + assert every UI state in headless Chrome
```

## Run it

```bash
./run.sh              # then open http://localhost:8080/
```

**Do not double-click `index.html`.** Measured during development: opening the page from a `file://`
address fails outright, because Chrome blocks the page's own module requests from a `null` origin:

> Access to script at `file:///…/src/main.js` from origin `null` has been blocked by CORS policy

The page degrades to its parked fallback turbine with an explanation, which is the designed
behaviour, but nothing works. Serving over `http://` is one command and needs no install — the
files never leave the machine.

To make it reachable from your phone on the same wifi, the local server already binds all
interfaces: `http://<your-mac-ip>:8080/`.

### Hosting

Published on GitHub Pages at <https://kbottsson.github.io/wind-turbine-live/>. The repository is
public, which is what makes Pages free; nothing in it is secret (no API keys are used anywhere).

`.github/workflows/pages.yml` runs the unit tests, stages only `index.html`, `styles/` and `src/`
into the artifact, and deploys on every push to `main`. Tests, scripts and this README stay in the
repository and are not served by the site.

Because it is served from a normal https origin, the weather lookup works there directly — no local
server, and it works on a phone.

## Using the page

**Coordinate formats accepted** (all parsed client-side, nothing is guessed silently):

| Input | Example |
|---|---|
| Decimal pair | `52.5200, 13.4050` |
| Space separated | `52.5200 13.4050` |
| Negative / southern hemisphere | `-33.8688, 151.2093` |
| DMS, hemisphere either side | `N52°31'12" E13°24'18"` or `52°31'12"S, 13°24'18"W` |
| Google Maps link | `https://www.google.com/maps/@52.5200,13.4050,12z` or `…?q=52.5200,13.4050` |

Plus a **Use my location** button (browser geolocation). A map picker and reverse geocoding are
deliberately out of scope, so the readout shows coordinates rather than a place name.

**URL parameters** — useful for sharing or demoing without waiting for weather:

| Parameter | Effect |
|---|---|
| `?coord=52.5200,13.4050` | load a coordinate on open (`?lat=…&lon=…` also works) |
| `?wind=15&dir=45` | render a given wind speed and direction with no network read at all |

The last coordinate you looked up is remembered in `localStorage`, so a revisit comes up live.

## What the numbers mean

The machine is a **generic 2.5 MW class turbine**, not a specific real product:

| | |
|---|---|
| Rotor diameter | 90 m (swept area 6,362 m²) |
| Hub height | 100 m — the height the wind data is read at, so no extrapolation is needed |
| Blades | 3, tip-speed ratio 6.5 below rated wind |
| Cut-in | 3.0 m/s |
| Rated wind speed | 11.71 m/s — where the speed curve goes flat |
| Cut-out | 25.0 m/s, restarting only below 22 m/s (hysteresis) |
| Rated power | 2.5 MW, power coefficient 0.40 |
| Rated rotor speed | 16.15 rpm (tip speed 76 m/s) |

The control law, and why the blades stop speeding up in strong wind:

```
v <  3.0 m/s       PARKED      rotor stopped
3.0 ≤ v < 11.71    GENERATING  rpm = λ·v/R  (proportional to wind),  P = ½ρAv³Cp
11.71 ≤ v < 25.0   RATED       rpm = 16.15 (flat),                   P = 2.5 MW
v ≥ 25.0           CUT-OUT     rotor stopped (feathered, parked)
```

Below the rated wind speed a real turbine holds a constant tip-speed ratio, so rotor rpm rises in
step with wind speed. Once the generator is at its rated power, the blades pitch to shed the
excess: the rotor keeps turning at a constant speed and the surplus energy is deliberately not
harvested. That is why a 12 m/s breeze and a 20 m/s storm look identical in blade speed — the
difference shows in the state badge and the power figure, not the rpm.

Rotating at 16 rpm, the blade tip travels at 76 m/s and the rotor takes 3.7 s per revolution, so
real-time rotation reads correctly and will not strobe.

## Data and cadence

- Source: [Open-Meteo](https://open-meteo.com/) hourly forecast, `wind_speed_100m`,
  `wind_direction_10m`, `wind_gusts_10m`, requested in m/s with `timeformat=unixtime`. Licence
  CC BY 4.0 (credited in the page footer). No API key, no proxy — the API allows browser calls.
- Cadence: the series is read on load and then **at most once an hour**, by decision. It is
  re-read every 6 hours to pick up new model runs; in between, the page re-samples the series it
  already holds at each hour boundary. There is no interpolation: the rotor snaps to the new
  hourly value and then eases into it over a 4 s time constant (rotor inertia — set
  `MOTION.rotorTau = 0` in `src/config.js` for a hard snap).
- A failed background refresh keeps the machine running on the data in hand and says so, because
  that data is still current. A failed **user-initiated** lookup parks the turbine and states the
  reason.

## Every failure state parks the turbine

By decision, every error renders the turbine motionless with a stated reason — never a blank
canvas, never a spinner:

| State | What is shown |
|---|---|
| No coordinate yet | parked, "Enter a coordinate, or use your location" |
| Loading | parked, "Reading the wind at 100 m…" |
| Invalid coordinate | parked, "That does not look like a coordinate. Try 55.7047, 13.1910…" |
| No internet / API unreachable | parked, "Could not reach the wind data service…" |
| No wind value for the hour | parked, "No usable wind value for this hour" |
| Below cut-in | parked, "Below cut-in (3.0 m/s) — too little wind" |
| Above cut-out | parked, "Storm park — feathered and stopped" |
| WebGL unavailable | static parked-turbine graphic, readings still update |
| three.js cannot load (offline) | static parked-turbine graphic + "check your internet connection" |
| Opened from `file://` | static parked-turbine graphic + "serve it over http instead" |

## Layout

```
index.html            markup, import map pinning three.js 0.186.0 (CDN), boot guard
styles/app.css        all styling, including the phone layout
run.sh                local http server
src/config.js         every tunable number — the single source of truth
src/wind-model.js     pure: coordinate parsing, control law, hourly sampling, motion maths
src/api.js            Open-Meteo client, error normalisation
src/turbine.js        procedural turbine geometry + the rig that applies rpm and yaw
src/scene.js          renderer, camera fit, lights, sky, ground, compass
src/main.js           wiring: input → data → control law → 3D + HUD, hourly timer
tests/                node --test unit tests for src/wind-model.js
scripts/smoke-api.mjs live API check for a land, ocean and offshore coordinate
scripts/shots.sh      renders and asserts every UI state in headless Chrome
```

To model a different machine, change `TURBINE` in `src/config.js` — the geometry, the control law,
the power curve and the spec table all follow from those numbers, so the model cannot drift away
from the physics. Three.js is loaded from a CDN (pinned), not vendored, by decision.

## What has been verified, and how

- `npm test` — 30 unit tests, all passing: coordinate parsing (decimal, DMS both ways, Maps links,
  range rejection, junk), the control law against computed reference values, cut-out hysteresis,
  hourly sampling and clamping, and the motion maths (rotor easing, yaw slew, angle integration).
- `./scripts/shots.sh` — 11 states rendered in headless Chrome, with the readings read back out of
  the rendered DOM, not just eyeballed: parked, generating, rated, storm park, live, API blocked,
  CDN blocked, no WebGL, plus two phone-width layouts. Example values: 8 m/s → 11.0 rpm / 798 kW;
  15 m/s → 16.1 rpm / 2.50 MW; 26 m/s → 0 rpm / 0 kW.
- Live data — `node scripts/smoke-api.mjs` reads a land, a mid-ocean and an offshore coordinate;
  all three return usable series, and the page's live reading matched an independently fetched API
  value (10.6 m/s at 100 m → 1.83 MW).
- Real browser — driven over the Chrome DevTools Protocol: 120 fps, rotor easing measured from
  10.67 → 13.44 rpm toward its 14.55 target, rotor angle integration matching the eased rpm, and
  yaw slewing at exactly the configured 0.5°/s.
- No horizontal overflow at 560 px or 1280 px (`scrollWidth === innerWidth`, measured with an
  instrumented copy, not judged from a screenshot).

**Not verified:** frame rate on any machine other than the development machine (120 fps there is
the display's refresh cap, not a headroom figure), behaviour in Safari or Firefox, and the touch
layout on a real phone. Headless Chrome renders with a software renderer, so it was used for
correctness only — never for performance claims.
