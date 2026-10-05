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

// Date-time without a timezone designator (a space separator is tolerated).
const DEEP_LINK_NAIVE_TIME = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?)?$/

function parseDeepLinkParams(search) {
  const params = new URLSearchParams(search)
  const out = {}
  if (params.has('lat')) {
    const lat = Number.parseFloat(params.get('lat'))
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90) out.lat = lat
  }
  if (params.has('lon')) {
    const lon = Number.parseFloat(params.get('lon'))
    if (Number.isFinite(lon)) out.lon = ((lon % 360) + 540) % 360 - 180
  }
  if (params.has('zoom')) {
    const zoom = Number.parseFloat(params.get('zoom'))
    if (Number.isFinite(zoom)) out.zoom = Math.min(DEEP_LINK_MAX_ZOOM, Math.max(0, zoom))
  }
  if (params.has('time')) {
    let value = params.get('time').trim()
    if (DEEP_LINK_NAIVE_TIME.test(value)) {
      value = value.replace(' ', 'T') + 'Z'
    } else {
      // URLSearchParams decodes '+' as a space — restore it in timezone offsets.
      value = value.replace(/ (\d{2}:\d{2})$/, '+$1')
    }
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) out.time = new Date(ms).toISOString()
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
