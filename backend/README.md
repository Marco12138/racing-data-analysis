# Backend API

FastAPI backend for CSV upload analysis.

Run locally:

```bash
pip install -r ../requirements.txt
uvicorn app.main:app --reload --port 8000
```

Main endpoint:

```text
POST /api/analyze
```

Form fields:

- `lap_file`: required lap/sector CSV.
- `telemetry_file`: optional telemetry CSV.

