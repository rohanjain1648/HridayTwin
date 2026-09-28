"""
HridayTwin API.

    uvicorn api.main:app --reload --port 8000

Serves the clinician dashboard (dashboard/dist) at / when it has been built.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from twin_engine.config import ARTIFACT_DIR, ROOT
from twin_engine.service import TwinService, iso
from twin_engine.streaming import ReplaySession, TruthStore

app = FastAPI(title="HridayTwin API", version="1.0.0",
              description="Stress-aware hypertension digital twin (Happiest Health Digital Twin Challenge 2026, built on MyZenn)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

svc: TwinService | None = None
truth = TruthStore()


def service() -> TwinService:
    global svc
    if svc is None:
        svc = TwinService()
    return svc


def _check(pid: str):
    if pid not in service().cohort.static.index:
        raise HTTPException(404, f"Unknown patient {pid}")


class ScenarioIn(BaseModel):
    sleep_extra_h: float = Field(0, ge=0, le=3)
    breathing_min: float = Field(0, ge=0, le=40)
    adherence: bool = False
    low_salt: bool = False
    steps_extra: float = Field(0, ge=0, le=10000)


class SimulateIn(BaseModel):
    scenario: ScenarioIn
    at: int | None = None


class ActionIn(BaseModel):
    type: str
    detail: str = ""
    intervention_id: str | None = None


class LiveIn(BaseModel):
    hr: float | None = Field(None, ge=30, le=220)
    hrv: float | None = Field(None, ge=3, le=250)
    quality: float | None = Field(None, ge=0, le=1)
    source: str = Field("bluetooth", pattern="^(bluetooth|camera|demo)$")


@app.on_event("startup")
def _warm():
    service()


@app.get("/api/health")
def health():
    s = service()
    return {"status": "ok", "patients": len(s.cohort.patient_ids), "test_patients": len(s.test_ids), "now_hour": s.now}


@app.get("/api/model/metrics")
def metrics():
    return service().metrics


@app.get("/api/interventions")
def interventions():
    return service().catalogue()


@app.get("/api/patients")
def patients(at: int | None = None):
    return service().roster(at)


@app.get("/api/patients/{pid}")
def patient(pid: str):
    _check(pid)
    return service().ehr_record(pid)


@app.get("/api/patients/{pid}/streams")
def streams(pid: str, at: int | None = None, days: int = 7):
    _check(pid)
    return service().streams(pid, at, min(max(days, 1), 21))


@app.get("/api/patients/{pid}/twin")
def twin(pid: str, at: int | None = None):
    _check(pid)
    return service().twin(pid, at)


@app.post("/api/patients/{pid}/simulate")
def simulate(pid: str, body: SimulateIn):
    _check(pid)
    return service().simulate(pid, body.scenario.model_dump(), body.at)


@app.get("/api/patients/{pid}/actions")
def get_actions(pid: str):
    return service().actions.get(pid, [])


@app.post("/api/patients/{pid}/actions")
def add_action(pid: str, body: ActionIn):
    _check(pid)
    return service().add_action(pid, body.model_dump())


@app.post("/api/live/{pid}")
def live(pid: str, body: LiveIn):
    _check(pid)
    return service().ingest_live(pid, body.model_dump())


@app.delete("/api/live/{pid}")
def live_clear(pid: str):
    service().clear_live(pid)
    return {"ok": True}


@app.get("/api/stream/presets")
def stream_presets():
    return service().replay_presets()


@app.get("/api/live/{pid}/history")
def live_history(pid: str):
    _check(pid)
    return service().live_history(pid)


@app.websocket("/ws/stream/{pid}")
async def stream(ws: WebSocket, pid: str, start: int | None = None, interval: float = 1.0):
    """Real-time replay. Client may send {"cmd": "pause" | "resume"} or {"cmd": "speed", "interval": seconds}."""
    await ws.accept()
    s = service()
    if pid not in s.cohort.static.index:
        await ws.close(code=4404)
        return
    sess = ReplaySession(s, truth, pid, start if start is not None else s.now - 96)
    paused = False
    interval = min(max(interval, 0.1), 10.0)
    await ws.send_json({"type": "start", "patient_id": pid, "start_hour": sess.hour, "end_hour": sess.end,
                        "t": iso(sess.hour)})
    try:
        while not sess.done():
            if not paused:
                await ws.send_json(await asyncio.to_thread(sess.tick))
            try:
                cmd = await asyncio.wait_for(ws.receive_json(), timeout=interval)
                if cmd.get("cmd") == "pause":
                    paused = True
                elif cmd.get("cmd") == "resume":
                    paused = False
                elif cmd.get("cmd") == "speed":
                    interval = min(max(float(cmd.get("interval", 1.0)), 0.1), 10.0)
            except asyncio.TimeoutError:
                pass
        await ws.send_json({"type": "end", "hour": sess.hour})
        await ws.close()
    except WebSocketDisconnect:
        pass


if (ARTIFACT_DIR / "plots").exists():
    app.mount("/plots", StaticFiles(directory=ARTIFACT_DIR / "plots"), name="plots")

DIST = ROOT / "dashboard" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
