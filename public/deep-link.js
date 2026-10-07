'use strict'

// ── Deep links ────────────────────────────────────────────────────────────────
// URL parameters that pin the map to a particular place and time, so sibling
// webapps (passage briefing, weather router) can link straight to a view:
//
//   lat   decimal degrees, clamped to [-90, 90]
//   lon   decimal degrees, normalised to [-180, 180)
//   zoom  MapLibre zoom level, clamped to [0, 18] (optional — the same fixed
//         6°-span framing used for the vessel view is the default)
//   time  ISO 8601 instant; the UI snaps to the nearest available forecast
//         step. A timestamp without a timezone designator is read as UTC —
//         this app speaks UTC everywhere.
//   layer one of wind | gust | temp | waterTemp | cloud | precip | press
//
// Dependency-free and side-effect-free so it also runs under node --test.

const DEEP_LINK_LAYERS = ['wind', 'gust', 'temp', 'waterTemp', 'cloud', 'precip', 'press']
const DEEP_LINK_MAX_ZOOM = 18

// Complete decimal numbers only — parseFloat() would silently accept '57junk'
// as 57, and Number() alone would let '0x39' or '1e2' through.
const DEEP_LINK_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/

// A full ISO 8601 date-time. Naive timestamps (no offset) are read as UTC; a
// space is tolerated as the date-time separator, and before the offset too
// (URLSearchParams decodes '+' as a space). Each component is captured so it
// can be range-checked: Date.parse() rolls impossible values forward (Feb 30 →
// Mar 2) instead of rejecting them.
const DEEP_LINK_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[ ]?[+-]?\d{2}:\d{2})?$/

// Last day of a 1-based month, leap years included.
function deepLinkDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parseDeepLinkParams(search) {
  const params = new URLSearchParams(search)
  const out = {}
  const number = name => {
    const raw = (params.get(name) ?? '').trim()
    return DEEP_LINK_NUMBER.test(raw) ? Number(raw) : NaN
  }
  const lat = number('lat')
  if (Number.isFinite(lat) && lat >= -90 && lat <= 90) out.lat = lat
  const lon = number('lon')
  if (Number.isFinite(lon)) out.lon = ((lon % 360) + 540) % 360 - 180
  const zoom = number('zoom')
  if (Number.isFinite(zoom)) out.zoom = Math.min(DEEP_LINK_MAX_ZOOM, Math.max(0, zoom))
  const match = DEEP_LINK_TIME.exec((params.get('time') ?? '').trim())
  if (match) {
    const [, y, mo, d, h = '00', mi = '00', s = '00', frac = '', off = 'Z'] = match
    const offset = off.startsWith(' ') ? '+' + off.slice(1) : off
    if (
      mo >= '01' && mo <= '12' &&
      d >= '01' && d <= String(deepLinkDaysInMonth(+y, +mo)) &&
      +h < 24 && +mi < 60 && +s < 60
    ) {
      // frac captures the digits only — the leading dot must be put back,
      // or e.g. a link built from Date.toISOString() (.000Z) is rejected.
      const fraction = frac ? `.${frac}` : ''
      const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${fraction}${offset}`)
      if (Number.isFinite(ms)) out.time = new Date(ms).toISOString()
    }
  }
  if (params.has('layer') && DEEP_LINK_LAYERS.includes(params.get('layer'))) {
    out.layer = params.get('layer')
  }
  return out
}

// Serialise the view state syncUrl() writes back to the address bar. Missing
// state is omitted; an empty view yields '' (no query string at all).
function buildDeepLinkQuery(view) {
  const params = new URLSearchParams()
  if (view.lat != null) params.set('lat', view.lat.toFixed(4))
  if (view.lon != null) params.set('lon', view.lon.toFixed(4))
  if (view.zoom != null) params.set('zoom', String(Math.round(view.zoom * 100) / 100))
  if (view.time) params.set('time', view.time.replace('.000Z', 'Z'))
  if (view.layer) params.set('layer', view.layer)
  // ':' is legal inside a query string — keep ISO timestamps readable.
  return params.toString().replaceAll('%3A', ':')
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEEP_LINK_LAYERS, parseDeepLinkParams, buildDeepLinkQuery }
}
