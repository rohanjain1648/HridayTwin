"""Runtime twin service: everything the API needs, loaded once."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .config import ARTIFACT_DIR, EHR_DIR, HORIZON_HOURS, LOOKBACK_DAYS
from .features import Cohort, build_features
from .livestore import LiveStore
from .model import RiskModel
from .sentinel import CATALOGUE, LinUCB, context_vector, tier, catalogue_json
from .simulator import START
from .twin import Prior, Scenario, apply_scenario, calibrate, driver_contributions, phenotype, project


def iso(hour: float) -> str:
    return (START + pd.Timedelta(hours=float(hour))).isoformat()


def _clean(v):
    if isinstance(v, (np.floating, float)):
        return None if np.isnan(v) else round(float(v), 2)
    if isinstance(v, (np.integer,)):
        return int(v)
    return v


class TwinService:
    def __init__(self):
        self.cohort = Cohort()
        self.model = RiskModel.load()
        self.prior = Prior(**json.loads((ARTIFACT_DIR / "twin_prior.json").read_text()))
        self.bandit = LinUCB.load()
        self.metrics = json.loads((ARTIFACT_DIR / "metrics.json").read_text())
        split = json.loads((ARTIFACT_DIR / "split.json").read_text())
        self.test_ids = split["test"]
        self.history = pd.read_parquet(ARTIFACT_DIR / "risk_history.parquet")
        self._hist = {k: g for k, g in self.history.groupby("patient_id")}
        self.now = self.cohort.H - 6  # demo clock: last day, 18:00
        self.ehr = {k: pd.read_csv(EHR_DIR / f"{k}.csv") for k in ("patients", "conditions", "observations", "medications", "genomics")}
        self.actions: dict[str, list] = {}
        self.livestore = LiveStore()
        self._roster_cache: dict[int, list] = {}

    # ── helpers ───────────────────────────────────────────────────────
    def _t(self, at: int | None) -> int:
        t = self.now if at is None else int(at)
        return int(np.clip(t, LOOKBACK_DAYS * 24, self.cohort.H))

    def _streams(self, pid: str):
        ps = self.cohort.streams(pid)
        samples = self.livestore.active(pid)
        if not samples:
            return ps
        m = ps.copy()
        # Median is robust to the occasional bad camera frame or dropped Bluetooth packet
        hr = np.median([s["hr"] for s in samples if s.get("hr") is not None] or [np.nan])
        hrv = np.median([s["hrv"] for s in samples if s.get("hrv") is not None] or [np.nan])
        win = slice(self.now - 3, self.now)
        if not np.isnan(hr):
            m.hr[win] = hr
        if not np.isnan(hrv):
            base = np.nanmean(ps.hrv[self.now - 168: self.now])
            m.hrv[win] = hrv
            m.stress[win] = np.clip(100 * (1 - hrv / (base * 1.35)), 1, 99)
        return m

    def _risk(self, ps, pid, t):
        X = build_features(ps, self.cohort.static.loc[pid], np.array([t]))
        return float(self.model.predict(X)[0]), X

    # ── roster ────────────────────────────────────────────────────────
    def roster(self, at: int | None = None) -> list[dict]:
        t = self._t(at)
        if t in self._roster_cache and not self.livestore.any_active():
            return self._roster_cache[t]
        pts = self.ehr["patients"].set_index("Id")
        cond = self.ehr["conditions"]
        out = []
        for pid in self.test_ids:
            ps = self._streams(pid)
            p, X = self._risk(ps, pid, t)
            row = X.iloc[0]
            tw = calibrate(ps, self.prior, until_hour=t)
            ph = phenotype(driver_contributions(ps, tw, t))
            info = pts.loc[pid]
            h = self._hist.get(pid)
            spark = h[(h.hour < t) & (h.hour >= t - 168)]["prob"].round(3).tolist() if h is not None else []
            tr = tier(p, _clean(row["cuff_sbp_last"]), _clean(row["cuff_dbp_last"]))
            out.append({
                "id": pid, "name": f"{info.FIRST} {info.LAST}", "age": int(info.AGE), "sex": info.GENDER,
                "city": info.CITY, "risk": round(p, 3), "tier": tr["tier"], "phenotype": ph["primary"],
                "last_sbp": _clean(row["cuff_sbp_last"]), "last_dbp": _clean(row["cuff_dbp_last"]),
                "hrv_change_pct": _clean(row["hrv_24h_vs_7d_pct"]), "sleep_debt": _clean(row["sleep_debt"]),
                "missed_doses": _clean(row["consecutive_missed"]), "myzenn_user": bool(info.MYZENN_USER),
                "conditions": cond.loc[cond.PATIENT == pid, "DESCRIPTION"].tolist(), "spark": spark,
            })
        order = {"crisis": 0, "high": 1, "medium": 2, "low": 3}
        out.sort(key=lambda r: (order[r["tier"]], -r["risk"]))
        if not self.livestore.any_active():
            self._roster_cache[t] = out
        return out

    # ── EHR ───────────────────────────────────────────────────────────
    def ehr_record(self, pid: str) -> dict:
        e = self.ehr
        p = e["patients"].set_index("Id").loc[pid].to_dict()
        obs = e["observations"][e["observations"].PATIENT == pid]
        labs = []
        for (code, desc, unit), g in obs.groupby(["CODE", "DESCRIPTION", "UNITS"]):
            g = g.sort_values("DATE")
            labs.append({"code": code, "name": desc, "unit": unit,
                         "history": [{"date": d, "value": v} for d, v in zip(g.DATE, g.VALUE)],
                         "latest": float(g.VALUE.iloc[-1])})
        return {
            "patient": {k: _clean(v) for k, v in p.items()},
            "conditions": e["conditions"][e["conditions"].PATIENT == pid].drop(columns="PATIENT").to_dict("records"),
            "labs": labs,
            "medications": e["medications"][e["medications"].PATIENT == pid].drop(columns=["PATIENT", "STOP"]).to_dict("records"),
            "genomics": e["genomics"][e["genomics"].PATIENT == pid].drop(columns="PATIENT").replace({np.nan: None}).to_dict("records"),
        }

    # ── streams (last N days) ─────────────────────────────────────────
    def streams(self, pid: str, at: int | None = None, days: int = 7) -> dict:
        t = self._t(at)
        ps = self._streams(pid)
        lo = max(0, t - days * 24)
        hrs = np.arange(lo, t)
        hourly = [{"t": iso(h), "hour": int(h), "hr": _clean(ps.hr[h]), "hrv": _clean(ps.hrv[h]),
                   "steps": _clean(ps.steps[h]), "stress": _clean(ps.stress[h]), "asleep": int(ps.asleep[h]),
                   "session": _clean(ps.session[h]), "salt": _clean(ps.salt_g[h]), "mood": _clean(ps.mood[h])}
                  for h in hrs]
        sl = ps.sleep[(ps.sleep.avail_hour >= lo) & (ps.sleep.avail_hour < t)]
        sleep = [{"date": str(r.date), "total": r.total_sleep_h, "deep": r.deep_pct, "rem": r.rem_pct,
                  "light": r.light_pct, "awake_min": r.awake_min, "efficiency": r.sleep_efficiency}
                 for r in sl.itertuples()]
        cu = ps.cuff[(ps.cuff.hour >= lo) & (ps.cuff.hour < t)]
        cuff = [{"t": iso(r.hour), "hour": float(r.hour), "sbp": int(r.sbp), "dbp": int(r.dbp)} for r in cu.itertuples()]
        d0, d1 = lo // 24, (t - 1) // 24
        doses = [{"date": (START + pd.Timedelta(days=int(d))).date().isoformat(), "taken": int(ps.dose[d]),
                  "visible": bool(d * 24 + 9 < t)} for d in range(d0, d1 + 1)]
        ev = ps.events
        truth = []
        if len(ev):
            w = ev[(ev.onset_hour >= lo) & (ev.onset_hour < t + HORIZON_HOURS)]
            truth = [{"t": iso(r.onset_hour), "hour": int(r.onset_hour), "duration_h": int(r.duration_h),
                      "peak_sbp": float(r.peak_sbp), "future": bool(r.onset_hour >= t), "driver": r.primary_driver}
                     for r in w.itertuples()]
        return {"from": iso(lo), "to": iso(t), "now_hour": t, "hourly": hourly, "sleep": sleep, "cuff": cuff,
                "doses": doses, "ground_truth_events": truth}

    # ── the twin view ─────────────────────────────────────────────────
    def twin(self, pid: str, at: int | None = None) -> dict:
        t = self._t(at)
        ps = self._streams(pid)
        p, X = self._risk(ps, pid, t)
        row = X.iloc[0]
        tw = calibrate(ps, self.prior, until_hour=t)
        contrib = driver_contributions(ps, tw, t)
        proj = project(ps, tw, t)
        recs = []
        for iv in CATALOGUE:
            m = apply_scenario(ps, t, iv.scenario, tw=tw)
            pc, _ = self._risk(m, pid, t)
            pj = project(m, calibrate(m, self.prior, until_hour=t), t, iv.scenario)
            recs.append({"id": iv.id, "name": iv.name, "myzenn_tool": iv.myzenn_tool, "description": iv.description,
                         "risk_after": round(pc, 3), "risk_reduction": round(p - pc, 3), "peak_sbp_after": pj["peak_sbp"]})
        recs.sort(key=lambda r: -r["risk_reduction"])
        x = context_vector({k: _clean(v) if _clean(v) is not None else np.nan for k, v in row.items()}, p)
        bscores = self.bandit.scores(x)
        h = self._hist.get(pid)
        hist = []
        if h is not None:
            w = h[(h.hour >= t - 14 * 24) & (h.hour <= t)]
            hist = [{"t": iso(r.hour), "hour": int(r.hour), "prob": round(float(r.prob), 3)} for r in w.itertuples()]
        return {
            "patient_id": pid, "at": iso(t), "now_hour": t, "risk": round(p, 3),
            "tier": tier(p, _clean(row["cuff_sbp_last"]), _clean(row["cuff_dbp_last"])),
            "explanation": self.model.explain(X),
            "sensitivities": tw.sensitivities(), "n_cuff_readings": tw.n_readings,
            "phenotype": phenotype(contrib), "driver_contributions_mmHg": {k: round(v, 2) for k, v in contrib.items()},
            "projection": proj, "recommendations": recs,
            "sentinel_policy": {"learned_pick": max(bscores, key=lambda a: bscores[a]["mean"]),
                                "scores": {a: round(s["mean"], 4) for a, s in bscores.items()}},
            "risk_history": hist, "live": bool(self.livestore.active(pid)),
            "snapshot": {k: _clean(row[k]) for k in ("cuff_sbp_last", "cuff_dbp_last", "hr_rest_night", "hrv_mean_24h",
                                                        "hrv_24h_vs_7d_pct", "stress_mean_24h", "sleep_last_h", "sleep_debt",
                                                        "doses_last_7d", "consecutive_missed", "salt_logged_48h_g",
                                                        "mood_last", "steps_24h", "myzenn_min_72h")},
        }

    def simulate(self, pid: str, scenario: dict, at: int | None = None) -> dict:
        t = self._t(at)
        ps = self._streams(pid)
        p0, _ = self._risk(ps, pid, t)
        sc = Scenario(**scenario)
        tw0 = calibrate(ps, self.prior, until_hour=t)
        m = apply_scenario(ps, t, sc, tw=tw0)
        p1, _ = self._risk(m, pid, t)
        proj0 = project(ps, tw0, t)
        proj1 = project(m, calibrate(m, self.prior, until_hour=t), t, sc)
        return {"scenario": asdict(sc), "risk_before": round(p0, 3), "risk_after": round(p1, 3),
                "risk_reduction": round(p0 - p1, 3), "projection_before": proj0, "projection_after": proj1}

    # ── care actions & live device ────────────────────────────────────
    def add_action(self, pid: str, action: dict) -> list:
        entry = {**action, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        self.actions.setdefault(pid, []).insert(0, entry)
        return self.actions[pid]

    def ingest_live(self, pid: str, sample: dict) -> dict:
        self.livestore.add(pid, sample.get("source", "bluetooth"), sample.get("hr"), sample.get("hrv"), sample.get("quality"))
        active = self.livestore.active(pid)
        p, X = self._risk(self._streams(pid), pid, self.now)
        row = X.iloc[0]
        return {"risk": round(p, 3), "samples": len(active),
                "tier": tier(p, _clean(row["cuff_sbp_last"]), _clean(row["cuff_dbp_last"]))["tier"],
                "hr_used": _clean(row["hr_mean_24h"]), "hrv_change_pct": _clean(row["hrv_24h_vs_7d_pct"]),
                "stress_24h": _clean(row["stress_mean_24h"])}

    def clear_live(self, pid: str):
        self.livestore.stop(pid)

    def live_history(self, pid: str) -> dict:
        return {"summary": self.livestore.summary(pid), "samples": self.livestore.history(pid),
                "active": len(self.livestore.active(pid))}

    def catalogue(self):
        return catalogue_json()

    # ── suggested replays for the live monitor ────────────────────────
    def replay_presets(self, n: int = 4) -> list[dict]:
        """Held-out moments where a quiet patient gets an early alert before their first surge in 3 days."""
        if getattr(self, "_presets", None) is not None:
            return self._presets
        pts = self.ehr["patients"].set_index("Id")
        found = []
        for pid in self.test_ids:
            g = self._hist.get(pid)
            ev = self.cohort.streams(pid).events
            if g is None or not len(ev):
                continue
            onsets = np.sort(ev["onset_hour"].to_numpy())
            for _, e in ev.sort_values("onset_hour").iterrows():
                on = int(e.onset_hour)
                if ((onsets < on) & (onsets > on - 72)).any():
                    continue
                win = g[(g.hour <= on) & (g.hour > on - HORIZON_HOURS)]
                calm = g[(g.hour <= on - 24) & (g.hour > on - 60)]
                hit = win[win.prob >= 0.3]
                if len(hit) and len(calm) and calm.prob.max() < 0.2:
                    found.append({"patient_id": pid, "name": f"{pts.loc[pid].FIRST} {pts.loc[pid].LAST}",
                                  "start_hour": on - 48, "onset_hour": on, "lead_h": on - int(hit.hour.min()),
                                  "driver": e.primary_driver, "peak_sbp": float(e.peak_sbp), "start": iso(on - 48)})
        found.sort(key=lambda d: -d["lead_h"])
        out, drivers = [], set()
        for d in found:  # prefer a different driver for each preset
            if d["driver"] not in drivers or len(drivers) >= 3:
                out.append(d)
                drivers.add(d["driver"])
            if len(out) == n:
                break
        self._presets = out
        return out
