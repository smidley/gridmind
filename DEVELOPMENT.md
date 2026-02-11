# GridMind Development Guide

## Current State (v1.0.0)

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

### Remaining Backlog
1. **OpenAI integration** - AI insights, natural language rules, anomaly detection
2. **EV charging integration** - Vehicle charge state, smart scheduling (scopes already added)
3. **Powerwall health monitoring** - Diagnostics, alerts, connectivity

### Known Considerations
- Off-grid mode restore: saves/restores export_rule from Tesla config
- Optimizer restores export to `battery_ok` at peak end (not pv_only)
- TOU bands in value chart: extend each band to next period start (no gaps)
- Hours without Tesla energy data get correct TOU period from schedule
- Setup store falls back to env vars if not set in JSON
