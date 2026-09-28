"""
Real-time replay: plays a patient's streams forward one hour per tick, the way a live wearable
feed would arrive, and re-runs the twin on every tick.

Each tick carries the new sensor readings for that hour, the updated 24 h risk, and events:
cuff readings, doses, check-ins, MySentinel alerts (with drivers and the recommended protocol)
and, for evaluation only, the moment a real surge begins.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import TRUTH_DIR, SURGE_SBP, TIER_HIGH, TIER_MEDIUM
from .features import build_features
from .sentinel import TIERS, tier as tier_of
from .service import TwinService, iso, _clean
from .twin import apply_scenario, calibrate

TIER_RANK = {"low": 0, "medium": 1, "high": 2, "crisis": 3}
TIER_FLOOR = {"high": TIER_HIGH, "medium": TIER_MEDIUM}
HYSTERESIS = 0.05       # risk must fall this far below a tier's threshold before it is released
ALERT_COOLDOWN_H = 12   # MySentinel rule: never re-alert the same tier within 12 hours


class TruthStore:
    """Hidden ambulatory BP, loaded lazily. Sent to the UI only as an evaluation overlay."""

    def __init__(self):
        self._by_pid = None

    def get(self, pid: str) -> np.ndarray:
        if self._by_pid is None:
            t = pd.read_parquet(TRUTH_DIR / "abpm_hourly.parquet", columns=["patient_id", "sbp"])
            self._by_pid = {k: g["sbp"].to_numpy() for k, g in t.groupby("patient_id", sort=False)}
        return self._by_pid[pid]


class ReplaySession:
    def __init__(self, svc: TwinService, truth: TruthStore, pid: str, start: int, end: int | None = None):
        self.svc, self.pid = svc, pid
        self.ps = svc.cohort.streams(pid)
        self.static = svc.cohort.static.loc[pid]
        self.truth = truth.get(pid)
        self.hour = int(np.clip(start, 7 * 24, svc.cohort.H - 1))
        self.end = int(min(end or svc.cohort.H, svc.cohort.H))
        self.last_tier = None
        self.last_alert: dict[str, int] = {}
        ev = self.ps.events
        self.onsets = {int(r.onset_hour): r for r in ev.itertuples()} if len(ev) else {}

    def done(self) -> bool:
        return self.hour >= self.end

    def _recommendation(self, t: int, base: float) -> dict | None:
        tw = calibrate(self.ps, self.svc.prior, until_hour=t)
        best = None
        from .sentinel import CATALOGUE
        for iv in CATALOGUE:
            m = apply_scenario(self.ps, t, iv.scenario, tw=tw)
            p = float(self.svc.model.predict(build_features(m, self.static, np.array([t])))[0])
            if best is None or base - p > best["risk_reduction"]:
                best = {"id": iv.id, "name": iv.name, "myzenn_tool": iv.myzenn_tool,
                        "risk_after": round(p, 3), "risk_reduction": round(base - p, 3)}
        return best

    def _stable_tier(self, risk: float, raw: str) -> str:
        """Tier with hysteresis, so a risk hovering at a threshold doesn't flap between tiers."""
        last = self.last_tier
        if last is None or raw == "crisis" or TIER_RANK[raw] >= TIER_RANK[last]:
            return raw
        floor = TIER_FLOOR.get(last)
        if floor is not None and risk >= floor - HYSTERESIS:
            return last
        return raw

    def tick(self) -> dict:
        h = self.hour
        ps = self.ps
        t = h + 1  # hour h has fully arrived; predict from here
        X = build_features(ps, self.static, np.array([t]))
        risk = float(self.svc.model.predict(X)[0])
        row = X.iloc[0]
        raw = tier_of(risk, _clean(row["cuff_sbp_last"]), _clean(row["cuff_dbp_last"]))
        stable = self._stable_tier(risk, raw["tier"])
        tr = raw if stable == raw["tier"] else dict(TIERS[stable])

        events = []
        cu = ps.cuff[(ps.cuff["hour"] >= h) & (ps.cuff["hour"] < h + 1)]
        cuff = [{"sbp": int(r.sbp), "dbp": int(r.dbp)} for r in cu.itertuples()]
        for c in cuff:
            events.append({"type": "cuff", "text": f"Home cuff reading {c['sbp']}/{c['dbp']} mmHg"})
        if h % 24 == 9 and h // 24 < len(ps.dose):
            taken = bool(ps.dose[h // 24])
            events.append({"type": "dose" if taken else "missed_dose",
                           "text": "Morning dose logged by smart pillbox" if taken else "Morning dose missed (pillbox)"})
        if not np.isnan(ps.mood[h]):
            events.append({"type": "mood", "text": f"MyZenn mood check-in: {int(ps.mood[h])}/10"})
        if ps.salt_g[h] > 0:
            events.append({"type": "salt", "text": f"Salty meal logged (+{ps.salt_g[h]:.0f} g salt)"})
        if ps.session[h] > 0:
            events.append({"type": "session", "text": f"MyZenn session completed ({ps.session[h]:.0f} min)"})

        if self.last_tier is None:
            events.append({"type": "start", "text": f"Monitoring started: risk {round(risk * 100)}% ({tr['label'].lower()})"})
        escalated = self.last_tier is not None and TIER_RANK[tr["tier"]] > TIER_RANK[self.last_tier]
        cooled = h - self.last_alert.get(tr["tier"], -10**6) >= ALERT_COOLDOWN_H
        if escalated and tr["tier"] != "low" and cooled:
            self.last_alert[tr["tier"]] = h
            expl = self.svc.model.explain(X, top=3)
            drivers = [g["group"] for g in expl["groups"] if g["impact"] > 0][:3]
            rec = self._recommendation(t, risk)
            events.append({"type": "alert", "tier": tr["tier"],
                           "text": f"{tr['label']}: risk {round(risk * 100)}%. Drivers: {', '.join(drivers)}.",
                           "recommendation": rec,
                           "action": tr["action"]})
        elif self.last_tier is not None and TIER_RANK[tr["tier"]] < TIER_RANK[self.last_tier]:
            events.append({"type": "deescalate", "text": f"Risk eased to {round(risk * 100)}% ({tr['label'].lower()})"})
        self.last_tier = tr["tier"]

        onset = self.onsets.get(h)
        if onset is not None:
            events.append({"type": "surge", "text": f"Actual surge began (evaluation only): peak {onset.peak_sbp:.0f} mmHg "
                                                     f"for {onset.duration_h} h"})

        out = {
            "type": "tick", "hour": h, "t": iso(h),
            "hr": _clean(ps.hr[h]), "hrv": _clean(ps.hrv[h]), "steps": _clean(ps.steps[h]),
            "stress": _clean(ps.stress[h]), "asleep": int(ps.asleep[h]),
            "cuff": cuff, "risk": round(risk, 3), "tier": tr["tier"],
            "truth_sbp": round(float(self.truth[h]), 1), "truth_surge": bool(self.truth[h] >= SURGE_SBP),
            "events": events,
        }
        self.hour += 1
        return out
