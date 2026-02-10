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
- **Guided Setup** — Step-by-step wizard in the web UI, no config files needed

## Quick Start

```bash
# Pull and start (or clone the repo and build)
docker compose up -d --build

# Open the dashboard
open http://localhost:8080
```

Then follow the setup wizard in the Settings page. No `.env` file or environment variables required.

## Setup Guide

GridMind walks you through each step in the web UI. Here's an overview:

### 1. Register a Tesla Developer App

1. Go to [developer.tesla.com](https://developer.tesla.com) and sign in
2. Create a new Fleet API application:
   - **App name**: GridMind (or anything you like)
   - **OAuth Grant Type**: Authorization Code and Machine-to-Machine
   - **Allowed Origin URL**: `http://localhost:8080`
   - **Allowed Redirect URI**: `http://localhost:8080/auth/callback`
   - **Scopes**: `Energy Product Information` and `Energy Product Commands`
3. Save your **Client ID** and **Client Secret**

### 2. Enter Credentials in GridMind

Open `http://localhost:8080/settings` and enter your Client ID and Client Secret in the Tesla Fleet API Credentials section.

### 3. Generate & Host Your Public Key

Tesla requires a public key hosted at a URL they can verify. GridMind generates the key pair for you — click **Generate Keys** in the Settings page.

Then host the public key at:
```
https://YOUR-DOMAIN/.well-known/appspecific/com.tesla.3p.public-key.pem
```

**Easiest method — GitHub Pages (free, 2 minutes):**

1. Create a GitHub repo named `yourusername.github.io` (or use an existing one)
2. Create the file `.well-known/appspecific/com.tesla.3p.public-key.pem` with the public key GridMind shows you
3. Add an empty `.nojekyll` file in the repo root (so GitHub serves dotfiles)
4. Push to GitHub — Pages is automatically enabled for `*.github.io` repos
5. Verify at: `https://yourusername.github.io/.well-known/appspecific/com.tesla.3p.public-key.pem`

### 4. Register & Authenticate

Back in GridMind Settings:
1. Enter your domain (e.g., `yourusername.github.io`) and click **Register**
2. Click **Authenticate with Tesla** to complete the OAuth flow
3. Click **Discover Site** to find your Powerwall

That's it! GridMind will start collecting data and you can create automation rules.

### 5. Set Your Location

Enter your address in the Location section — it's automatically geocoded to coordinates for solar forecasting.

## Unraid Installation

GridMind is available in the Unraid Community Apps store. Search for "GridMind" or install manually:

1. Go to Docker tab → Add Container → Template Repositories
2. Add: `https://github.com/smidley/unRAID-CA-templates`
3. Search for "GridMind" and click Install

The container image is `ghcr.io/smidley/gridmind:latest` (multi-arch: amd64 + arm64).

## Development (without Docker)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
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

**Configured via Web UI (Settings page):**
- Tesla Fleet API Client ID and Secret
- Public key generation and Fleet API registration
- Location (enter your address, auto-geocoded to coordinates)
- Tesla OAuth connection
- Operation mode, backup reserve, storm mode

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
│   │   ├── notifications.py  # Email + webhook alerts
│   │   ├── geocoding.py      # Address to coordinates (Nominatim)
│   │   └── setup_store.py    # Persistent config (JSON file)
│   └── api/
│       ├── routes_status.py  # Live status + auth endpoints
│       ├── routes_rules.py   # CRUD for automation rules
│       ├── routes_history.py # Historical data queries
│       └── routes_settings.py # Setup, control, TOU rates
├── frontend/                  # React + Vite + Tailwind
├── Dockerfile                 # Multi-stage build
├── docker-compose.yml
└── .github/workflows/         # CI: auto-build Docker image
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

**Cloudy Day Pre-charge:**
- Trigger: Solar forecast < 5 kWh (tomorrow)
- Action: Enable grid charging overnight at off-peak rates

## License

MIT License. Not affiliated with Tesla, Inc.
