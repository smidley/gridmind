# GridMind Development Guide

## Current State (v1.1.0)

### Tech Stack
- **Backend**: Python 3.12, FastAPI, SQLAlchemy (async SQLite), APScheduler
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Recharts, Lucide icons
- **Deployment**: Docker (multi-stage), Docker Compose, GitHub Actions CI (GHCR)
- **Unraid**: Template at `smidley/unRAID-CA-templates`

### Project Location
- **Code**: `/Users/scottbrant/Documents/solar/gridmind`
- **GitHub**: `smidley/gridmind` (use `gh auth switch --user smidley` before push)
- **Work account**: `tiltScott` (always switch back after push)
- **Git config**: local user is `Scott Brant <smidley@gmail.com>`

### Key Architecture
- `backend/tesla/client.py` - Tesla Fleet API OAuth client (singleton `tesla_client`)
- `backend/tesla/commands.py` - Powerwall control commands, caches site_info
- `backend/automation/engine.py` - APScheduler: data collector (30s), rules (1m), optimizer (2m), forecast (6h)
- `backend/automation/optimizer.py` - GridMind Optimize strategy engine
- `backend/automation/rules.py` - Rule evaluation with cooldown
- `backend/services/setup_store.py` - JSON file persistent config (`/app/data/setup.json`)
- `backend/services/mode_manager.py` - Conflict prevention between modes
- `backend/services/collector.py` - Polls Powerwall, stores readings, feeds WebSocket
- `backend/services/weather.py` - Open-Meteo solar forecast with GTI
- `backend/api/routes_*.py` - REST API endpoints

### Tesla API Notes
- **Battery power convention**: negative = charging, positive = discharging
- **Grid power convention**: positive = importing, negative = exporting
- **Export rule for TOU mode**: must be `battery_ok` (everything), not `pv_only`
- **Tariff data**: comes from `site_info.tariff_content`, includes TOU periods and sell rates
- **Energy history**: `calendar_history?period=day&kind=energy` for daily totals, `kind=power` for hourly
- **Auth**: Fleet API requires domain registration + public key hosting (user has `smidley.github.io`)

### Important Patterns
- **Version bump**: update 3 files: `backend/config.py`, `frontend/src/App.tsx`, `frontend/package.json`
- **Rebuild**: `docker compose up -d --build` (container at localhost:8080)
- **Commit**: switch to smidley, commit, push, switch back to tiltScott
- **Caching**: Tesla API responses cached 2 min in `routes_history.py` (`_get_cached`)
- **Auto-refresh**: frontend uses `useAutoRefresh` hook (30s for data, 60s for tariff)
- **Theme**: Tailwind `dark:` classes, `useTheme` hook, body gets `dark` class
- **All persistent data** in Docker volume at `/app/data/`

### Completed Features
1. Real-time dashboard with canvas particle power flow animation
2. Solar forecast (Open-Meteo GTI, calibrated to panel config)
3. Forecast vs Actual overlay chart
4. Solar generation goals (circular progress ring)
5. Value/earnings page with hourly timeline, cumulative curve, export heatmap
6. Monetary goals (MoneyGoal component)
7. TOU rate display from Tesla tariff data (timezone-aware)
8. Automation rules engine with CRUD API
9. Automation presets (7 templates)
10. GridMind Optimize (smart peak export strategy with dynamic dump timing)
11. Off-Grid mode toggle
12. Conflict prevention (mode_manager)
13. Light/dark mode with system preference
14. Battery gauge with SOC-tier colors, reserve hatching, shimmer animation
15. Clickable detail pages (Solar, Grid, Home, Battery)
16. Settings: Tesla credentials, location geocoding, solar panel config
17. Setup wizard with key generation and Fleet API registration
18. GitHub Actions CI (multi-arch Docker to GHCR)
19. Unraid Community Apps template
20. EV charging integration (vehicle discovery, charge monitoring, controls, smart scheduling)

### EV Charging Architecture (v1.1.0)
- `backend/tesla/vehicle_commands.py` - Fleet API vehicle endpoints (list, data, charge controls, wake)
- `backend/tesla/models.py` - VehicleSummary, ChargeState, VehicleStatus Pydantic models
- `backend/database.py` - VehicleChargeReading time-series table
- `backend/services/vehicle_collector.py` - Adaptive polling (2m charging, 10m plugged, 30m idle, 60m asleep)
- `backend/api/routes_vehicle.py` - `/api/vehicle/*` REST endpoints
- `backend/automation/charge_scheduler.py` - Smart scheduling: TOU-aware, solar surplus, departure planner
- `frontend/src/pages/Vehicle.tsx` - Vehicle page with gauge, stats, controls, charts, schedule panel
- `frontend/src/components/ChargeGauge.tsx` - SOC gauge with charge limit marker and shimmer
- Dashboard EV tile with SOC bar, charge status, range
- Sidebar nav item for Vehicle page
- WebSocket extended with `_type` field for multiplexed powerwall/vehicle messages

### Powerwall Health Monitoring (v1.1.0)
- `backend/api/routes_health.py` - `/api/powerwall/health`, `/health/throughput`, `/health/alerts`
- Health endpoint: system info, connectivity (grid/island), backup time remaining, hardware inventory
- Throughput: daily charge/discharge history, lifetime cycles, self-powered %, energy totals
- Alerts: detects grid outages, low SOC events, storm watch from reading history (7 day window)
- Frontend: Battery detail page enhanced with health cards, alerts, throughput chart, hardware inventory

### OpenAI Integration (v1.1.0)
- `backend/services/ai_insights.py` - OpenAI-powered insight generation and anomaly detection
- `backend/api/routes_ai.py` - `/api/ai/status`, `/ai/configure`, `/ai/insights`, `/ai/anomalies`
- Settings UI: OpenAI API key config (stored in setup_store, masked)
- Dashboard: AI Insights card (achievements, tips, warnings) + anomaly alerts
- Uses gpt-4o-mini for cost efficiency; insights cached 1h, anomalies cached 30min
- Insights: analyzes 7 days of daily summaries + today's data + forecast
- Anomalies: compares recent readings against 30-day baseline, flags deviations

### Remaining Backlog
1. **Multi-user accounts** — User registration, per-user data isolation, site switcher
2. **Enphase integration** — Solar monitoring via Enphase Cloud API for non-Tesla homes
3. **Multi-site support** — Manage multiple homes/solar systems from one instance
4. **Multi-user SaaS architecture** — Cloud-hosted option with single Tesla/Enphase developer app for all users

### EV Charging Notes
- **Vehicle polling**: Adaptive — collector runs every 30s but internally skips based on state (uses `should_poll_now()`)
- **Vehicle sleep**: 408 response means vehicle is asleep; don't wake unless user requests it
- **Smart schedule config**: Stored in `setup_store` under `ev_schedule` key
- **WebSocket multiplexing**: Messages now include `_type: "powerwall"` or `_type: "vehicle"` field
- **Charge scheduler strategies**: TOU-aware (pause during peak), solar surplus (amps proportional to surplus), departure planner (calculate start time from target SOC)
- **Mode manager**: EV scheduler registered at same priority as automation (doesn't conflict with Powerwall controls)
- **Vehicle scopes**: `vehicle_device_data` + `vehicle_charging_cmds` already in OAuth scope string

### Known Considerations
- Off-grid mode restore: saves/restores export_rule from Tesla config
- Optimizer restores export to `battery_ok` at peak end (not pv_only)
- TOU bands in value chart: extend each band to next period start (no gaps)
- Hours without Tesla energy data get correct TOU period from schedule
- Setup store falls back to env vars if not set in JSON
