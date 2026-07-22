# AI Racing Telemetry Analysis Platform

Web MVP for uploading lap/sector CSV, telemetry CSV, and onboard video metadata, then generating a Formula 1 engineering-style telemetry dashboard and basic driver performance report.

Phase 1 is intentionally focused: upload data, validate fields, analyze laps and sectors, visualize sector loss, surface heuristic driving behavior flags, and generate a structured AI-style review. It is not a full AI coach.

## Project Structure

```text
racing-ai-platform/
├── app/                         # Next/Sites route shell
├── frontend/                    # React + TypeScript dashboard code
│   ├── components/
│   └── lib/
├── backend/                     # FastAPI backend
│   └── app/
│       ├── main.py
│       ├── analysis/
│       ├── models/
│       └── utils/
├── data/                        # Sample CSV files
├── requirements.txt             # Python backend dependencies
├── package.json                 # Frontend dependencies
└── README.md
```

The frontend is deployed from the project root because the Sites runtime expects the Next app there. Product-specific React code lives in `frontend/`.

## Frontend Setup

```bash
pnpm install
pnpm run dev
```

Open:

```text
http://localhost:3000
```

## Backend Setup

```bash
pip install -r requirements.txt
cd backend
uvicorn app.main:app --reload --port 8000
```

Backend health check:

```text
GET http://localhost:8000/health
```

Main analysis endpoint:

```text
POST http://localhost:8000/api/analyze
```

Form fields:

- `lap_file`: required lap/sector CSV.
- `telemetry_file`: optional telemetry CSV.

## Supported Inputs

### Lap/Sector CSV

```csv
lap,lap_time,sector_1,sector_2,sector_3,notes
1,52.341,17.232,18.104,17.005,warm up
2,51.884,17.041,17.932,16.911,
```

The app automatically detects all `sector_` columns.

### Telemetry CSV

```csv
time,lap,distance,speed,throttle,brake,steering_angle,rpm,gear,lateral_g,longitudinal_g,gps_lat,gps_lon
0.000,1,0.0,42.1,0.0,0.0,2.1,6500,3,0.12,0.03,,
```

Advanced analysis is skipped or marked lower-confidence if telemetry channels are missing.

### Video

The Phase 1 frontend accepts `mp4` and `mov` uploads as a UI workflow. Full backend video processing is reserved for the next phase.

## Implemented MVP Features

- Dark Formula 1 engineering dashboard visual style.
- Session overview cards.
- Lap/Sector CSV upload and validation.
- Telemetry CSV upload and validation.
- Video upload panel and timeline placeholder.
- Fastest lap detection.
- Theoretical best lap.
- Potential gain.
- Lap delta analysis.
- Sector loss stacked bar chart.
- Sector best and average comparison.
- Reference lap vs target lap speed difference by distance.
- Telemetry summary: max speed, average speed, throttle, brake, corner speed, lateral G.
- Driving Behavior Assistant with possible understeer and possible oversteer flags.
- AI Driver Review generated from structured findings.
- FastAPI backend with `/api/analyze` endpoint.
- Local SQLite session record storage.

## Heuristic Analysis Notice

Handling analysis is a heuristic assistant, not a definitive vehicle dynamics diagnosis. Final interpretation should be validated by a driver or coach.

The current understeer and oversteer detection is rule-based and lower-confidence without `yaw_rate`, GPS trajectory, and richer vehicle dynamics channels.

## Roadmap

### Phase 1

- Upload data.
- Lap analysis.
- Sector comparison.
- Basic dashboard.

### Phase 2

- Race Studio 3 data import.
- GPS trajectory.
- Speed comparison.
- Brake/throttle analysis.

### Phase 3

- Computer vision.
- Vehicle behavior recognition.
- Automatic corner detection.

### Phase 4

- Multi-driver comparison.
- Coach feedback system.
- Machine learning prediction.

## Server Deployment

For a traditional server:

1. Build the frontend with `pnpm run build`.
2. Serve the frontend with the chosen Node/edge runtime.
3. Run FastAPI with `uvicorn` or behind Gunicorn/Uvicorn workers.
4. Put Nginx/Caddy in front for HTTPS, static routing, and reverse proxying `/api` to FastAPI.
5. Mount persistent storage for uploaded files and SQLite, or replace SQLite with Postgres when sessions need to be shared across machines.

