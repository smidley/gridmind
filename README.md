<p align="center">
  <img src="gridmind.png" alt="GridMind" width="400" />
</p>

<h1 align="center">GridMind</h1>

<p align="center">
  <strong>Smart energy automation and real-time monitoring</strong><br>
  Real-time power flow · EV charging · Solar forecasting · Smart export optimization · AI insights<br>
  <a href="https://buymeacoffee.com/smidley">
    <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Support-yellow?style=flat&logo=buy-me-a-coffee" alt="Buy Me a Coffee" />
  </a>
  <img src="https://img.shields.io/badge/version-1.10.0-blue" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/platform-amd64-lightgrey" alt="Platform" />
</p>

---

GridMind gives you full control over your home energy system with a beautiful real-time dashboard, intelligent automation, EV charging integration, and AI-powered insights — all running as a self-hosted Docker container. Currently supports Tesla Powerwall, with plans for additional battery systems.

## Screenshots

<table>
  <tr>
    <td><img src="dashboard_dark.png" alt="Dashboard (Dark)" width="400" /><br><em>Dashboard with power flow</em></td>
    <td><img src="dashboard_light.png" alt="Dashboard (Light)" width="400" /><br><em>Light mode</em></td>
  </tr>
  <tr>
    <td><img src="vehicle.png" alt="Vehicle" width="400" /><br><em>EV charging & Wall Connector</em></td>
    <td><img src="battery.png" alt="Battery Health" width="400" /><br><em>Battery health & diagnostics</em></td>
  </tr>
  <tr>
    <td><img src="home.png" alt="Home Sources" width="400" /><br><em>Home power source breakdown</em></td>
    <td><img src="achievements.png" alt="Achievements" width="400" /><br><em>Achievements & badges</em></td>
  </tr>
</table>

## Quick Start

```bash
# Pull and run (no build required)
docker run -d \
  --name gridmind \
  -p 8080:8000 \
  -v /path/to/data:/app/data \
  --restart unless-stopped \
  ghcr.io/smidley/gridmind:latest

# Open the dashboard
open http://localhost:8080
```

Or with Docker Compose:

```yaml
services:
  gridmind:
    image: ghcr.io/smidley/gridmind:latest
    ports:
      - "8080:8000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

Then follow the setup wizard in Settings. **All configuration is done through the web UI — no environment variables needed.**

## Features

### Real-Time Dashboard

An animated canvas-based power flow diagram shows energy moving between Solar, Battery, Home, Grid, and your EV in real-time. Particle count, size, and speed scale with actual wattage. Click any node to navigate to its detail page. All numeric values animate with smooth count-up transitions. Live pulse indicators show data is streaming.

### GridMind Optimize

Smart peak export strategy that maximizes your TOU export credits:
- **Peak Hold**: Holds battery in self-consumption during peak to avoid grid imports at peak rates
- **Smart Dump Timing**: Calculates the optimal moment to start exporting based on battery SOC, rolling average home load, and time remaining — finishes right before peak ends
- **Load Protection**: If home load causes grid imports during a dump, automatically pauses export to serve the home first, then resumes
- **Decision Engine**: Click the optimize card to expand an inline thinking feed showing the optimizer's real-time reasoning
- **Complete Restore**: Properly restores reserve, mode, grid charging, and export settings after each cycle

### VPP Peak Events

Schedule utility demand response / Virtual Power Plant events for premium export rates:
- Enter date, time window, and premium rate per kWh
- Optimizer treats VPP events as **highest priority** — overrides all normal TOU logic
- Purple-themed visuals across the entire UI during active events
- Live earnings counter on the Dashboard
- Per-event rate tracking in value calculations
- Achievement badges for participation milestones

### EV Charging Integration

Discover your Tesla vehicle automatically. Monitor charge state, range, and power in real-time. Start/stop charging and adjust the charge limit from the web UI. Track "Miles on Sunshine."

**Smart Charge Scheduling:**
| Strategy | How it works |
|---|---|
| **TOU-Aware** | Pauses charging during peak rates, resumes off-peak |
| **Solar Surplus** | Only charges from excess solar, dynamically adjusts amps |
| **Departure Planner** | Calculates optimal start time for your target SOC by departure |
| **Hybrid Limit** | Any source to 80%, then solar-only to 100% (configurable) |

### AI Insights

Dedicated AI Insights page with interactive follow-up questions. Choose from **three AI providers**:
- **Google Gemini** (free tier)
- **Groq** (free tier)
- **OpenAI** (paid)

Features:
- **Energy Insights**: 3-5 specific, actionable observations based on 7-day trends
- **Anomaly Detection**: Flags genuine issues (not normal patterns like optimizer dumps or EV charging)
- **Monthly Bill Estimate**: AI-projected monthly electricity bill including energy charges, export credits, fixed fees, and taxes
- **Interactive Follow-ups**: Click any insight to see follow-up questions; click a question to get a streaming AI response in real-time

### Grid Energy Mix

Real-time grid fuel source data from the EIA API:
- Stacked bar chart showing hourly fuel breakdown (hydro, wind, solar, gas, coal, etc.)
- Clean energy percentage with colored badge on the Grid power flow tile when importing
- Clean Energy % trend line with current hour highlighted
- Clean grid preference: automatically switches to self-consumption when grid is fossil-heavy

### TOU Rate Schedule

Visual 24-hour rate schedule on the Grid page showing Off-Peak, Mid-Peak, and Peak periods as a color-coded bar with the current hour highlighted. Shows weekday and weekend schedules.

### Solar Forecasting

Free 7-day solar forecast via Open-Meteo using Global Tilted Irradiance (GTI) calibrated to your panel tilt and azimuth. Forecast vs actual overlay chart. Tomorrow's prediction with weather conditions.

### Battery Health

Battery capacity estimation from charge cycles (using local-time-aware cycle detection), round-trip efficiency tracking, peak power trends, and degradation monitoring. Grid outage detection with debouncing, low SOC alerts (suppressed during optimizer dumps), and Storm Watch notifications.

### Energy Value

Track financial performance: export credits, import costs, net value, solar savings. Hourly value timeline with TOU period bands. VPP event earnings tracked separately with per-event breakdown. GridMind Optimize savings calculated from historical data. Lifetime system value with break-even tracking.

### Achievements

Badges across multiple categories: Solar milestones, Battery cycles, Grid independence, Financial goals, EV solar miles, System uptime, and **VPP Events** (Grid Hero, Power Broker, etc.).

### Automation

Create rules with triggers and actions. 7 preset templates included. VPP Peak Events scheduling with premium rate export.

### Backup & Restore

Download a ZIP backup of your database, configuration, and Tesla tokens from Settings.

### Additional Features

- **Light/Dark Mode** — Warm stone palette (light) / cool slate palette (dark)
- **Animated Values** — All numbers count up on page load and smoothly transition on updates
- **Live Pulse Indicators** — Green dots signal live data streaming
- **Clickable Power Flow** — Click any node to navigate to its detail page
- **Off-Grid Mode** — Simulate grid disconnect with one click
- **Time Range Selector** — Today, 1h, 12h, 24h, 7d on all detail pages
- **Notifications** — Email (SMTP) and webhooks (Slack/Discord)
- **App Authentication** — Password login with rate limiting
- **Mobile Responsive** — PWA support, installable on iOS/Android
- **Auto-Refresh** — Data refreshes on tab visibility change

## Setup Guide

### Step 1: Register a Tesla Developer App

1. Go to [developer.tesla.com](https://developer.tesla.com) and sign in
2. Create a new Fleet API application:
   - **App name**: GridMind
   - **OAuth Grant Type**: Authorization Code and Machine-to-Machine
   - **Allowed Origin URLs**: `http://localhost:8080`
   - **Allowed Redirect URI**: `http://localhost:8080/auth/callback`
   - **Scopes**: `Energy Product Information`, `Energy Product Commands`
   - **For EV features** (optional): also enable `Vehicle Information` and `Vehicle Charging Management`
3. Save your **Client ID** and **Client Secret**

> **Running on a server (Unraid, etc.)?** Use your server's URL for the redirect URI (e.g., `https://gridmind.yourdomain.com/auth/callback`). Tesla only allows `http://` for localhost — remote servers need HTTPS via a reverse proxy.

### Step 2: Enter Credentials

Open GridMind in your browser and go to **Settings**. Enter your Client ID, Client Secret, and Redirect URI.

### Step 3: Generate & Host Public Key

Tesla requires a public key at a public URL. GridMind generates the key pair for you.

1. Click **Generate Keys** in Settings
2. Copy the public key
3. Host it at: `https://YOUR-DOMAIN/.well-known/appspecific/com.tesla.3p.public-key.pem`

**Easiest method — GitHub Pages (free, 2 minutes):**

1. Create or use your `yourusername.github.io` repo
2. Create `.well-known/appspecific/com.tesla.3p.public-key.pem` with the key content
3. Add an empty `.nojekyll` file in the repo root
4. Push and verify the URL works

### Step 4: Register, Authenticate & Discover

1. Enter your domain and click **Register**
2. Click **Authenticate with Tesla** — complete the OAuth flow
3. Click **Discover Site** to find your Powerwall

### Step 5: Configure Location & Solar

1. Enter your address — auto-geocoded for solar forecasting
2. Configure panel specs (capacity, tilt, azimuth, efficiency)

### Step 6: Vehicle Setup (Optional)

Go to the **Vehicle** page and select your Tesla. Charge monitoring, controls, and the dashboard EV node will activate.

### Step 7: Enable Authentication (Recommended)

Go to **Settings** → **App Authentication** and set a username/password.

### Step 8: AI Insights (Optional)

Go to **Settings** → **AI Insights** and select a provider. Gemini and Groq offer free tiers with generous limits.

## Unraid Installation

**Option A — Community Apps:**

1. Go to **Apps** → **Settings** (gear icon)
2. Add template repository: `https://github.com/smidley/unraid-templates`
3. Search "GridMind" and install

**Option B — Manual:**

1. **Docker** → **Add Container**
2. **Repository**: `ghcr.io/smidley/gridmind:latest`
3. Add **Port**: Host `8080` → Container `8000` (TCP)
4. Add **Path**: Host `/mnt/user/appdata/gridmind` → Container `/app/data` (RW)
5. Click **Apply**

> **Important**: For OAuth, set up HTTPS via Nginx Proxy Manager or similar. Tesla requires HTTPS for non-localhost redirect URIs.

## Data Persistence

All data is stored in the Docker volume at `/app/data/`:

| File                | Contents                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `setup.json`        | All settings: Tesla credentials, location, solar config, vehicle, schedules, notifications, AI config, VPP events |
| `tesla_tokens.json` | OAuth access and refresh tokens                                                                        |
| `gridmind.db`       | SQLite: energy readings, vehicle charge history, automation rules, forecasts, achievements             |
| `private-key.pem`   | EC private key for Fleet API                                                                           |
| `public-key.pem`    | EC public key (hosted on your domain)                                                                  |

**Back up `/app/data/` to preserve all settings and history.** A backup can also be downloaded from Settings.

## Development

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py  # http://localhost:8000

# Frontend
cd frontend
npm install
npm run dev  # http://localhost:5173
```

## Tech Stack

- **Backend**: Python 3.12, FastAPI, SQLAlchemy (async SQLite), APScheduler
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Recharts
- **AI**: OpenAI SDK (supports OpenAI, Google Gemini, Groq via base_url)
- **Deployment**: Docker (multi-stage), GitHub Actions CI (GHCR)
- **APIs**: Tesla Fleet API, Open-Meteo, EIA (grid energy mix), AI providers

## Color Reference

| Element | Color | Usage |
|---|---|---|
| Solar | Amber | Generation, forecasts |
| Battery | Blue | SOC, charge/discharge |
| Home | Cyan | Consumption, load |
| Grid Import | Red | Importing from grid |
| Grid Export | Emerald | Exporting to grid |
| EV / Vehicle | Orange | Charging, vehicle status |
| VPP Events | Purple | Premium export events |

## Support

If GridMind is useful to you, consider buying me a coffee:

<a href="https://www.buymeacoffee.com/smidley" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

## License

MIT License. Not affiliated with Tesla, Inc.
