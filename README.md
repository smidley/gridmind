# GridMind

**Personal Tesla Powerwall 3 automation and monitoring app.**

GridMind gives you full control over your Powerwall with real-time monitoring, intelligent automation, solar forecasting, financial tracking, and a smart peak export optimizer — all running as a self-hosted Docker container with zero-config setup.

## Features

### Dashboard
- **Animated Power Flow** — Canvas-based particle animation showing real-time energy flow between Solar, Battery, Home, and Grid. Particle count, size, and speed scale with wattage. Glowing connection paths.
- **Daily Totals** — Generated, exported, consumed energy pulled from Tesla's energy history API
- **Battery Gauge** — SOC-tiered colors (red through emerald to blue), diagonal reserve hatching, shimmer animation when charging/discharging
- **TOU Rate Indicator** — Current rate period (Off-Peak, Mid-Peak, Peak) with $/kWh shown on the Grid tile, pulled from Tesla's tariff data
- **Solar Goal Ring** — Circular progress showing actual vs forecast generation with color-coded achievement
- **Value Indicator** — Today's net value (export credits - import costs) in the status bar
- **Clickable Tiles** — Click any stat tile to drill into a dedicated detail page

### Detail Pages
- **Solar Detail** — Current output, generated/forecast comparison, goal ring, 24h production chart, forecast vs actual overlay, system specs
- **Grid Detail** — Import/export status with TOU badge, daily totals, net credit, value summary, 24h power chart, rate schedule
- **Home Detail** — Current load, consumption, peak load, self-powered percentage, average load, 24h chart
- **Battery Detail** — Full gauge, power stats, charged/discharged today, cycle count, system info, SOC and power history charts

### Solar Forecasting
- **Open-Meteo Integration** — Free solar irradiance forecasts using Global Tilted Irradiance (GTI) for your exact panel tilt and azimuth
- **Forecast vs Actual** — Overlay chart comparing predicted generation with actual production from Tesla
- **Tomorrow's Forecast** — Predicted kWh, peak watts, cloud cover, weather condition
- **Remaining Sunlight** — Hours of sun left and estimated remaining potential energy
- **Calibrated Predictions** — Configurable panel capacity, tilt, azimuth, DC/AC ratio, inverter efficiency, and system losses

### Energy Value
- **Net Value** — Export credits minus import costs (actual grid cash flow)
- **Hourly Value Timeline** — Bar chart showing dollars earned/spent each hour
- **Cumulative Value Curve** — Running total from midnight with TOU period background bands
- **Export Timing Heatmap** — Visual grid showing when exports happened and at what rate
- **Value Sources Pie** — Split between export credits and solar savings
- **Monetary Goals** — Net value and export credits goal rings
- **TOU Period Summary** — Detailed table of exports, imports, and value by rate period

### GridMind Optimize
- **Smart Peak Export** — Intelligent strategy that maximizes TOU export credits
- **How it works**: Holds battery during peak hours, continuously calculates optimal dump timing based on battery SOC, home load, and time remaining, then dumps battery to grid at the perfect moment
- **Dynamic Timing** — Adapts daily based on actual battery level, real-time home consumption, and max discharge rate
- **Dashboard Status** — Prominent card with rotating border glow animation, phase badges (Waiting for Peak, Holding, Dumping, Complete)
- **Persistent** — Survives container restarts

### Off-Grid Mode
- **Grid Disconnect Simulation** — Disables all grid interaction (no imports, no exports)
- **One-click Toggle** — Saves and restores all previous settings on disable
- **Visual Warning** — Red danger theme with caution messaging

### Automation
- **Rule Engine** — Create rules with triggers (time, SOC, load, solar, grid status) and actions (set mode, reserve, storm mode, grid charging, export rule, notifications)
- **Preset Templates** — 7 one-click automation presets: TOU Rate Optimizer, Peak Export Maximizer, Maximum Self-Powered, Low Battery Protection, Grid Outage Alert, High Load Alert, Storm Preparation
- **Execution Logging** — Track when rules fire, what actions ran, success/failure

### Conflict Prevention
- **Mode Manager** — Central controller tracking prevents conflicting settings
- **Blocks**: Off-Grid blocks manual controls + automation; Optimizer during peak blocks manual + automation; Cannot enable Off-Grid + Optimizer simultaneously
- **Visual Warnings** — Settings page shows amber banner when controls are locked

### Light/Dark Mode
- **System Preference Detection** — Auto-follows OS setting
- **Manual Toggle** — Cycle between System, Light, Dark in sidebar
- **Full Theme Support** — All components, charts, tooltips, and cards adapt

### Notifications
- **Email** — SMTP support with HTML templates
- **Webhooks** — Slack, Discord, or generic JSON (auto-detected from URL)

### Settings & Setup
- **Zero-Config Deployment** — Everything configured through the web UI
- **Guided Setup Wizard** — Step-by-step: generate keys, host public key, register, authenticate, discover site
- **Solar Panel Configuration** — Array size, tilt, azimuth dropdown, DC/AC ratio, efficiency, losses
- **Manual Controls** — Operation mode, backup reserve (with conflict prevention)
- **Site Information** — Battery description, storage capacity, max output, firmware version, storm watch mode

## Quick Start

```bash
# Clone the repo
git clone https://github.com/smidley/gridmind.git
cd gridmind

# Build and start (no .env file needed!)
docker compose up -d --build

# Open the dashboard
open http://localhost:8080
```

Then follow the setup wizard in the Settings page.

## Setup Guide

### 1. Register a Tesla Developer App

1. Go to [developer.tesla.com](https://developer.tesla.com) and sign in
2. Create a new Fleet API application:
   - **App name**: GridMind (or anything you like)
   - **OAuth Grant Type**: Authorization Code and Machine-to-Machine
   - **Allowed Origin URLs**: `http://localhost:8080` and `https://yourusername.github.io`
   - **Allowed Redirect URI**: `http://localhost:8080/auth/callback`
   - **Scopes**: `Energy Product Information`, `Energy Product Commands`, `Vehicle Information` (optional), `Vehicle Charging Management` (optional)
3. Save your **Client ID** and **Client Secret**

### 2. Enter Credentials

Open `http://localhost:8080/settings` and enter your Client ID and Client Secret.

### 3. Generate & Host Public Key

Tesla requires a public key hosted at a public URL. GridMind generates the key pair for you.

1. Click **Generate Keys** in Settings
2. Copy the public key
3. Host it at: `https://YOUR-DOMAIN/.well-known/appspecific/com.tesla.3p.public-key.pem`

**Easiest method — GitHub Pages (free, 2 minutes):**
1. Use your `yourusername.github.io` repo
2. Create `.well-known/appspecific/com.tesla.3p.public-key.pem` with the key content
3. Add an empty `.nojekyll` file in the repo root
4. Push — verify at `https://yourusername.github.io/.well-known/appspecific/com.tesla.3p.public-key.pem`

### 4. Register, Authenticate & Discover

1. Enter your domain (e.g., `yourusername.github.io`) and click **Register**
2. Click **Authenticate with Tesla** to complete OAuth
3. Click **Discover Site** to find your Powerwall

### 5. Configure Location & Solar

1. Enter your address — auto-geocoded to coordinates for solar forecasting
2. Configure your solar panel specs (array size, tilt, azimuth, etc.) for accurate forecasts

## Unraid Installation

GridMind is available for Unraid:

1. Docker tab → Add Container → Template Repositories
2. Add: `https://github.com/smidley/unRAID-CA-templates`
3. Search "GridMind" and install

Container image: `ghcr.io/smidley/gridmind:latest` (amd64 + arm64)

## Development

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py  # Runs at http://localhost:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev  # Runs at http://localhost:5173, proxies to backend
```

## Configuration

**All configured via web UI:**
- Tesla credentials, OAuth, Fleet API registration
- Location (address geocoding)
- Solar panel specifications
- Operation mode, reserve, export rules
- GridMind Optimize peak hours
- Automation rules

**Optional environment variables (.env):**
| Variable | Description | Default |
|---|---|---|
| `GRIDMIND_POLL_INTERVAL_SECONDS` | Data collection interval | 30 |
| `GRIDMIND_SMTP_HOST` | Email SMTP server | — |
| `GRIDMIND_SMTP_PORT` | SMTP port | 587 |
| `GRIDMIND_SMTP_USERNAME` | SMTP username | — |
| `GRIDMIND_SMTP_PASSWORD` | SMTP password | — |
| `GRIDMIND_NOTIFICATION_EMAIL` | Notification recipient | — |
| `GRIDMIND_WEBHOOK_URL` | Slack/Discord webhook | — |
| `GRIDMIND_DEBUG` | Debug logging | false |

## Data Persistence

All data is stored in the Docker volume at `/app/data/`:

| File | Contents |
|---|---|
| `setup.json` | Tesla credentials, location, solar config, mode states |
| `tesla_tokens.json` | OAuth access and refresh tokens |
| `gridmind.db` | SQLite: energy readings, automation rules, forecasts, logs |
| `private-key.pem` | EC private key for Fleet API |
| `public-key.pem` | EC public key (hosted on your domain) |

**Important:** Back up `/app/data/` to preserve all settings and history.

## Architecture

```
gridmind/
├── backend/
│   ├── main.py                    # FastAPI app, WebSocket, lifecycle
│   ├── config.py                  # Pydantic settings from env
│   ├── database.py                # SQLAlchemy models + async SQLite
│   ├── tesla/
│   │   ├── client.py              # Fleet API OAuth client (singleton)
│   │   ├── commands.py            # Powerwall read/write commands
│   │   └── models.py             # Pydantic data models
│   ├── automation/
│   │   ├── engine.py             # APScheduler + rule evaluation
│   │   ├── optimizer.py          # GridMind Optimize strategy engine
│   │   ├── rules.py              # Trigger/condition evaluation
│   │   └── actions.py            # Executable actions
│   ├── services/
│   │   ├── collector.py          # Data collection + WebSocket broadcast
│   │   ├── weather.py            # Open-Meteo GTI solar forecast
│   │   ├── notifications.py     # Email + webhook alerts
│   │   ├── geocoding.py          # Nominatim address lookup
│   │   ├── setup_store.py       # Persistent JSON config
│   │   └── mode_manager.py      # Conflict prevention
│   └── api/
│       ├── routes_status.py     # Live status, auth, site info, tariff
│       ├── routes_rules.py      # Automation rules CRUD
│       ├── routes_history.py    # Readings, daily, today, value, forecast
│       └── routes_settings.py   # Setup, solar, optimize, offgrid, controls
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Router, sidebar, theme toggle
│   │   ├── pages/               # Dashboard, Forecast, Value, Rules, History, Settings, Detail*
│   │   ├── components/          # PowerFlowDiagram, BatteryGauge, SolarGoal, MoneyGoal, RuleBuilder, AutomationPresets
│   │   └── hooks/               # useWebSocket, useApi, useAutoRefresh, useTheme
├── Dockerfile                    # Multi-stage: Node build + Python runtime
├── docker-compose.yml           # Volume mount + port 8080
├── .github/workflows/           # CI: multi-arch Docker image to GHCR
└── nginx.conf                   # Optional reverse proxy config
```

## License

MIT License. Not affiliated with Tesla, Inc.
