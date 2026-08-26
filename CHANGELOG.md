# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- localStorage cache writes are batched and quota-aware: instead of one synchronous `JSON.stringify` + write per fetched grid point (≈ 500 per viewport ≈ 5 MB — past the typical localStorage quota, where writes silently failed), writes are queued and flushed in batches (after a fetch batch completes, on `pagehide`, or every 100 pending entries); when the quota is hit, expired then oldest entries are evicted automatically, and persistence degrades gracefully to memory-only for the session

### Added
- Test suite (`node --test`): syntax smoketest for the inline webapp script and functional tests for the localStorage cache (deferred writes, quota eviction, graceful degradation) run in a `vm` sandbox with a quota-limited localStorage stub

## [0.2.2] — 2026-06-10

### Fixed
- `signalk.appIcon` path corrected from `./public/icon.svg` to `./icon.svg` — the `public/` directory is the web root, so the icon was a 404 in the webapps list
- Removed `signalk-embeddable-webapp` keyword — no module federation bundle exists, which caused the app-dock to repeatedly request a missing `remoteEntry.js`

## [0.2.1] — 2026-06-10

### Fixed
- SignalK plugin registration: `schema: null` (empty `{}` triggered a CI warning about missing JSON Schema fields)
- Added `package-lock.json` to `.gitignore` to prevent CI from flagging it as an untracked file

## [0.2.0] — 2026-06-10

### Added
- **Pressure layer** — canvas heatmap with numeric hPa label overlay; palette goes from dark blue (storm/low < 960 hPa) through cyan, green (≈ 1013), orange to dark red (anticyclone > 1022 hPa), following meteorological convention
- **Collapsible panel** — toggle button folds the control panel and legend into a single-line summary showing the selected model and layer; state persisted in `localStorage`

### Fixed
- Antimeridian rendering: longitude normalised in both `computeGrid` and the heatmap pixel loop; bilinear interpolation no longer produces a seam at ±180°
- Provider isolation: `rerenderAll` and `updateLayerButtons` now filter cache entries by provider prefix, preventing cross-provider colour contamination when switching sources
- Network errors (DNS failure, offline) are now retried like HTTP 5xx — 3 attempts with 500 ms / 1 s back-off, abort-aware
- Source-change race condition: `refreshGen` counter and abort signal fired immediately on source change, not after async setup
- Forecast slider no longer jumps when new timestamps are prepended during progressive loading (`ingestTimes` preserves the current ISO timestamp across re-sorts)
- `updateLayerButtons` regression: a premature `break` caused all layer buttons to be hidden whenever any single layer was available; replaced with an all-layers-found guard and a 30-entry scan cap
- `discoverSources` retries up to 4 times with exponential back-off on server startup races
- `memCache` is now periodically swept every 5 minutes to release expired entries and bound memory growth
- `fmtUtc` now shows real minutes instead of hardcoded `:00`
- `pickForecast` memoises `Date.parse()` results on forecast objects to avoid per-render allocations

### Removed
- Dead state: `rainLayers` Map, `tempColor`, `windColor`, `precipStyle`, `LOOKUP_STEPS` constant, `removeBarb` alias

## [0.1.0] — 2026-06-09

### Added
- Leaflet map with OSM tiles
- Wind barb overlay (standard meteorological convention)
- Gust barb overlay
- Temperature layer (colour-coded cell fill with numeric label)
- Cloudiness layer (grey transparency)
- Precipitation layer (colour-coded intensity scale)
- Automatic grid density based on zoom level
- Forecast time slider (browses all steps from the weather provider)
- Multi-provider support via SignalK Weather API `_providers` endpoint
- "Set as default provider" button
- Client-side cache (localStorage + memory, 30-minute TTL)
- Parallel batch fetching (15 concurrent requests, closest-first)
- Vessel position marker oriented to true heading
- i18n: French and English based on browser language
- SVG icon (wind barb on dark blue background)
