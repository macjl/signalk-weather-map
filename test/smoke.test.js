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
  'getCached', 'setCached', 'purgeLs',
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

test('deferred localStorage writes are flushed at end of lifecycle', () => {
  const src = inlineScripts()[0]
  // After a completed fetch batch…
  assert.match(src, /lsFlush\(\)\s*\n\s*if \(gen !== refreshGen\)/,
    'lsFlush() called after fetchBatch completes')
  // …and when leaving the page.
  assert.match(src, /addEventListener\('pagehide', lsFlush\)/,
    'pagehide listener flushes pending writes')
})
