# GridMind

**Personal Tesla Powerwall 3 automation and monitoring app.**

GridMind gives you full control over your Powerwall with time-based scheduling, load-based automation, solar forecasting, and a real-time web dashboard — all running as a self-hosted Docker container.

## Features

- **Real-time Dashboard** — Live power flow visualization, battery SOC, solar production, grid import/export
- **Automation Rules** — Time-of-day schedules, SOC triggers, load-based control, grid status reactions
- **Manual Control** — Instantly change operation mode, backup reserve, storm mode from the UI
- **Solar Forecast** — Free weather-based solar generation predictions via Open-Meteo
- **TOU Rate Optimization** — Configure your utility rate schedule for smart charge/discharge
- **Notifications** — Email (SMTP) and webhook (Slack/Discord) alerts
- **Historical Data** — Energy charts with power flow, SOC, and daily summaries

## Prerequisites

1. **Tesla Fleet API credentials** — Register at [developer.tesla.com](https://developer.tesla.com)
   - App name: GridMind
   - Scopes: `energy_device_data`, `energy_cmds`
   - Redirect URI: `http://localhost:8080/auth/callback`

2. **Docker** and **Docker Compose** installed on your server

## Quick Start

```bash
# Clone or copy the project
cd /path/to/solar/gridmind

# Build and start (no .env file needed!)
docker compose up -d --build

# Open the dashboard
open http://localhost:8080
```

On first launch, the Settings page will walk you through setup:
1. **Enter your Tesla API credentials** (Client ID and Secret from developer.tesla.com)
2. **Enter your address** to set your location (used for solar forecasts)
3. **Click "Connect Tesla Account"** to authorize with Tesla
4. GridMind will auto-discover your Powerwall and start collecting data

No environment variables or config files required -- everything is configured through the web UI.

## Development (without Docker)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example ../.env
python main.py
```

Backend runs at `http://localhost:8000`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173` and proxies API calls to the backend.

## Configuration

All settings are via environment variables (prefix: `GRIDMIND_`). See `.env.example` for the full list.

**Configured via Web UI (Settings page):**
- Tesla Fleet API Client ID and Secret
- Location (enter your address, auto-geocoded to coordinates)
- Tesla OAuth connection

**Optional environment variables (.env file):**
- `GRIDMIND_POLL_INTERVAL_SECONDS` - Data collection interval (default: 30)
- `GRIDMIND_SMTP_HOST` / `GRIDMIND_SMTP_*` - Email notification settings
- `GRIDMIND_WEBHOOK_URL` - Slack/Discord webhook URL
- `GRIDMIND_DEBUG` - Enable debug logging (default: false)

## Architecture

```
gridmind/
├── backend/
│   ├── main.py              # FastAPI app + WebSocket
│   ├── config.py             # Settings from env
│   ├── database.py           # SQLAlchemy models + SQLite
│   ├── tesla/
│   │   ├── client.py         # Fleet API OAuth + HTTP client
│   │   ├── commands.py        # Powerwall control functions
│   │   └── models.py         # Pydantic data models
│   ├── automation/
│   │   ├── engine.py         # APScheduler-based automation
│   │   ├── rules.py          # Rule evaluation logic
│   │   └── actions.py        # Executable actions
│   ├── services/
│   │   ├── collector.py      # Periodic data collection
│   │   ├── weather.py        # Open-Meteo solar forecast
│   │   └── notifications.py  # Email + webhook alerts
│   └── api/
│       ├── routes_status.py  # Live status + auth endpoints
│       ├── routes_rules.py   # CRUD for automation rules
│       ├── routes_history.py # Historical data queries
│       └── routes_settings.py # Powerwall control + TOU rates
├── frontend/                  # React + Vite + Tailwind
├── Dockerfile                 # Multi-stage build
├── docker-compose.yml
└── nginx.conf
```

## Automation Rule Examples

**Peak Hours Self-Powered:**
- Trigger: Time = 16:00, Mon-Fri
- Action: Set mode to Self-Powered, Set reserve to 80%

**Low Battery Grid Charge:**
- Trigger: SOC <= 15%
- Condition: Time is off-peak
- Action: Enable grid charging, Notify "Battery low, charging from grid"

**Grid Outage Alert:**
- Trigger: Grid status = Islanded
- Action: Notify "Grid power lost — running on battery"

## License

Personal use. Not affiliated with Tesla, Inc.
