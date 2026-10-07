'use strict'

// Deep-link parameter handling. public/deep-link.js is a plain script that
// also exports via CommonJS, so the pure parse/build logic is required
// directly. The wiring inside the single-file webapp is asserted against the
// HTML, and the two functions the webapp contributes (syncUrl,
// applyDeepLinkTime) are extracted and run in a vm sandbox, following the
// pattern of the other test files.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const { DEEP_LINK_LAYERS, parseDeepLinkParams, buildDeepLinkQuery } = require('../public/deep-link')

const html = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8').replace(/\r\n/g, '\n')

function inlineScript() {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1])
  return blocks.sort((a, b) => b.length - a.length)[0]
}

function fn(name) {
  const start = html.search(new RegExp(`(?:async )?function ${name}\\(`))
  assert.ok(start >= 0, `${name}() is defined in the webapp`)
  return html.slice(start, html.indexOf('\n}', start) + 2)
}

test('every supported layer is linkable', () => {
  assert.deepEqual(DEEP_LINK_LAYERS, ['wind', 'gust', 'temp', 'waterTemp', 'cloud', 'precip', 'press'])
})

test('parses a full deep link', () => {
  const p = parseDeepLinkParams('?lat=57.3&lon=10.5&zoom=7&time=2026-10-06T12:00:00Z&layer=waterTemp')
  assert.deepEqual(p, {
    lat: 57.3,
    lon: 10.5,
    zoom: 7,
    time: '2026-10-06T12:00:00.000Z',
    layer: 'waterTemp',
  })
})

test('normalises longitude into [-180, 180)', () => {
  assert.equal(parseDeepLinkParams('?lon=185').lon, -175)
  assert.equal(parseDeepLinkParams('?lon=-185').lon, 175)
  assert.equal(parseDeepLinkParams('?lon=180').lon, -180)
  assert.equal(parseDeepLinkParams('?lon=-180').lon, -180)
})

test('reads naive timestamps as UTC', () => {
  assert.equal(parseDeepLinkParams('?time=2026-10-06T12:00').time, '2026-10-06T12:00:00.000Z')
  assert.equal(parseDeepLinkParams('?time=2026-10-06 12:00').time, '2026-10-06T12:00:00.000Z')
  assert.equal(parseDeepLinkParams('?time=2026-10-06').time, '2026-10-06T00:00:00.000Z')
  assert.equal(parseDeepLinkParams('?time=2026-10-06T12:00:00+02:00').time, '2026-10-06T10:00:00.000Z')
})

// The fraction used to lose its leading dot during reconstruction, so even
// .000Z — what Date.toISOString() produces — was silently rejected (issue
// raised in review).
test('accepts fractional seconds, with or without an offset', () => {
  assert.equal(parseDeepLinkParams('?time=2026-10-06T12:00:00.000Z').time, '2026-10-06T12:00:00.000Z')
  assert.equal(parseDeepLinkParams('?time=2026-10-06T12:00:00.500Z').time, '2026-10-06T12:00:00.500Z')
  assert.equal(parseDeepLinkParams('?time=2026-10-06T12:00:00.500%2B02:00').time, '2026-10-06T10:00:00.500Z')
})

test('clamps zoom into the supported range', () => {
  assert.equal(parseDeepLinkParams('?zoom=-2').zoom, 0)
  assert.equal(parseDeepLinkParams('?zoom=42').zoom, 18)
  assert.equal(parseDeepLinkParams('?zoom=6.5').zoom, 6.5)
})

test('drops invalid values instead of guessing', () => {
  assert.deepEqual(parseDeepLinkParams('?lat=91&zoom=abc&time=yesterday&layer=thermal'), {})
  assert.deepEqual(parseDeepLinkParams('?lat=91&lon=200.5'), { lon: -159.5 }, 'out-of-range lat dropped, lon kept')
  assert.deepEqual(parseDeepLinkParams('?lat=-90.001'), {})
  assert.deepEqual(parseDeepLinkParams('?lat=nan'), {})
  assert.deepEqual(parseDeepLinkParams(''), {})
})

// parseFloat() stops at the first junk character; parameters must be complete
// numbers or they are dropped (issue raised in review).
test('rejects truncated numeric values', () => {
  assert.deepEqual(parseDeepLinkParams('?lat=57junk&lon=10junk&zoom=7junk'), {})
  assert.deepEqual(parseDeepLinkParams('?lat=57.3.4'), {})
  assert.deepEqual(parseDeepLinkParams('?lat=+57&lon=-10'), { lat: 57, lon: -10 }, 'explicit signs stay valid')
  assert.deepEqual(parseDeepLinkParams('?lat=0x39'), {}, 'hex literals are not decimal numbers')
  assert.deepEqual(parseDeepLinkParams('?zoom=1e2'), {}, 'exponent notation is not accepted')
})

// Date.parse() silently rolls impossible calendar values forward instead of
// rejecting them (Feb 30 → Mar 2, Feb 29 of a common year → Mar 1).
test('rejects impossible calendar dates and times', () => {
  assert.deepEqual(parseDeepLinkParams('?time=2026-02-30T12:00'), {})
  assert.deepEqual(parseDeepLinkParams('?time=2026-02-29'), {}, '2026 is not a leap year')
  assert.equal(parseDeepLinkParams('?time=2028-02-29T00:00').time, '2028-02-29T00:00:00.000Z', '2028 is a leap year')
  assert.deepEqual(parseDeepLinkParams('?time=2026-13-01'), {})
  assert.deepEqual(parseDeepLinkParams('?time=2026-10-06T25:00'), {})
  assert.deepEqual(parseDeepLinkParams('?time=2026-10-06T12:60'), {})
  assert.deepEqual(parseDeepLinkParams('?time=2026-10-06T12:00:61'), {})
})

test('builds a shareable query, omitting missing state', () => {
  assert.equal(
    buildDeepLinkQuery({ lat: 57.3, lon: 10.5, zoom: 7, time: '2026-10-06T12:00:00.000Z', layer: 'wind' }),
    'lat=57.3000&lon=10.5000&zoom=7&time=2026-10-06T12:00:00Z&layer=wind')
  assert.equal(buildDeepLinkQuery({ lat: 1, lon: 2, zoom: 6.5 }), 'lat=1.0000&lon=2.0000&zoom=6.5')
  assert.equal(buildDeepLinkQuery({}), '')
})

test('parse and build round-trip', () => {
  const view = { lat: -33.85, lon: 151.2, zoom: 8.5, time: '2026-10-06T15:30:00Z', layer: 'press' }
  const p = parseDeepLinkParams('?' + buildDeepLinkQuery(view))
  assert.ok(Math.abs(p.lat - view.lat) < 1e-8, 'lat survives the 4-decimal serialisation')
  assert.ok(Math.abs(p.lon - view.lon) < 1e-8, 'lon survives the 4-decimal serialisation')
  assert.equal(p.zoom, view.zoom)
  assert.equal(p.time, '2026-10-06T15:30:00.000Z')
  assert.equal(p.layer, 'press')
})

test('webapp loads deep-link.js and wires the parameters at boot', () => {
  assert.match(html, /<script src="deep-link\.js"><\/script>/)
  const src = inlineScript()
  assert.match(src, /const deepLink = parseDeepLinkParams\(window\.location\.search\)/)
  assert.match(src, /deepLink\.lat != null && deepLink\.lon != null/, 'camera pinned to the shared location')
  assert.match(src, /cameraMoved = true/, 'vessel fix must not override the shared view')
  assert.match(src, /deepLink\.layer/, 'shared layer pre-selected')
  assert.match(src, /applyDeepLinkTime\(\)/, 'deep-linked time applied after refresh')
  assert.match(src, /function syncUrl\(\)/)
  assert.match(src, /function syncUrlSoon\(\)/, 'debounced writer for slider-driven syncs')
  assert.match(src, /time: deepLink\.time \?\? allTimes\[curTimeIdx\] \?\? null/, 'pending requested time survives loading syncs')
  assert.match(src, /if \(!fromPlayback\) syncUrlSoon\(\)/, 'playback steps must not write the URL')
})

test('syncUrl mirrors camera, time and layer into the query string', () => {
  let replaced = null
  const sandbox = {
    URL,
    clearTimeout, setTimeout,
    syncUrlTimer: null,
    map: { getCenter: () => ({ lat: 57.3, lng: 10.5 }), getZoom: () => 7 },
    deepLink: { time: null },
    allTimes: ['2026-10-06T12:00:00Z'],
    curTimeIdx: 0,
    currentLayer: 'gust',
    buildDeepLinkQuery,
    window: { location: { href: 'https://sk.local/plugins/signalk-weather-map/' } },
    history: { replaceState: (state, title, url) => { replaced = url } },
  }
  vm.createContext(sandbox)
  vm.runInContext(fn('syncUrl'), sandbox)
  vm.runInContext('syncUrl()', sandbox)
  assert.equal(
    String(replaced),
    'https://sk.local/plugins/signalk-weather-map/?lat=57.3000&lon=10.5000&zoom=7&time=2026-10-06T12:00:00Z&layer=gust')
})

test('syncUrl without a map or with a blocked history API is a no-op', () => {
  const sandbox = {
    URL, clearTimeout, setTimeout, syncUrlTimer: null,
    map: null, deepLink: { time: null }, allTimes: [], curTimeIdx: 0, currentLayer: 'wind', buildDeepLinkQuery,
  }
  vm.createContext(sandbox)
  vm.runInContext(fn('syncUrl'), sandbox)
  vm.runInContext('syncUrl()', sandbox)  // must not throw
  assert.ok(true)
})

test('deep-linked time snaps to the nearest forecast step, once', () => {
  const sandbox = {
    deepLink: { time: '2026-10-06T12:10:00.000Z' },
    allTimes: ['2026-10-06T09:00:00Z', '2026-10-06T12:00:00Z', '2026-10-06T15:00:00Z'],
    curTimeIdx: 0,
    selectTimeIndex: index => { sandbox.curTimeIdx = index },
    syncUrl: () => {},
  }
  vm.createContext(sandbox)
  vm.runInContext(fn('applyDeepLinkTime'), sandbox)
  vm.runInContext('applyDeepLinkTime()', sandbox)
  assert.equal(sandbox.curTimeIdx, 1, 'snapped to the 12:00 step')
  assert.equal(sandbox.deepLink.time, null)
  vm.runInContext('applyDeepLinkTime()', sandbox)
  assert.equal(sandbox.curTimeIdx, 1, 'honoured only once')
})

test('deep-linked time stays pending until forecast steps exist', () => {
  const sandbox = {
    deepLink: { time: '2026-10-06T12:00:00.000Z' },
    allTimes: [],
    curTimeIdx: 0,
    selectTimeIndex: index => { sandbox.curTimeIdx = index },
  }
  vm.createContext(sandbox)
  vm.runInContext(fn('applyDeepLinkTime'), sandbox)
  vm.runInContext('applyDeepLinkTime()', sandbox)
  assert.equal(sandbox.curTimeIdx, 0)
  assert.equal(sandbox.deepLink.time, '2026-10-06T12:00:00.000Z', 'kept for the next refresh')
})

// Regression: a camera move while the forecast is still loading used to strip
// ?time= from the URL (allTimes was still empty), and applyDeepLinkTime() then
// skipped selectTimeIndex() because the nearest step was already selected — so
// the URL was never repaired and sharing/reloading lost the selection.
test('requested time survives camera syncs during loading, URL repaired after apply', () => {
  const urls = []
  const sandbox = {
    URL,
    clearTimeout, setTimeout, syncUrlTimer: null,
    map: { getCenter: () => ({ lat: 57.3, lng: 10.5 }), getZoom: () => 7 },
    deepLink: { time: '2026-10-06T12:00:00.000Z' },
    allTimes: [],
    curTimeIdx: 0,
    currentLayer: 'wind',
    buildDeepLinkQuery,
    selectTimeIndex: index => { sandbox.curTimeIdx = index },
    window: { location: { href: 'https://sk.local/plugins/signalk-weather-map/' } },
    history: { replaceState: (state, title, url) => { urls.push(String(url)) } },
  }
  vm.createContext(sandbox)
  vm.runInContext(fn('syncUrl') + '\n' + fn('applyDeepLinkTime'), sandbox)

  // The camera settles (moveend) while the forecast is still loading.
  vm.runInContext('syncUrl()', sandbox)
  assert.match(urls.at(-1), /time=2026-10-06T12:00:00Z/, 'pending requested time kept in the URL during loading')
  assert.equal(sandbox.deepLink.time, '2026-10-06T12:00:00.000Z', 'request still pending')

  // Forecast arrives; the nearest step happens to be the already-selected one.
  sandbox.allTimes = ['2026-10-06T09:00:00Z', '2026-10-06T12:00:00Z', '2026-10-06T15:00:00Z']
  vm.runInContext('applyDeepLinkTime()', sandbox)
  assert.equal(sandbox.deepLink.time, null, 'request consumed')
  assert.equal(sandbox.curTimeIdx, 1)
  assert.match(urls.at(-1), /time=2026-10-06T12:00:00Z/, 'URL repaired even though the index did not move')
})

test('playback steps do not write browser history', () => {
  let synced = 0
  const sandbox = {
    allTimes: ['2026-10-06T09:00:00Z', '2026-10-06T12:00:00Z'],
    curTimeIdx: 0,
    stopTimelinePlayback: () => {},
    updateSliderUI: () => {},
    rerender: () => {},
    syncUrlSoon: () => { synced++ },
  }
  vm.createContext(sandbox)
  vm.runInContext(fn('selectTimeIndex'), sandbox)
  vm.runInContext('selectTimeIndex(1, { fromPlayback: true })', sandbox)
  assert.equal(sandbox.curTimeIdx, 1)
  assert.equal(synced, 0, 'no URL write while playing')
  vm.runInContext('selectTimeIndex(0)', sandbox)
  assert.equal(synced, 1, 'manual step still schedules a sync')
})

test('rapid manual time changes coalesce into one trailing URL write', () => {
  const urls = []
  let pendingDelay = null
  const sandbox = {
    URL,
    clearTimeout, syncUrlTimer: null,
    setTimeout: (callback, delay) => { sandbox.pendingUrlWrite = callback; pendingDelay = delay; return delay },
    clearTimeout: () => { sandbox.pendingUrlWrite = null },
    map: { getCenter: () => ({ lat: 57.3, lng: 10.5 }), getZoom: () => 7 },
    deepLink: { time: null },
    allTimes: ['2026-10-06T09:00:00Z', '2026-10-06T12:00:00Z', '2026-10-06T15:00:00Z'],
    curTimeIdx: 0,
    currentLayer: 'wind',
    buildDeepLinkQuery,
    stopTimelinePlayback: () => {},
    updateSliderUI: () => {},
    rerender: () => {},
    window: { location: { href: 'https://sk.local/plugins/signalk-weather-map/' } },
    history: { replaceState: (state, title, url) => { urls.push(String(url)) } },
  }
  vm.createContext(sandbox)
  vm.runInContext(fn('syncUrlSoon') + '\n' + fn('syncUrl') + '\n' + fn('selectTimeIndex'), sandbox)

  // A slider drag firing several input events in quick succession.
  vm.runInContext('selectTimeIndex(1)', sandbox)
  vm.runInContext('selectTimeIndex(2)', sandbox)
  assert.equal(urls.length, 0, 'no write per step while dragging')
  assert.equal(pendingDelay, 250, 'trailing write is debounced')

  // The debounce timer fires after the drag settles.
  vm.runInContext('pendingUrlWrite()', sandbox)
  assert.equal(urls.length, 1, 'exactly one write for the whole drag')
  assert.match(urls[0], /time=2026-10-06T15:00:00Z/, 'the final step is what gets written')

  // An immediate write (e.g. playback stopping) supersedes a pending one.
  vm.runInContext('selectTimeIndex(1)', sandbox)
  vm.runInContext('syncUrl()', sandbox)
  assert.equal(urls.length, 2, 'immediate write goes through')
  assert.equal(sandbox.pendingUrlWrite, null, 'stale debounced write discarded')
})
