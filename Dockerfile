# HridayTwin — single-container deploy (clinician console + FastAPI + trained model).
#
#   docker build -t hridaytwin .
#   docker run -p 8000:8000 hridaytwin
#
# data/ and artifacts/ (synthetic cohort + trained model) are committed to the repo, so no
# simulation or training happens at build or start time — the image just serves them.

# ---- Stage 1: build the React clinician console ---------------------------
FROM node:20-slim AS dashboard
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# ---- Stage 2: Python API, serving the built console ------------------------
FROM python:3.12-slim
WORKDIR /app

# lightgbm's shared library needs libgomp at runtime
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY twin_engine/ ./twin_engine/
COPY api/ ./api/
COPY data/ ./data/
COPY artifacts/ ./artifacts/
COPY --from=dashboard /app/dashboard/dist ./dashboard/dist

RUN useradd -m app && chown -R app:app /app
USER app

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
