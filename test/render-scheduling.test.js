'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const html = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8')
const scheduler = html.slice(html.indexOf('const HEATMAP_IDLE_DELAY'), html.indexOf('// ── Fetch'))

function harness() {
  let id = 0, now = 10000, renders = 0
  const timers = new Map(), frames = new Map()
  const sandbox = {
    Date: { now: () => now },
    setTimeout: (fn, delay) => { timers.set(++id, { fn, due: now + delay }); return id },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { frames.set(++id, fn); return id },
    cancelAnimationFrame: id => frames.delete(id),
    refreshGen: 1, activeGridGeneration: 1, activeGrid: new Map(),
    barbLayers: new Map(), labelLayers: new Map(),
    clearWeatherMarkers: () => {},
    renderHeatmap: () => { renders++; return true },
  }
  vm.createContext(sandbox)
  vm.runInContext(scheduler, sandbox)
  return {
    sandbox, frames, timers,
    get renders() { return renders },
    advance(ms = 0) {
      now += ms
      for (const [key, timer] of [...timers]) {
        if (timer.due <= now) { timers.delete(key); timer.fn() }
      }
    },
    paint() {
      const batch = [...frames.values()]
      frames.clear()
      batch.forEach(fn => fn())
    },
  }
}

test('responses arriving before a browser paint share one render', () => {
  const h = harness()
  h.sandbox.scheduleProgressiveWeatherRender(1)
  h.advance()
  // Network completions may run after the timeout but before Safari paints.
  for (let n = 0; n < 15; n++) {
    h.sandbox.scheduleProgressiveWeatherRender(1)
    h.advance()
  }
  assert.equal(h.frames.size, 1)
  h.paint()
  assert.equal(h.renders, 1)
  h.sandbox.scheduleProgressiveWeatherRender(1)
  h.advance(999)
  h.paint()
  assert.equal(h.renders, 1)
  h.advance(1)
  h.paint()
  assert.equal(h.renders, 2)
  h.advance(10000)
  h.paint()
  assert.equal(h.renders, 2, 'no redraw loop when responses stop')
})

test('cancellation removes all queued provisional frames', () => {
  const h = harness()
  h.sandbox.scheduleProgressiveWeatherRender(1)
  h.advance()
  h.sandbox.scheduleProgressiveWeatherRender(1)
  h.advance()
  h.sandbox.cancelProgressiveWeatherRender()
  h.paint()
  assert.equal(h.renders, 0)
})

test('a superseded request cannot paint', () => {
  const h = harness()
  h.sandbox.scheduleProgressiveWeatherRender(1)
  h.advance()
  h.sandbox.refreshGen++
  h.paint()
  assert.equal(h.renders, 0)
})
