# Changelog

All notable changes to this project will be documented in this file.

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
