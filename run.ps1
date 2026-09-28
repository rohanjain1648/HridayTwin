# HridayTwin one-command setup (Windows PowerShell)
python -m pip install -r requirements.txt
if (-not (Test-Path data/ehr/patients.csv)) { python -m twin_engine.simulator --patients 400 --days 60 }
if (-not (Test-Path artifacts/risk_model.txt)) { python -m twin_engine.train }
if (-not (Test-Path dashboard/dist/index.html)) { Push-Location dashboard; npm install; npm run build; Pop-Location }
Write-Host "Open http://localhost:8000"
python -m uvicorn api.main:app --port 8000
