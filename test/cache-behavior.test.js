'use strict'

// Functional test for the localStorage cache logic. The cache section of
// public/index.html is extracted and run in a vm sandbox with a stub
// localStorage that enforces a byte quota — verifying the deferred-write and
// quota-eviction behaviour without a browser.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8')

// localStorage stub with a byte quota. Storage keys are enumerable own props
// (like the browser), methods are not — Object.keys(storage) yields keys only.
function makeStorage(quotaBytes) {
  const ls = {}
  const used = () => Object.keys(ls).reduce((s, k) => s + ls[k].length, 0)
  Object.defineProperty(ls, '_quota', { value: quotaBytes })
  Object.defineProperty(ls, 'setItem', {
    enumerable: false,
    value(k, v) {
      v = String(v)
      const prev = Object.prototype.hasOwnProperty.call(this, k) ? this[k].length : 0
      if (used() - prev + v.length > this._quota) throw new Error('QuotaExceededError')
      this[k] = v
    },
  })
  Object.defineProperty(ls, 'getItem', {
    enumerable: false,
    value(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null },
  })
  Object.defineProperty(ls, 'removeItem', {
    enumerable: false,
    value(k) { delete this[k] },
  })
  return ls
}

// Build a sandbox exposing the cache functions from the webapp script.
function loadCache(storage) {
  const constants = html.match(/^const (?:CACHE_TTL|LS_PFX|LS_FLUSH_DELAY|LS_FLUSH_MAX_PENDING) *=.*$/gm)
  assert.ok(constants && constants.length >= 4, 'cache constants found in script')
  const section = html.match(/\/\/ ── Cache ─+\n([\s\S]*?)\n\/\/ ── Auto grid step/)[1]

  const sandbox = {
    localStorage: storage,
    setTimeout, clearTimeout,   // lsSet schedules a flush timer — host timers are fine
    // The memCache sweep interval sits at the end of the extracted section.
    // Stub it: a real 5-min timer would keep the test process alive, and the
    // sweep is not under test.
    setInterval: () => 0,
    clearInterval: () => {},
    memCache: new Map(),
  }
  vm.createContext(sandbox)
  vm.runInNewContext(`${constants.join('\n')}\n${section}`, sandbox)
  return sandbox
}

const DATA = n => [{ date: `2026-01-01T${String(n).padStart(2, '0')}:00:00Z`, type: 'point' }]

test('writes are deferred until lsFlush()', () => {
  const storage = makeStorage(1 << 20)
  const sb = loadCache(storage)

  sb.setCached('p|1.00,2.00', DATA(1))
  assert.strictEqual(Object.keys(storage).length, 0, 'nothing written synchronously')
  assert.notStrictEqual(sb.getCached('p|1.00,2.00'), null, 'readable from memory cache')

  sb.lsFlush()
  assert.strictEqual(Object.keys(storage).length, 1, 'persisted after flush')
})

test('lsRemove drops both the pending write and the stored entry', () => {
  const storage = makeStorage(1 << 20)
  const sb = loadCache(storage)

  sb.setCached('p|1.00,2.00', DATA(1))
  sb.lsRemove('p|1.00,2.00')
  sb.lsFlush()
  assert.strictEqual(Object.keys(storage).length, 0, 'pending write discarded')
})

test('quota exceeded: expired entries are evicted, write succeeds', () => {
  const data = DATA(1)
  const expired = JSON.stringify({ ts: 0, data })   // ts=0 → expired
  const quota = expired.length + 64                 // room for the expired entry + 64 B only
  const storage = makeStorage(quota)
  storage.setItem('skwx2_p|0.00,0.00', expired)

  const sb = loadCache(storage)
  sb.setCached('p|1.00,2.00', data)   // larger than the 64 B left → quota error
  sb.lsFlush()
  assert.ok(Object.keys(storage).includes('skwx2_p|1.00,2.00'), 'new entry persisted')
  assert.ok(!Object.keys(storage).includes('skwx2_p|0.00,0.00'), 'expired entry evicted')
})

test('unrecoverable quota: persistence disabled without throwing', () => {
  const storage = makeStorage(16)   // far too small for any entry
  const sb = loadCache(storage)

  sb.setCached('p|1.00,2.00', DATA(1))
  assert.doesNotThrow(() => sb.lsFlush())
  assert.strictEqual(Object.keys(storage).length, 0, 'nothing persisted')

  // lsDisabled is set: further writes must not even queue
  sb.setCached('p|4.00,5.00', DATA(4))
  sb.lsFlush()
  assert.strictEqual(Object.keys(storage).length, 0)
  assert.notStrictEqual(sb.getCached('p|4.00,5.00'), null, 'memory cache still authoritative')
})

test('quota exceeded with only live entries: oldest quarter evicted', () => {
  const data = DATA(1)
  const now = Date.now()
  const entry = ts => JSON.stringify({ ts, data })
  const quota = entry(now).length * 2
  const storage = makeStorage(quota)
  storage.setItem('skwx2_p|1.00,1.00', entry(now - 20 * 60_000))  // oldest live
  storage.setItem('skwx2_p|2.00,2.00', entry(now))                // newest live

  const sb = loadCache(storage)
  sb.setCached('p|9.00,9.00', data)
  sb.lsFlush()
  assert.ok(Object.keys(storage).includes('skwx2_p|9.00,9.00'), 'new entry persisted')
  assert.ok(!Object.keys(storage).includes('skwx2_p|1.00,1.00'), 'oldest live entry evicted')
})
