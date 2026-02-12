# GridMind

**Personal Tesla Powerwall 3 automation and monitoring app.**

GridMind gives you full control over your Powerwall with real-time monitoring, intelligent automation, solar forecasting, EV charging integration, financial tracking, AI-powered insights, and a smart peak export optimizer — all running as a self-hosted Docker container with zero-config setup.

## Features

### Dashboard
- **Animated Power Flow** — Canvas-based particle animation showing real-time energy flow between Solar, Battery, Home, Grid, and EV. Particle count, size, and speed scale with wattage. Glowing connection paths. Light/dark mode optimized.
- **Daily Totals** — Generated, exported, consumed energy pulled from Tesla's energy history API
- **Battery Gauge** — SOC-tiered colors (red through emerald to blue), diagonal reserve hatching, shimmer animation when charging/discharging
- **TOU Rate Indicator** — Current rate period (Off-Peak, Mid-Peak, Peak) with $/kWh shown on the Grid tile, pulled from Tesla's tariff data
- **Solar Goal Ring** — Circular progress showing actual vs forecast generation with color-coded achievement
- **Value Indicator** — Today's net value (export credits - import costs) in the status bar
- **Clickable Tiles** — Click any stat tile to drill into a dedicated detail page
- **EV Tile** — Vehicle SOC, charge status, and range with mini charge bar (click to open Vehicle page)
- **AI Insights** — OpenAI-powered energy observations, tips, and anomaly alerts

### Detail Pages
- **Solar Detail** — Current output, generated/forecast comparison, goal ring, 24h production chart, forecast vs actual overlay, system specs
- **Grid Detail** — Import/export status with TOU badge, daily totals, net credit, value summary, 24h power chart, rate schedule
- **Home Detail** — Current load, consumption, peak load, self-powered percentage, average load, 24h chart
- **Battery Detail** — Full gauge, power stats, charged/discharged today, cycle count, system info, SOC and power history charts, health diagnostics, throughput trending, hardware inventory

### EV Charging Integration
- **Vehicle Discovery** — Automatically finds Tesla vehicles on your account via the Fleet API
- **Real-Time Charge Monitoring** — Live SOC, range, charge rate (kW), voltage, amps, time to full, energy added per session
- **Power Flow Node** — Vehicle appears as a violet node in the dashboard power flow diagram with animated particles when charging
- **Charge Source Breakdown** — Live proportional split showing how much charge power comes from Solar, Powerwall, or Grid
- **Charge Controls** — Start/stop charging, charge limit slider (50-100%), all from the web UI
- **Wall Connector Status** — Gen 3 Wall Connector hardware info, live power output, health/fault monitoring, serial number
- **Miles on Sunshine** — Tracks how many miles have been charged from solar energy (today + all-time)
- **Adaptive Polling** — 2 min when charging, 10 min when plugged in, 30 min when idle, 60 min when asleep. Never wakes a sleeping vehicle.

### Smart Charge Scheduling
- **TOU-Aware** — Automatically pauses charging during peak rate periods and resumes during off-peak
- **Solar Surplus** — Charges only when solar production exceeds home consumption, dynamically adjusts amperage to match available surplus
- **Departure Planner** — Set departure time and target SOC; calculates optimal charge start time, prefers off-peak hours
- **Hybrid Solar Charge Limit** — Charge from any source up to a grid limit (e.g., 80%), then only charge from solar surplus up to a solar limit (e.g., 100%)

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
- **Dashboard Status** — Prominent card with rotating border glow animation. Distinguishes between Exporting (actually sending to grid), Powering Home (battery serving home load during peak), Holding, and Complete phases.
- **Persistent** — Survives container restarts; immediately detects peak hours on startup

### Powerwall Health Monitoring
- **System Diagnostics** — Grid connectivity status, backup time remaining, installation age, utility and tariff info
- **Battery Health Estimation** — Estimates effective capacity from deep charge cycles (30%+ SOC swing), tracks health percentage vs nominal capacity over time
- **Round-Trip Efficiency** — Tracks energy in vs energy out, trend chart for degradation monitoring
- **Peak Power Tracking** — Records max charge and discharge rates daily for long-term trending
- **Alert Detection** — Automatically detects grid outages (with duration), low SOC events, and Storm Watch activation from 7-day reading history
- **Lifetime Statistics** — Total charged/discharged kWh, battery cycles, average daily cycles, self-powered percentage
- **Daily Throughput Chart** — 30-day bar chart of daily charge and discharge amounts
- **Hardware Inventory** — Lists all system components (Powerwall 3 gateway, expansion packs, Wall Connector) with serial numbers, part numbers, firmware versions, and active status

### AI Insights (OpenAI)
- **Energy Insights** — AI-generated daily observations: achievements, optimization tips, pattern analysis, and warnings. Analyzes 7 days of history plus live data and solar forecast.
- **Anomaly Detection** — Compares current energy patterns against a 30-day baseline to flag unusual activity (unexpected grid imports, consumption spikes, production drops)
- **Cost Efficient** — Uses gpt-4o-mini. Insights cached for 1 hour, anomalies for 30 minutes.
- **Optional** — Configure your OpenAI API key in Settings. All features work without it.

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
- **EV Scheduler** — Registered as a controller; warns when manual EV charge changes may be overridden
- **Visual Warnings** — Settings page shows amber banner when controls are locked

### Light/Dark Mode
- **System Preference Detection** — Auto-follows OS setting
- **Manual Toggle** — Cycle between System, Light, Dark in sidebar
- **Full Theme Support** — All components, charts, tooltips, cards, and power flow particles adapt to theme

### Notifications
- **Email** — SMTP support with HTML templates
- **Webhooks** — Slack, Discord, or generic JSON (auto-detected from URL)

### Settings & Setup
- **Zero-Config Deployment** — Everything configured through the web UI
- **Guided Setup Wizard** — Step-by-step: generate keys, host public key, register, authenticate, discover site
- **Solar Panel Configuration** — Array size, tilt, azimuth dropdown, DC/AC ratio, efficiency, losses
- **Manual Controls** — Operation mode, backup reserve (with conflict prevention)
- **Site Information** — Battery description, storage capacity, max output, firmware version, storm watch mode
- **Vehicle Selection** — Discover and select which Tesla to monitor
- **OpenAI Configuration** — Add/remove API key for AI-powered insights

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
   - **Scopes** (required): `Energy Product Information`, `Energy Product Commands`
   - **Scopes** (for EV features): `Vehicle Information`, `Vehicle Charging Management`
3. Save your **Client ID** and **Client Secret**

> **Unraid / remote server users**: The Redirect URI must match the URL you use to access GridMind in your browser. If GridMind is running on a server (e.g., Unraid at `192.168.1.100`), use `http://192.168.1.100:8080/auth/callback` instead of `localhost`. Add this URL to both:
> 1. Your Tesla Developer App's **Allowed Redirect URIs** at developer.tesla.com
> 2. The **Redirect URI** field in GridMind's Settings page
>
> You can add multiple redirect URIs to the Tesla app if you access GridMind from different addresses.

> **Note on EV scopes**: If you add vehicle scopes after your initial setup, you must revoke GridMind's access at [tesla.com/teslaaccount](https://www.tesla.com/teslaaccount) → Security → Third-Party Apps, then re-authenticate. Existing tokens don't retroactively gain new scopes.

### 2. Enter Credentials

Open `http://YOUR-SERVER-IP:8080/settings` (or `http://localhost:8080/settings` if running locally) and enter your Client ID, Client Secret, and Redirect URI.

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

### 6. Set Up Vehicle (Optional)

1. Navigate to the **Vehicle** page in the sidebar
2. Select your Tesla from the discovered vehicles list
3. Charge data, controls, Wall Connector status, and the dashboard EV node will activate

### 7. Set Up AI Insights (Optional)

1. Get an API key from [platform.openai.com](https://platform.openai.com)
2. In Settings, scroll to **AI Insights (OpenAI)** and paste your key
3. AI-powered insights and anomaly detection will appear on the Dashboard

## Unraid Installation

**Option A — Community Apps (pending approval):**
1. Go to **Apps** → **Settings** (gear icon)
2. Add template repository: `https://github.com/smidley/unraid-templates`
3. Go back to **Apps**, search "GridMind", and install

**Option B — Manual:**
1. **Docker** tab → **Add Container**
2. **Repository**: `ghcr.io/smidley/gridmind:latest`
3. Add **Port**: Host `8080` → Container `8000` (TCP)
4. Add **Path**: Host `/mnt/user/appdata/gridmind` → Container `/app/data` (RW)
5. Click **Apply**

Container image: `ghcr.io/smidley/gridmind:latest` (amd64 + arm64)

> **Important**: When setting up Tesla OAuth on Unraid, use your server's IP address for the Redirect URI (e.g., `http://192.168.1.100:8080/auth/callback`), not `localhost`. See [Step 1](#1-register-a-tesla-developer-app) for details.

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
- Vehicle selection
- Smart charge schedule (TOU-aware, solar surplus, departure planner)
- OpenAI API key

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
| `setup.json` | Tesla credentials, location, solar config, vehicle selection, mode states, EV schedule, OpenAI key |
| `tesla_tokens.json` | OAuth access and refresh tokens |
| `gridmind.db` | SQLite: energy readings, vehicle charge readings, automation rules, forecasts, logs |
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
│   │   ├── vehicle_commands.py    # Vehicle data + charge commands
│   │   └── models.py             # Pydantic models (Powerwall + Vehicle)
│   ├── automation/
│   │   ├── engine.py             # APScheduler + rule evaluation
│   │   ├── optimizer.py          # GridMind Optimize strategy engine
│   │   ├── charge_scheduler.py   # Smart EV charge scheduling
│   │   ├── rules.py              # Trigger/condition evaluation
│   │   └── actions.py            # Executable actions
│   ├── services/
│   │   ├── collector.py          # Powerwall data collection + WebSocket
│   │   ├── vehicle_collector.py  # Vehicle data collection (adaptive polling)
│   │   ├── ai_insights.py       # OpenAI insights + anomaly detection
│   │   ├── weather.py            # Open-Meteo GTI solar forecast
│   │   ├── notifications.py     # Email + webhook alerts
│   │   ├── geocoding.py          # Nominatim address lookup
│   │   ├── setup_store.py       # Persistent JSON config
│   │   └── mode_manager.py      # Conflict prevention
│   └── api/
│       ├── routes_status.py     # Live status, auth, site info, tariff
│       ├── routes_rules.py      # Automation rules CRUD
│       ├── routes_history.py    # Readings, daily, today, value, forecast
│       ├── routes_settings.py   # Setup, solar, optimize, offgrid, controls
│       ├── routes_vehicle.py    # Vehicle status, controls, schedule, wall connector
│       ├── routes_health.py     # Powerwall health, throughput, alerts, capacity
│       └── routes_ai.py         # AI insights, anomaly detection, config
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Router, sidebar, theme toggle
│   │   ├── pages/               # Dashboard, Vehicle, Forecast, Value, Rules, History, Settings, Detail*
│   │   ├── components/          # PowerFlowDiagram, BatteryGauge, ChargeGauge, SolarGoal, MoneyGoal, RuleBuilder
│   │   └── hooks/               # useWebSocket (singleton), useApi, useAutoRefresh, useTheme
├── Dockerfile                    # Multi-stage: Node build + Python runtime
├── docker-compose.yml           # Volume mount + port 8080
├── .github/workflows/           # CI: multi-arch Docker image to GHCR
└── nginx.conf                   # Optional reverse proxy config
```

## API Endpoints

### Powerwall
| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | Live Powerwall status |
| GET | `/api/site/config` | Site configuration |
| GET | `/api/site/tariff` | Current TOU rate period |
| GET | `/api/history/today` | Today's energy totals |
| GET | `/api/history/readings` | Historical readings (1-168h) |
| GET | `/api/history/value` | Financial value calculation |
| GET | `/api/history/forecast` | Solar generation forecast |

### Vehicle
| Method | Path | Description |
|---|---|---|
| GET | `/api/vehicle/list` | Discover vehicles |
| POST | `/api/vehicle/select` | Select vehicle to monitor |
| GET | `/api/vehicle/status` | Current charge state |
| POST | `/api/vehicle/charge/start` | Start charging |
| POST | `/api/vehicle/charge/stop` | Stop charging |
| POST | `/api/vehicle/charge/limit` | Set charge limit % |
| GET | `/api/vehicle/charge-source` | Charging power source breakdown |
| GET | `/api/vehicle/wall-connector` | Wall Connector status |
| GET | `/api/vehicle/solar-miles` | Miles charged from solar |
| GET/POST | `/api/vehicle/schedule` | Smart charge schedule config |

### Health
| Method | Path | Description |
|---|---|---|
| GET | `/api/powerwall/health` | System diagnostics |
| GET | `/api/powerwall/health/throughput` | Battery throughput stats |
| GET | `/api/powerwall/health/alerts` | Health alerts |
| GET | `/api/powerwall/health/capacity` | Capacity estimation |

### AI
| Method | Path | Description |
|---|---|---|
| GET | `/api/ai/status` | OpenAI configuration status |
| POST | `/api/ai/configure` | Save API key |
| GET | `/api/ai/insights` | AI energy insights |
| GET | `/api/ai/anomalies` | AI anomaly detection |

## License

MIT License. Not affiliated with Tesla, Inc.
