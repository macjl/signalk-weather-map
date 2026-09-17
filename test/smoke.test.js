'use strict'

// Smoketest for the webapp: public/index.html is vanilla JS with no build
// step, so we can only assert it parses and that the helpers the UI relies
// on are still defined. Extract the main inline script and compile it with
// vm.Script (parse only — never executed, so Leaflet/DOM absence is fine).

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const htmlPath = path.join(__dirname, '..', 'public', 'index.html')

// All inline <script> blocks (no src= attribute), longest first.
function inlineScripts() {
  const html = fs.readFileSync(htmlPath, 'utf-8')
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .sort((a, b) => b.length - a.length)
  return blocks
}

test('inline script parses as JavaScript', () => {
  const blocks = inlineScripts()
  assert.ok(blocks.length > 0, 'at least one inline <script> block found')
  new vm.Script(blocks[0])  // throws SyntaxError on parse failure
})

// Helpers wired into UI lifecycle — renaming any of these without updating
// the listeners should fail here rather than in the browser.
const HELPERS = [
  'lsGet', 'lsSet', 'lsRemove', 'lsFlush', 'lsEvictForSpace',  // localStorage cache
  'getCached', 'hasNoDataCached', 'setNoDataCached', 'setCached', 'purgeLs',
  'computeGrid', 'autoStep', 'fetchPoint', 'fetchBatch',
  'renderHeatmap', 'renderMarker', 'doRefresh',
]

test('cache and render helpers are defined', () => {
  const src = inlineScripts()[0]
  for (const fn of HELPERS) {
    assert.match(src, new RegExp(`function ${fn}\\s*\\(`), `function ${fn}() defined`)
  }
})

test('water temperature layer uses the SignalK water.temperature field', () => {
  const html = fs.readFileSync(htmlPath, 'utf-8')
  const src = inlineScripts()[0]
  assert.match(html, /data-layer="waterTemp"/, 'water-temperature selector is present')
  assert.match(src, /f\.water\?\.temperature/, 'water temperature is read from the weather API model')
  assert.match(src, /WATER_TEMP_STOPS/, 'water temperatures use their dedicated colour range')
})

test('the map uses MapLibre globe projection and native weather cells', () => {
  const html = fs.readFileSync(htmlPath, 'utf-8')
  const src = inlineScripts()[0]
  assert.match(html, /maplibre-gl@5\.12\.0/, 'MapLibre GL is loaded')
  assert.match(src, /setProjection\(\{ type: 'globe' \}\)/, 'globe projection is selected')
  assert.match(src, /type: 'geojson', data/, 'weather values are supplied as native map features')
  assert.match(src, /type: 'fill'/, 'weather cells use the WebGL fill layer')
  assert.match(src, /stageWeatherSnapshot\(data, snapshot\)/, 'weather cells are prepared with matching forecast markers')
  assert.match(src, /touchZoomRotate: true/, 'touch zoom and rotation are explicitly enabled')
  assert.match(src, /map\.dragPan\.enable\(\)/, 'drag interaction is explicitly enabled')
  assert.match(src, /new maplibregl\.Marker\([^\n]+\.setLngLat\([^\n]+\.addTo\(map\)/,
    'MapLibre markers are positioned before being added')
  assert.match(src, /opacityWhenCovered: 0/, 'markers are hidden behind the globe')
  assert.match(html, /\.maplibregl-marker-covered \{ opacity: 0 !important/, 'covered custom markers are fully hidden')
  assert.doesNotMatch(src, /\bL\./, 'Leaflet API is no longer used')
  assert.doesNotMatch(src, /map\.getSize\(\)/, 'Leaflet getSize API is not used')
})

test('weather rendering retains the current layer during a camera gesture', () => {
  const src = inlineScripts()[0]
  assert.match(src, /map\.on\('movestart'/, 'in-flight work is invalidated when navigation begins')
  assert.match(src, /mapIsMoving = true/, 'the active gesture blocks weather replacement')
  assert.match(src, /cancelScheduledHeatmap\(\)/, 'the old geographic layer is not redrawn during movement')
  assert.match(src, /cancelProgressiveWeatherRender\(\)/, 'a stale provisional redraw cannot replace it')
})

test('every completed camera gesture reveals forecasts at a bounded cadence', () => {
  const src = inlineScripts()[0]
  assert.match(src, /const PROGRESSIVE_RENDER_INTERVAL = 1000/,
    'partial updates are limited to once per second')
  assert.match(src, /scheduleProgressiveWeatherRender\(gen\)/,
    'cached and newly received forecasts can schedule an intermediate display')
  assert.match(src, /if \(mapIsMoving \|\| generation !== refreshGen\) return/,
    'active movement prevents partial replacement')
  assert.match(src, /map\.on\('moveend'.*refresh\(\)/s,
    'a completed pan or zoom starts a new progressively rendered batch')
  assert.match(src, /cancelProgressiveWeatherRender\(\)/,
    'starting another gesture cancels any stale scheduled display')
  assert.match(src, /renderHeatmap\(\{ allowEmpty: false \}\)/,
    'a provisional result cannot clear the existing heatmap before it has cells')
})

test('weather colours bilinearly interpolate the active forecast grid', () => {
  const src = inlineScripts()[0]
  assert.match(src, /const step = currentStep \|\| autoStep\(\)/,
    'current grid spacing is captured for the colour field')
  assert.match(src, /const WEATHER_SUBDIVISIONS = 4/, 'a higher-resolution colour field is defined')
  assert.match(src, /Bilinear interpolation at the centre of each geographical sub-cell/,
    'sub-cells interpolate the four surrounding forecast points')
  assert.match(src, /function interpolateCellValue\(corners, x, y\)/,
    'the interpolation is isolated from rendering')
  assert.match(src, /weightedValue \/ totalWeight/,
    'known corners are normalized into an interpolated colour')
  assert.match(src, /geometry: \{ type: 'Polygon'/, 'interpolated cells remain geographic polygons')
})

test('forecast gaps retry only actual request failures and use a local colour fallback', () => {
  const src = inlineScripts()[0]
  assert.match(src, /const MAX_ATTEMPTS = 4/, 'transient point requests have four attempts')
  assert.match(src, /if \(!Array\.isArray\(data\)\) throw new Error\('invalid forecast response'\)/,
    'malformed successful responses are retried')
  assert.match(src, /if \(data\.length > 0\) setCached\(key, data\)/,
    'empty arrays are accepted as valid provider no-coverage responses')
  assert.match(src, /if \(res\.data\.length > 0\) onResult\(res\)/,
    'no-coverage responses do not create weather markers')
  assert.match(src, /if \(hasNoDataCached\(key\)\) return \{ key, lat, lon, data: \[\] \}/,
    'known no-coverage points do not re-query the provider')
  assert.match(src, /onRetry\?\.\(\{ attempt: attempt \+ 1, maxAttempts: MAX_ATTEMPTS \}\)/,
    'each retry is reported to the batch status')
  assert.match(src, /t\.loadingRetry\(done, total, attempt, maxAttempts\)/,
    'the loading status remains visible while retrying')
  assert.match(src, /return available >= 3 && totalWeight > 0 \? weightedValue \/ totalWeight : null/,
    'one missing corner is filled locally, but fewer than three remain empty')
})

test('map readiness does not request weather until a provider is selected', () => {
  const src = inlineScripts()[0]
  assert.match(src, /const source = document\.getElementById\('sel-source'\)\.value\s+\/\/ MapLibre can become ready[\s\S]*?if \(!source\) return/,
    'early MapLibre readiness cannot issue an implicit provider request')
  assert.doesNotMatch(src, /function renderCanvasHeatmap\(/, 'the obsolete canvas renderer is removed')
})

test('a globe rotation keeps the forecast grid resolution stable', () => {
  const src = inlineScripts()[0]
  assert.match(src, /function degreesPerPixelAtZoom\(\)/, 'grid scale is derived from the map zoom')
  assert.match(src, /512 \* \(2 \*\* map\.getZoom\(\)\)/, 'MapLibre world size is used')
  assert.match(src, /const degPerPx = degreesPerPixelAtZoom\(\)/,
    'autoStep no longer derives its scale from the perspective bounds')
  assert.match(src, /let\s+gridStepNeedsUpdate = true/, 'grid changes are tracked separately from panning')
  assert.match(src, /currentStep == null \|\| gridStepNeedsUpdate \? autoStep\(\) : currentStep/,
    'a pan reuses the prior grid step')
  assert.match(src, /map\.on\('zoomend'.*gridStepNeedsUpdate = true/s,
    'only zoom completion permits a different grid step')
})

test('forecast sampling is slightly denser without increasing globe polygon cost disproportionately', () => {
  const src = inlineScripts()[0]
  assert.match(src, /const GRID_TARGET_PX = 36/, 'the target marker spacing is slightly tighter')
  assert.match(src, /const GRID_STEPS = \[0\.05, 0\.1, 0\.25, 0\.5, 1, 2, 4, 5, 7\.5, 10\]/,
    'the 4° intermediate world-grid tier is available')
  assert.match(src, /const subdivisions = step >= 4 \? 2/, 'the denser grid keeps the same lightweight colour subdivision')
  assert.match(src, /const MIN_OVERLAY_PX = 30/, 'barbs remain visible at the denser target spacing')
})

test('forecast timeline has looping play and pause controls beside its step buttons', () => {
  const html = fs.readFileSync(htmlPath, 'utf-8')
  const src = inlineScripts()[0]
  const prev = html.indexOf('id="btn-time-prev"')
  const play = html.indexOf('id="btn-time-play"')
  const next = html.indexOf('id="btn-time-next"')
  const timeline = html.indexOf('id="time-area"')
  assert.ok(prev >= 0 && prev < play && play < next && next < timeline,
    'previous, play/pause, and next buttons are grouped before the timeline')
  assert.match(src, /const TIMELINE_PLAYBACK_INTERVAL = 1000/, 'forecast advances once per second')
  assert.match(src, /selectTimeIndex\(\(curTimeIdx \+ 1\) % allTimes\.length, \{ fromPlayback: true \}\)/,
    'playback loops back to the first forecast')
  assert.match(src, /button\.textContent = playing \? '❚❚' : '▶'/,
    'the control switches between pause and play')
  assert.match(src, /function stopTimelinePlayback\(\)/, 'playback can pause without selecting another time')
})

test('each map view is rendered from one atomic request grid', () => {
  const src = inlineScripts()[0]
  assert.match(src, /let activeGrid = new Map\(\)/, 'active view grid is explicit state')
  assert.match(src, /activeGrid = new Map\(pts\.map/, 'a refresh replaces the active grid atomically')
  assert.match(src, /for \(const \[key, point\] of activeGrid\)/, 'weather cells only use active grid points')
  assert.match(src, /if \(abortCtrl\) abortCtrl\.abort\(\)/, 'a camera move cancels stale requests')
  assert.match(src, /const GRID_EDGE_MARGIN = 1/,
    'the active request includes interpolation neighbours around the viewport')
  assert.match(src, /GRID_EDGE_MARGIN \* step/,
    'the extra grid ring is applied in every cardinal direction')
})

test('globe weather rendering avoids pole distortion and anti-meridian seams', () => {
  const src = inlineScripts()[0]
  assert.match(src, /const MAX_WEATHER_LAT = 84\.75/, 'weather cells are capped before Mercator poles')
  assert.match(src, /Split a cell that crosses the anti-meridian/, 'anti-meridian cells are handled explicitly')
})

test('wind and pressure colours use continuous intermediate shades', () => {
  const src = inlineScripts()[0]
  assert.match(src, /const WIND_COLOR_STOPS = \[/, 'wind colour stops are explicit')
  assert.match(src, /const PRESSURE_COLOR_STOPS = \[/, 'pressure colour stops are explicit')
  assert.match(src, /function interpolateColorStops\(stops, value\)/,
    'colour stops are interpolated rather than selected as hard bands')
  assert.match(src, /interpolateColorStops\(WIND_COLOR_STOPS, k\)/,
    'wind uses intermediate shades')
  assert.match(src, /interpolateColorStops\(PRESSURE_COLOR_STOPS, value\)/,
    'pressure uses intermediate shades')
  assert.match(src, /PRESSURE_GRADIENT_HTML/, 'pressure legend displays the continuous scale')
})

test('deferred localStorage writes are flushed at end of lifecycle', () => {
  const src = inlineScripts()[0]
  // After a completed fetch batch…
  assert.match(src, /lsFlush\(\)\s*\n\s*if \(gen !== refreshGen\)/,
    'lsFlush() called after fetchBatch completes')
  // …and when leaving the page.
  assert.match(src, /addEventListener\('pagehide', lsFlush\)/,
    'pagehide listener flushes pending writes')
})
