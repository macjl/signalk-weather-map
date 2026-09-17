'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const html = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8')
function fn(name) {
  const start = html.search(new RegExp(`(?:async )?function ${name}\\(`))
  assert.ok(start >= 0, name)
  return html.slice(start, html.indexOf('\n}', start) + 2)
}
function context(values, names) {
  vm.createContext(values)
  vm.runInContext(names.map(fn).join('\n'), values)
  return values
}
const bounds = (s, n, w = 0, e = 10) => ({ getSouth: () => s, getNorth: () => n, getWest: () => w, getEast: () => e })

test('initial framing uses a stable six-degree area on every screen size', () => {
  const s = context({ INITIAL_VIEW_SPAN: 6, INITIAL_VIEW_MAX_LAT: 84 }, ['initialWeatherBounds'])
  assert.equal(JSON.stringify(s.initialWeatherBounds(3, 40)), JSON.stringify([[0, 37], [6, 43]]))
  assert.equal(JSON.stringify(s.initialWeatherBounds(10, 89)), JSON.stringify([[7, 78], [13, 84]]))
  assert.equal(JSON.stringify(s.initialWeatherBounds(-170, -89)), JSON.stringify([[-173, -84], [-167, -78]]))
})

test('southern clipping preserves the same lattice and cached points at every grid step', () => {
  const s = context({ MAX_WEATHER_LAT: 84.75 }, ['computeGrid'])
  for (const step of [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 5, 7.5, 10]) {
    const a = s.computeGrid(bounds(-75, -74, 0, 1), step)
    const b = s.computeGrid(bounds(-89, -70, 0, 1), step)
    const keys = new Set(b.map(p => p.join(',')))
    for (const p of a) {
      if (p[0] >= -84.75 && p[0] <= -70) assert.ok(keys.has(p.join(',')), `${step}: ${p}`)
      assert.ok(Math.abs(p[0] / step - Math.round(p[0] / step)) < 1e-7)
    }
  }
  const world = s.computeGrid(bounds(-90, 90, -200, 200), 5)
  assert.equal(new Set(world.map(p => p.join(','))).size, world.length)
})

test('forecasts never extrapolate beyond coverage or across a large temporal gap', () => {
  const s = context({ curTime: () => '2026-09-17T12:00:00Z' }, ['pickForecast'])
  const f = date => ({ date })
  assert.equal(s.pickForecast([f('2026-09-16T12:00:00Z')]), null)
  assert.equal(s.pickForecast([f('2026-09-18T12:00:00Z')]), null)
  assert.equal(s.pickForecast([f('2026-09-17T00:00:00Z'), f('2026-09-18T00:00:00Z')]), null)
  assert.equal(s.pickForecast([null, f('invalid')]), null)
  const exact = f('2026-09-17T12:00:00Z')
  assert.equal(s.pickForecast([exact]), exact)
  const nearby = f('2026-09-17T11:00:00Z')
  assert.equal(s.pickForecast([nearby, f('2026-09-17T14:00:00Z')]), nearby)
})

test('loading earlier dates preserves a deliberate selection of the first step', () => {
  const s = context({
    allTimes: ['2026-09-17T10:00:00Z', '2026-09-17T11:00:00Z'], curTimeIdx: 0,
    updateSliderUI() {}, document: { getElementById: () => ({ hidden: true }) },
  }, ['ingestTimes'])
  s.ingestTimes([{ date: '2026-09-17T09:00:00Z' }])
  assert.equal(s.allTimes[s.curTimeIdx], '2026-09-17T10:00:00Z')
})

test('projected headings follow camera rotation and the local globe tangent', () => {
  const s = context({ map: { project: ([lon, lat]) => ({ x: lon, y: -lat }) } }, ['projectedBearing'])
  assert.ok(Math.abs(s.projectedBearing(0, 0, 0)) < 1e-6)
  assert.ok(Math.abs(s.projectedBearing(0, 0, 90) - 90) < 1e-6)
  s.map.project = ([lon, lat]) => ({ x: -lat, y: -lon })
  assert.ok(Math.abs(s.projectedBearing(0, 0, 0) + 90) < 1e-6)
  s.map.project = ([lon, lat]) => ({ x: Math.cos(lat * Math.PI / 180) * Math.sin(lon * Math.PI / 180), y: -Math.sin(lat * Math.PI / 180) })
  const angle = s.projectedBearing(60, 60, 0)
  assert.ok(Math.abs(angle - (-56.309932)) < 0.001, 'north leans along the curved meridian')
})

test('legends use the same values, colours and positions as weather interpolation', () => {
  const s = context({}, ['gradientLegend', 'interpolateColorStops'])
  vm.runInContext(html.slice(html.indexOf('const WIND_COLOR_STOPS'), html.indexOf('function interpolateColorStops')), s)
  const pressure = vm.runInContext('interpolateColorStops(PRESSURE_COLOR_STOPS, 1013)', s)
  assert.deepEqual(Array.from(pressure).slice(0, 3), [160, 210, 60])
  const legend = vm.runInContext('WIND_GRADIENT_HTML', s)
  assert.match(legend, /rgb\(76,175,80\) 20%/)
  assert.match(legend, /left:20%;[^>]*>10<\/span>/)
})

function heatContext() {
  const forecasts = new Map(['sw', 'se', 'nw'].map(key => [key, [{ date: '2026-09-17T12:00:00Z', wind: { speedTrue: 10 } }]]))
  const s = context({
    mapReady: true, mapIsMoving: false, activeGridGeneration: 1, refreshGen: 1,
    currentStep: 1, currentLayer: 'wind', MAX_WEATHER_LAT: 84.75, WEATHER_SUBDIVISIONS: 4,
    pendingWeather: null, queuedWeather: null, failedPoints: new Set(),
    activeGrid: new Map([['sw', {lat: 0, lon: 0}], ['se', {lat: 0, lon: 1}], ['nw', {lat: 1, lon: 0}], ['ne', {lat: 1, lon: 1}]]),
    getCached: key => forecasts.get(key), hasNoDataCached: () => false,
    curTime: () => '2026-09-17T12:00:00Z',
    stageWeatherSnapshot(data, snapshot) { this.result = { data, snapshot } },
  }, ['pickForecast', 'extractValue', 'renderHeatmap'])
  s.valueToRgba = () => [100, 100, 100, 128]
  // A plain VM function call has no receiver; use a closure for recording.
  s.stageWeatherSnapshot = (data, snapshot) => { s.result = {data, snapshot} }
  return {s, forecasts}
}

test('three-corner interpolation is limited to failed requests, not uncovered/pending data', () => {
  const {s, forecasts} = heatContext()
  s.renderHeatmap()
  assert.equal(s.result.data.features.length, 0, 'still downloading is not a failure')
  s.failedPoints.add('ne')
  s.renderHeatmap()
  assert.equal(s.result.data.features.length, 9)
  s.hasNoDataCached = key => key === 'ne'
  s.renderHeatmap()
  assert.equal(s.result.data.features.length, 0, 'known lack of coverage is never filled')
  s.hasNoDataCached = () => false
  forecasts.set('ne', [{date:'2026-09-16T12:00:00Z', wind:{speedTrue:10}}])
  s.renderHeatmap()
  assert.equal(s.result.data.features.length, 0, 'expired temporal coverage is never filled')
  forecasts.set('ne', forecasts.get('sw'))
  s.renderHeatmap()
  assert.equal(s.result.data.features.length, 9)
  assert.equal(s.result.snapshot.points.size, 4)
})

test('an empty rain layer can commit a dry snapshot instead of keeping old rain', () => {
  const {s, forecasts} = heatContext()
  forecasts.set('ne', forecasts.get('sw'))
  s.valueToRgba = () => null
  assert.equal(s.renderHeatmap({ allowEmpty: false }), true)
  assert.equal(s.result.data.features.length, 0)
  assert.equal(s.result.snapshot.points.size, 4)
})

test('unchanged markers are reused, changed forecasts updated and obsolete points removed', () => {
  const calls = [], removals = []
  const s = context({
    MIN_OVERLAY_PX: 30, degreesPerPixelAtZoom: () => 0.01,
    markerSnapshots: new Map(), barbLayers: new Map(),
    removeMarker: key => {removals.push(key); s.barbLayers.delete(key); s.markerSnapshots.delete(key)},
    renderMarker: (key, lat, lon, forecast) => {calls.push({key, forecast}); s.barbLayers.set(key, {})},
  }, ['renderActiveWeatherMarkers'])
  const snapshot = { step: 1, layer: 'wind', points: new Map(Array.from({length:500}, (_, i) => [String(i), {lat:0, lon:i / 10, forecast:{wind:{speedTrue:10}}}])) }
  s.renderActiveWeatherMarkers(snapshot)
  s.renderActiveWeatherMarkers(snapshot)
  assert.equal(calls.length, 500, 'second render does not recreate 1000 DOM markers')
  snapshot.points.set('0', {lat:0, lon:0, forecast:{wind:{speedTrue:20}}})
  snapshot.points.delete('1')
  s.renderActiveWeatherMarkers(snapshot)
  assert.equal(calls.length, 501)
  assert.deepEqual(removals, ['1'])
})

function stagedContext() {
  const sources = new Map(), layers = new Map(), listeners = new Map(), timers = new Map()
  const committed = [], followups = []
  let seq = 0
  const map = {
    getSource: id => sources.get(id), getLayer: id => layers.get(id),
    addSource: (id, source) => sources.set(id, {...source, loaded:false}),
    addLayer: layer => layers.set(layer.id, layer),
    removeLayer: id => layers.delete(id), removeSource: id => sources.delete(id),
    on: (type, fn) => { if (!listeners.has(type)) listeners.set(type,new Set()); listeners.get(type).add(fn) },
    off: (type, fn) => listeners.get(type)?.delete(fn),
    setPaintProperty: (id, prop, value) => { layers.get(id).paint[prop] = value },
    isSourceLoaded: id => sources.get(id)?.loaded,
    triggerRepaint() {},
  }
  const s = context({
    map, pendingWeather:null, displayedWeather:null, queuedWeather:null, weatherSequence:0,
    mapIsMoving:false, refreshGen:1, currentLayer:'wind', curTime:()=> 'now', heatOverlay:false,
    setTimeout: fn => {timers.set(++seq,fn);return seq}, clearTimeout: id => timers.delete(id),
    renderActiveWeatherMarkers: snapshot => committed.push(snapshot),
    scheduleHeatmapRender: options => followups.push(options), showError: message => { s.error = message },
  }, ['removeWeatherSource', 'cancelPendingWeather', 'stageWeatherSnapshot'])
  const frame = () => { for (const fn of [...(listeners.get('render') ?? [])]) fn() }
  const stage = () => s.stageWeatherSnapshot({type:'FeatureCollection', features:[]}, {generation:s.refreshGen, time:'now', layer:'wind', points:new Map()})
  const ready = () => {sources.get(s.pendingWeather.id).loaded=true;frame();frame()}
  return {s, sources, layers, committed, followups, frame, stage, ready, timers}
}

test('colours and markers switch only after the staged source has loaded and drawn', () => {
  const h = stagedContext()
  h.stage(); h.frame()
  assert.equal(h.committed.length,0)
  h.ready()
  assert.equal(h.committed.length,1)
  const old = h.s.displayedWeather.id
  h.stage(); h.frame()
  assert.equal(h.layers.get(old).paint['fill-opacity'], 1)
  const pending = h.s.pendingWeather
  h.sources.get(pending.id).loaded=true
  h.frame()
  assert.equal(h.committed.length,1, 'source readiness alone does not replace markers')
  h.s.queuedWeather={generation:1,allowEmpty:true}
  h.frame()
  assert.equal(h.committed.length,2)
  assert.equal(h.sources.size,1, 'old source and tiles are released')
  assert.equal(h.s.pendingWeather,null)
  assert.equal(h.followups.length,1)
  assert.equal(h.timers.size,0)
})

test('navigation cancels staging and restores the last completed view', () => {
  const h = stagedContext()
  h.stage();h.ready()
  const old = h.s.displayedWeather.id
  h.stage()
  h.sources.get(h.s.pendingWeather.id).loaded=true
  h.frame()
  h.s.mapIsMoving=true
  h.frame()
  assert.equal(h.s.pendingWeather,null)
  assert.equal(h.sources.size,1)
  assert.equal(h.sources.has(old),true)
  assert.equal(h.layers.get(old).paint['fill-opacity'], 1)
  assert.equal(h.committed.length,1)
})

test('a stuck renderer times out without leaking staging sources', () => {
  const h = stagedContext()
  h.stage();h.ready();h.stage()
  for (const fn of [...h.timers.values()]) fn()
  assert.equal(h.sources.size,1)
  assert.equal(h.s.pendingWeather,null)
  assert.match(h.s.error,/timed out/)
})

test('storage SecurityError leaves the cache startup usable in memory', () => {
  const s = {lsDisabled:false}
  Object.defineProperty(s,'localStorage',{get(){throw new Error('SecurityError')}})
  context(s,['purgeLs'])
  assert.doesNotThrow(()=>s.purgeLs())
  assert.equal(s.lsDisabled,true)
})

function requestContext(fetch) {
  const cached = new Map(), empty = new Set()
  const s = context({
    URL, AbortController, DOMException, fetch, SK:'http://localhost:3000',
    setTimeout: (fn, delay) => setTimeout(fn, Math.min(delay, 5)), clearTimeout,
    cacheKey: (lat, lon, provider) => `${provider}|${lat},${lon}`,
    getCached: key => cached.get(key), hasNoDataCached: key => empty.has(key),
    setCached: (key,data) => cached.set(key,data), setNoDataCached: key => empty.add(key),
  }, ['fetchWithTimeout','fetchPoint'])
  return {s,cached,empty}
}

test('a hung response body times out and weather retries terminate after four attempts', async () => {
  let attempts = 0
  const {s} = requestContext(async (url,{signal}) => {
    attempts++
    return {ok:true,json:()=>new Promise((resolve,reject)=>{
      signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})
    })}
  })
  const retries = []
  await assert.rejects(s.fetchPoint(0,0,'p',new AbortController().signal,r=>retries.push(r.attempt)),/timed out/)
  assert.equal(attempts,4)
  assert.deepEqual(retries,[2,3,4])
})

test('a navigation cancellation aborts a request without retrying it', async () => {
  let attempts = 0
  const controller = new AbortController()
  const {s} = requestContext((url,{signal}) => {
    attempts++
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))
  })
  const request = s.fetchPoint(0,0,'p',controller.signal)
  controller.abort()
  await assert.rejects(request,{name:'AbortError'})
  assert.equal(attempts,1)
})

test('valid empty coverage and permanent HTTP errors do not consume retries', async () => {
  let attempts=0
  const {s,empty} = requestContext(async()=>{ attempts++;return {ok:true,json:async()=>[]} })
  const signal=new AbortController().signal
  await s.fetchPoint(0,0,'p',signal)
  await s.fetchPoint(0,0,'p',signal)
  assert.equal(attempts,1)
  assert.equal(empty.size,1)
  s.fetch=async()=>{attempts++;return {ok:false,status:404}}
  await assert.rejects(s.fetchPoint(1,0,'p',signal),/HTTP 404/)
  assert.equal(attempts,2)
})

test('resuming a drag cancels the debounced refresh and the refresh itself refuses movement', async () => {
  const handlers = {}, timers = new Map()
  let seq=0, requests=0
  const s = {
    mapReady:true, mapIsMoving:false, cameraMoved:false, currentStep:1, gridStepNeedsUpdate:false,
    abortCtrl:null, document:{getElementById:()=>({value:'p',hidden:true})},
    map:{on:(type,fn)=>{handlers[type]=fn},getBounds:()=>bounds(0,1),getCenter:()=>({lat:0,lng:0})},
    setTimeout:fn=>{timers.set(++seq,fn);return seq},clearTimeout:id=>timers.delete(id),
    cancelScheduledHeatmap(){},cancelProgressiveWeatherRender(){},cancelPendingWeather(){},
    orientWeatherMarkers(){},computeGrid:()=>[[0,0]],cacheKey:()=> 'p|0,0',getCached:()=>null,
    failedPoints:new Set(),fetchBatch:async()=>{requests++},showStatus(){},lsFlush(){},
    scheduleHeatmapRender(){},updateLayerButtons(){},console,showError:message=>assert.fail(message),
  }
  vm.createContext(s)
  const main=html.slice(html.indexOf('let debounce = null'),html.indexOf('// ── Layer availability'))
  const events=html.slice(html.indexOf("  if (map) {\n    map.on('movestart'"),html.indexOf("  document.getElementById('slider-time').addEventListener"))
  vm.runInContext(main+'\n'+events,s)
  handlers.moveend()
  assert.equal(timers.size,1)
  handlers.movestart()
  assert.equal(timers.size,0)
  await s.doRefresh()
  assert.equal(requests,0)
})
