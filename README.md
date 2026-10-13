# Live wind turbine

A web page that renders a 3D wind turbine and turns its blades at the speed the real wind at a
given GPS coordinate would drive a 2.5 MW machine — re-read once an hour.

Enter a coordinate, and the page reads the wind at 100 m (normal hub height) from the Open-Meteo
forecast API, then sets the rotor speed with a real turbine control law: proportional to wind
below the rated speed, flat above it, and stopped outside the operating range.

**Live at <https://kbottsson.github.io/wind-turbine-live/>** — deployed by GitHub Pages from this
repository on every push to `main`, so the site cannot drift from the code.

```
npm test              # 88 unit tests for the coordinate parser, control law, motion and panels
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

The server binds `127.0.0.1` only, so the page is **not** reachable from other devices on your
network. Open http://localhost:8080/.

To test it on a phone on the same wifi, ask for the LAN binding explicitly:

```bash
./run.sh 8080 lan        # prints the http://<your-ip>:8080/ address to open on the phone
```

`python3 -m http.server` serves the directory without any authentication, so only use `lan` on a
network you trust, and stop it when you're done.

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

## Camera

The viewpoint is fixed, because the page is meant to hang on a wall and the machine is the thing
that should move. A viewer stands on the ground **due south** of the tower at eye height (1.7 m),
aimed at the machine's vertical centre, at the shortest stand-off that keeps both the topmost blade
tip and the tower base inside the frame. For the default 2.5 MW machine that is about **234 m away
and pitched 17° up**, so a 147 m machine fills ~80% of the frame height with the base and a strip of
ground still in shot. Drag to orbit: the camera walks around the machine at ground level and cannot
go below the grass. Nothing moves it on its own.

Everything that changes hour to hour happens to the machine instead: the rotor speed follows the
wind, and the nacelle yaws into it, so the machine's orientation is what tells you which way the
wind is blowing. That cuts both ways, and it is worth knowing before hanging it on a wall — because
the rotor faces into the wind, a southerly wind turns the rotor square to the viewer, a wind from
the east shows it edge-on, and a northerly wind shows the machine from behind. Half the wind rose
each way: that is an upwind turbine seen from a fixed point, not a defect of the view.

The framing is pure maths in `src/framing.js`, unit tested for six aspect ratios from phone
portrait to ultrawide, so the phone layout is a real standing view rather than a cropped desktop
one. That module also owns the compass convention — bearing 0 is north, drawn as -Z; bearing 90 is
east, drawn as +X — which the camera, the nacelle and the compass ring all have to agree on.
Tunables live in `CAMERA` in `src/config.js`:

| | |
|---|---|
| `eyeHeight` | 1.7 m — a standing person's eye, which is what keeps the tower base in view |
| `fovDeg` / `marginDeg` | 40° lens, 2° of clearance so the tip and the ground stay off the frame edge |
| `viewAzimuthDeg` | 180° — the viewer stands due south of the machine and looks north at it |
| `standOff` | 1.06 — the extra distance that buys the strip of ground below the tower base |

## The panel page — `lite.html`

A second page draws the same turbine as a **pixel-art panel**, for screens this one cannot reach:
a 2017 Fire tablet, an e-ink display, an old browser. It exists because `index.html` needs two
things those devices lack — ES module import maps (Chromium 89+, Firefox 108+) and WebGL 2, which
three.js has required since r163 — and no amount of browser updating fixes a GPU without OpenGL
ES 3.0.

Nothing about it is modern: one plain `XMLHttpRequest`, one canvas, and a hand-built 5×7 bitmap
font. The whole panel is drawn into a small framebuffer — 256×150 by default — and displayed at an
integer scale, so at `?px=4` every drawn pixel is exactly 4×4 screen pixels with no smoothing. The
same page therefore renders identically on the Fire tablet, on a modern laptop, and quantised to a
PNG for e-ink.

The picture fills the top of the screen and the readings sit under it across the full width: the
state and the headline wind speed on the first row, gust, direction, rotor speed and power as four
columns below, and the twelve-hour forecast running along the bottom edge. Nothing is squeezed into
a side column, so a 1024×600 screen reads at a glance. The coordinate and the Open-Meteo credit are
quiet stamps on the picture, and the readings thin out by themselves on a chunky or narrow panel
rather than colliding.

```
https://kbottsson.github.io/wind-turbine-live/lite.html?coord=55.7047,13.1910&px=4
```

The panel fits whatever viewport it is given: it derives the framebuffer from the window, reserves
the rows the readout needs, and shrinks the picture instead if the window is short. A tablet's
browser toolbar costs roughly 50 px of height, which is exactly the kind of thing that quietly drops
a row of data, so the data block keeps its space and the turbine gives ground. The design target is
the 1024×600 panel the tablet has: at `?px=4` the framebuffer is 256×150 and each drawn pixel is
exactly 4×4 screen pixels.

Neither orientation is assumed. Landscape is the intended shape — the picture tops the screen and the
readings run the full width, four across — but the same page re-lays out on rotation: portrait keeps
the picture on top and stacks the readings two by two, because a tall panel has the height to spare.
The readings drop to fewer columns only when the room genuinely is not there.

The panel is also written to be cheap to leave running: the rotor is the only thing that moves, so the
picture is repainted at a fixed slow cadence rather than once per animation frame, and a stopped
machine drops to a heartbeat of one paint a minute. Measured over ten seconds driven at 60 Hz: 600
paints before, 102 while turning, and about ten a minute while parked.

The loop is driven by a timer, not `requestAnimationFrame`, and the rotor integrates the real elapsed
time between ticks. A kiosk WebView can suspend animation frames outright — Fully Kiosk on Fire OS
did — which left the panel repainting only when a new hourly reading arrived. One unit trap is worth
knowing about too: the shared model works in radians (the 3D page hands them to three.js) while the
pixel panel draws blade angles in degrees, and the conversion happens at the drawing call. Getting
that wrong is not a subtle error — the rotor turns 57× too slowly, which reads as standing still.

| Parameter | Effect |
|---|---|
| `?coord=lat,lon` | coordinate to watch (`?lat=&lon=` also accepted). Remembered in `localStorage` |
| `?px=N` | pixel scale, integer: 2 is fine and detailed, 4 is the default, 8 is chunky. The scale decides how much of the readout fits — at ×8 the picture, the state and the wind speed are the whole panel |
| `?wind=8&dir=260` | demo: render a wind speed and direction with no network read |
| `?motion=off` | park the rotor for a still panel or a static render (an e-ink PNG). Nothing else stops the machine: the platform's reduce-motion preference only slows the painting (12 → 4 a second) and never stops the rotor |

It reads the same Open-Meteo series at the same cadence as the 3D page (once an hour, re-read every
6), runs the same control law and cut-out hysteresis, and eases the rotor with the same 4 s time
constant. The viewer stands due south and never moves: the machine does the moving. It yaws to face
the wind — the nacelle swings left, right or end-on and the rotor sits upwind at the nose — and its
disc foreshortens to a sliver when the wind blows across the view rather than at the viewer, so the
panel shows which way the machine is facing with no 3D at all.

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
lite.html             the pixel-art panel page: no modules, no import maps, no WebGL (see above)
styles/app.css        all styling, including the phone layout
run.sh                local http server
src/config.js         every tunable number — the single source of truth
src/wind-model.js     pure: coordinate parsing, control law, hourly sampling, motion maths
src/framing.js        pure: the standing camera fit — aim height, stand-off, frame fractions
src/api.js            Open-Meteo client, error normalisation
src/turbine.js        procedural turbine geometry + the rig that applies rpm and yaw
src/scene.js          renderer, standing camera, lights, sky, ground, compass
src/main.js           wiring: input → data → control law → 3D + HUD, hourly timer
tests/                node --test unit tests for src/wind-model.js, src/framing.js and lite.html
scripts/smoke-api.mjs live API check for a land, ocean and offshore coordinate
scripts/shots.sh      renders and asserts every UI state in headless Chrome, plus the lite states
```

To model a different machine, change `TURBINE` in `src/config.js` — the geometry, the control law,
the power curve and the spec table all follow from those numbers, so the model cannot drift away
from the physics. Three.js is loaded from a CDN (pinned), not vendored, by decision.

## What has been verified, and how

- `npm test` — 88 unit tests, all passing: coordinate parsing (decimal, DMS both ways, Maps links,
  range rejection, junk), the control law against computed reference values, cut-out hysteresis,
  hourly sampling and clamping, the motion maths (rotor easing, yaw slew, angle integration), the
  framing and compass maths (the tower base and the topmost blade tip both inside the frame, with
  the machine filling most of it, for six aspect ratios from 9:16 to ultrawide; a bearing mapping to
  the right scene direction; the nacelle's nose ending up on the wind's bearing; the viewer standing
  due south and staying there whatever the wind does), and the lite panel (its inline copy of the
  physics compared against `src/wind-model.js` across a 0–30 m/s sweep, including hysteresis and the
  motion maths, plus guards that it contains no ES modules, no import maps, no external scripts and
  no three.js).
- The lite panel — both paths rendered in headless Chrome: `lite.html?wind=8&dir=260` (the demo
  path) and `lite.html?coord=52.5200,13.4050`, which fetched live Open-Meteo data and showed
  8.5 m/s at 244° SW → 964 kW with the GENERATING badge. States were checked by the badge colour in
  the rendered pixels: green generating/rated, grey parked, red storm park, amber no data.
- Yaw and viewpoint — measured from the live scene graph in a real browser, not from the maths:
  for winds of 0°, 90°, 180° and 260° the nacelle's nose (the yaw group's world +X axis) ends up on
  0°, 90°, 180° and 260° while the camera stays at 180° (due south) and 1.7 m. An earlier revision
  set `rotation.y = -bearing`, which pointed the machine 90° off the wind and left the viewer
  looking at the back of it.
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
