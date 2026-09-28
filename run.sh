#!/usr/bin/env bash
# HridayTwin one-command setup (macOS / Linux)
set -e
python -m pip install -r requirements.txt
[ -f data/ehr/patients.csv ] || python -m twin_engine.simulator --patients 400 --days 60
[ -f artifacts/risk_model.txt ] || python -m twin_engine.train
[ -f dashboard/dist/index.html ] || (cd dashboard && npm install && npm run build)
echo "Open http://localhost:8000"
python -m uvicorn api.main:app --port 8000
