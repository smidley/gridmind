# GridMind Development Guide

## For AI Agents: Read This First

This file contains everything you need to continue development on GridMind. Read it fully before making changes.

## Project Overview

GridMind is a self-hosted Tesla Powerwall 3 automation and monitoring app. It runs as a single Docker container with a Python/FastAPI backend and React/TypeScript frontend. The user runs it on Unraid at `https://gridmind.smidley.xyz` behind Nginx Proxy Manager with HTTPS.

## Project Location & Git Workflow

- **Code**: `/Users/scottbrant/Documents/solar/gridmind`
- **GitHub**: `smidley/gridmind` (personal account)
- **Work account**: `tiltScott` (default Cursor account)
- **Git config**: local user is `Scott Brant <smidley@gmail.com>`

**CRITICAL — Commit workflow:**
```bash
gh auth switch --user smidley    # Switch BEFORE commit/push
git add -A && git commit -m "message"
git push origin main
gh auth switch --user tiltScott  # Switch BACK after push
```

The user does NOT run locally anymore. All testing happens on Unraid. After pushing, the user updates the Docker container on their Unraid server to test changes. The CI builds multi-arch images automatically via GitHub Actions.

## Tech Stack

- **Backend**: Python 3.12, FastAPI, SQLAlchemy (async SQLite), APScheduler, httpx
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Recharts, Lucide icons
- **Auth**: bcrypt + JWT session cookies, rate-limited login
- **Deployment**: Docker (multi-stage Dockerfile), Docker Compose, GitHub Actions CI → GHCR
- **Unraid**: Template at `smidley/unRAID-CA-templates` (PR #639 to selfhosters/unRAID-CA-templates)
- **PWA**: manifest.json + service worker for installable app on iOS/Android

## Architecture

### Backend Structure
```
backend/
├── main.py                      # FastAPI app, WebSocket, auth middleware, lifecycle
├── config.py                    # Pydantic settings (GRIDMIND_ env prefix), version string
├── database.py                  # SQLAlchemy models: EnergyReading, DailyEnergySummary,
│                                  VehicleChargeReading, AutomationRule, SolarForecast, etc.
├── tesla/
│   ├── client.py                # Fleet API OAuth client (singleton tesla_client)
│   ├── commands.py              # Powerwall read/write commands (cached site_config)
│   ├── vehicle_commands.py      # Vehicle data, charge controls, wake, list
│   └── models.py                # Pydantic models for Powerwall + Vehicle data
├── automation/
│   ├── engine.py                # APScheduler jobs: collector(30s), rules(1m), optimizer(2m),
│   │                              vehicle_collector(30s), charge_scheduler(2m), forecast(6h)
│   ├── optimizer.py             # GridMind Optimize: peak hold → dump strategy
│   │                              Phase persisted to setup_store. Pre-optimize settings saved.
│   ├── charge_scheduler.py      # EV smart scheduling: TOU-aware, solar surplus, departure
│   ├── rules.py                 # Trigger/condition evaluation
│   └── actions.py               # Executable actions (set mode, reserve, notify, etc.)
├── services/
│   ├── collector.py             # Powerwall data collection → DB + WebSocket broadcast
│   ├── vehicle_collector.py     # Vehicle charge data (adaptive polling: 2m/10m/30m/60m)
│   ├── ai_insights.py           # OpenAI insights + anomaly detection (gpt-4o-mini)
│   ├── weather.py               # Open-Meteo: 7-day solar forecast (GTI) + weather codes
│   ├── notifications.py         # Email (SMTP) + webhooks (Slack/Discord) — reads from setup_store
│   ├── app_auth.py              # Password auth: bcrypt hash, JWT sessions, rate limiting
│   ├── setup_store.py           # JSON persistent config (/app/data/setup.json)
│   ├── mode_manager.py          # Conflict prevention between controllers
│   └── geocoding.py             # Nominatim address lookup
└── api/
    ├── routes_status.py         # Live status, auth, site info, tariff
    ├── routes_settings.py       # Setup, solar config, controls, notifications, optimize, offgrid
    ├── routes_history.py        # Readings, daily, today, value, forecast, range-stats, weather
    ├── routes_vehicle.py        # Vehicle status, controls, schedule, WC, charge-source, solar-miles
    ├── routes_health.py         # Powerwall health, throughput, alerts, capacity, savings
    ├── routes_ai.py             # AI insights config, insights, anomalies
    ├── routes_achievements.py   # 22 badges evaluated from existing data
    └── routes_rules.py          # Automation rules CRUD
```

### Frontend Structure
```
frontend/src/
├── App.tsx                      # Router, sidebar nav, mobile nav (MobileNav component),
│                                  auth check, theme toggle, logout
├── pages/
│   ├── Dashboard.tsx            # Power flow, tiles, EV tile, optimizer card, forecast,
│   │                              backup/savings cards, AI insights, storm alert, status bar
│   ├── DetailSolar.tsx          # Solar: time range, production chart, forecast cards (today/tomorrow),
│   │                              vs-actual, tomorrow hourly, cloud cover, 7-day weather, system info
│   ├── DetailHome.tsx           # Home: time range, power sources bar + stacked chart toggle,
│   │                              consumption chart, peak/avg load
│   ├── DetailGrid.tsx           # Grid: time range, import/export with split gradient chart, value
│   ├── DetailBattery.tsx        # Battery: time range, gauge, health (capacity estimation, efficiency,
│   │                              alerts, throughput chart, hardware inventory)
│   ├── Vehicle.tsx              # EV: charge gauge with hybrid limits, detailed status inference,
│   │                              Tesla schedule display, solar miles, charge source, WC status,
│   │                              smart schedule config, stale data/wake handling
│   ├── Value.tsx                # Financial: hourly timeline, cumulative curve, heatmap, TOU table
│   ├── Rules.tsx                # Automation: rules list, optimizer/EV schedule status cards
│   ├── Achievements.tsx         # 22 badges in 6 categories
│   ├── History.tsx              # Historical data charts
│   ├── Settings.tsx             # Tesla creds, location, solar config, auth, notifications, OpenAI,
│   │                              controls, optimize, offgrid, buy me a coffee
│   └── Login.tsx                # Login page (shown when auth enabled)
├── components/
│   ├── PowerFlowDiagram.tsx     # Canvas particle animation (5 nodes: Solar, EV, Battery, Home, Grid)
│   │                              Uses refs for paths (no effect re-run on data update)
│   │                              Light/dark mode aware particles and lines
│   ├── BatteryGauge.tsx         # SOC bar with tier colors, reserve hatching, shimmer
│   ├── ChargeGauge.tsx          # Vehicle SOC bar with hybrid limit markers (grid/solar zones)
│   ├── SolarGoal.tsx            # Circular progress ring
│   ├── TimeRangeSelector.tsx    # Pill bar: Today, 1h, 12h, 24h, 7d + formatChartTime helper
│   ├── RuleBuilder.tsx          # Automation rule creation form
│   ├── AutomationPresets.tsx    # 7 preset automation templates
│   └── MoneyGoal.tsx            # Monetary goal ring
└── hooks/
    ├── useWebSocket.ts          # SINGLETON WebSocketManager class via useSyncExternalStore
    │                              One connection shared across all pages. Ref counting.
    │                              Reconnects on visibility change (phone unlock).
    ├── useApi.ts                # One-time fetch with credentials: 'include'
    ├── useAutoRefresh.ts        # Polling fetch with AbortController, mounted guard,
    │                              visibility change auto-refresh
    └── useTheme.ts              # System/light/dark theme with localStorage
```

## Key Patterns

### Data Flow
- **Powerwall**: collector.py (30s) → EnergyReading DB + WebSocket (`_type: "powerwall"`)
- **Vehicle**: vehicle_collector.py (adaptive) → VehicleChargeReading DB + WebSocket (`_type: "vehicle"`)
- **Frontend**: useWebSocket (singleton) for real-time, useApi/useAutoRefresh for REST fallback
- **All detail pages**: WebSocket primary + API polling fallback (for when WS unavailable behind proxy)

### Tesla API Conventions
- **Battery power**: negative = charging, positive = discharging
- **Grid power**: positive = importing, negative = exporting
- **Vehicle scopes**: `vehicle_device_data` + `vehicle_charging_cmds` (must be on Tesla Developer App)
- **408 response**: Vehicle is asleep — don't wake unless user requests it
- **Wall Connector state**: comes from Powerwall live_status (no car wake needed). State 2 = available, >2 = car connected.

### Optimizer Phase Persistence
- All phase changes use `_set_phase()` which saves to `setup_store`
- Pre-optimize settings (mode, reserve, export rule, grid charging) also persisted
- On startup: reads saved phase from setup_store, validated against current time
- Dump phase switches to `autonomous` mode (self_consumption won't export)

### Theming
- ALL colors must use `dark:` prefix pattern: `text-slate-700 dark:text-slate-300`
- Chart tooltips: CSS-only in `index.css` (no inline contentStyle)
- Chart grid lines: `stroke="#1e293b"` (TODO: should be theme-aware)
- PowerFlowDiagram: detects `dark` class on documentElement for particle rendering

### Authentication
- Password + bcrypt hash stored in setup_store
- JWT session cookie: `gridmind_session`, httponly, samesite=lax, secure=false
- Rate limiting: 5 attempts per IP, 15-minute lockout
- Auth middleware in main.py checks cookie on all `/api/` routes except exempt paths
- Frontend: App.tsx checks auth on load, shows Login.tsx if needed
- All fetch calls use `credentials: 'include'`

### Version Bumping
Update 3 files: `backend/config.py`, `frontend/src/App.tsx` (sidebar footer), `frontend/package.json`

### Adding New Pages
1. Create `frontend/src/pages/NewPage.tsx`
2. Add route in `App.tsx` Routes section
3. Add to `navItems` array (desktop sidebar)
4. Add to `moreItems` in MobileNav component (mobile)
5. Mobile bottom bar `primaryItems` only has 4 slots — use sparingly

### Adding New API Endpoints
1. Create or extend `backend/api/routes_*.py`
2. Register router in `backend/main.py` with `app.include_router()`
3. Add to `AUTH_EXEMPT_PATHS` in main.py if it shouldn't require login

## Current State Summary

### What's Built
- Real-time dashboard with animated 5-node power flow (Solar, EV, Battery, Home, Grid)
- EV charging: discovery, monitoring, controls, smart scheduling (TOU/solar/departure), hybrid limits
- Wall Connector live status and plug detection (works while car sleeps)
- Detailed charge status inference (Charging on Solar, Paused for Powerwall, Waiting for Solar, etc.)
- Miles on Sunshine tracking
- Tesla charge schedule display (TOU/solar from vehicle API)
- Solar page: production, forecast cards, vs-actual, tomorrow hourly, cloud cover, 7-day weather
- GridMind Optimize: peak export with live calculation breakdown
- Powerwall health: capacity estimation, efficiency trending, alerts, throughput, hardware inventory
- Battery health explanation with rating breakdown
- OpenAI insights and anomaly detection
- Achievements (22 badges across 6 categories)
- Time range selector on all detail pages (Today/1h/12h/24h/7d)
- Power source breakdown with stacked chart toggle
- Grid chart with split gradient (red import / green export)
- Cost savings calculator
- 7-day solar + weather forecast with storm watch prediction
- Storm alert banner with one-click 100% reserve
- App authentication with rate limiting
- Notification config in Settings UI (SMTP + webhooks)
- PWA support (installable, offline app shell)
- Mobile responsive with expandable More menu
- Light/dark mode with full theme support
- Auto-refresh on page visibility (phone unlock)
- Buy Me a Coffee integration

### Remaining Backlog
1. **Multi-user accounts** — User registration, per-user data isolation, per-user Tesla/Enphase tokens
2. **Enphase integration** — Solar monitoring via Enphase Cloud API for non-Tesla homes
3. **Multi-site support** — Manage multiple homes/solar systems from one instance
4. **Multi-user SaaS architecture** — Cloud-hosted option with shared developer app, Stripe billing

### Known Issues / Areas for Improvement
- Chart grid lines (`stroke="#1e293b"`) don't adapt to light mode
- Readings endpoint Tesla API fallback uses dateutil.parser which may not be installed
- Optimizer `_check_dump_timing` uses rolling home load average — could be more sophisticated
- Solar miles calculation is approximate (assumes 2-min intervals, 3.5 mi/kWh)
- Some Settings page sections could use better form validation

### User's Setup
- **Powerwall**: Powerwall 3 + 1 Expansion (27 kWh, 11.5 kW)
- **Vehicle**: Model Y (VIN: 7SAYGAEE6PF590793)
- **Wall Connector**: Gen 3 (SAE cable)
- **Location**: Portland, OR (PGE utility, POGE-SCH-7-TOD tariff)
- **Solar**: Configured (tilt/azimuth/capacity in setup_store)
- **Peak hours**: 5 PM - 9 PM
- **Hosting**: Unraid with Docker, HTTPS via Nginx Proxy Manager
- **Domain**: gridmind.smidley.xyz
- **Buy Me a Coffee**: https://buymeacoffee.com/smidley
