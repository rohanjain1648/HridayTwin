"""
MySentinel for hypertension: turns a prediction into an action.

- Policy tiers (from MyZenn's MySentinel plan): crisis → MySafe escalation; high → clinician alert +
  patient protocol; medium → patient nudge; low → weekly digest.
- Intervention catalogue: each option maps to a MyZenn tool (or a care action) and to a twin Scenario,
  so its benefit can be simulated on this patient's twin before it is prescribed.
- A LinUCB contextual bandit (Python port of MyZenn's `src/lib/rl/LinUCB.ts`) learns which intervention
  works for which context. It is pre-trained "in silico" on the twin cohort, then keeps learning from
  real outcomes in deployment.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict

import numpy as np

from .config import CRISIS_SBP, CRISIS_DBP, TIER_HIGH, TIER_MEDIUM, ARTIFACT_DIR
from .twin import Scenario


@dataclass
class Intervention:
    id: str
    name: str
    myzenn_tool: str
    description: str
    scenario: Scenario


CATALOGUE = [
    Intervention("breath", "Slow-breathing protocol", "MyBreath",
                 "2 × 10 min guided breathing at 6 breaths/min (morning + before bed)", Scenario(breathing_min=20)),
    Intervention("sleep", "Sleep wind-down", "MyBody + MyPeace",
                 "Body-scan and wind-down audio at 22:00 to gain ~1 h of sleep", Scenario(sleep_extra_h=1.0, breathing_min=5)),
    Intervention("adherence", "Adherence rescue", "Smart pillbox + reminders",
                 "Dose reminders, refill check and a pharmacist call-back", Scenario(adherence=True)),
    Intervention("salt", "Low-salt coaching", "MyZenn diet coach",
                 "DASH-India meal swaps; skip pickles, papad and namkeen for 72 h", Scenario(low_salt=True)),
    Intervention("move", "Active recovery", "MyYoga",
                 "Gentle yoga flow + a 30-minute brisk walk", Scenario(steps_extra=3000, breathing_min=5)),
]
ARM_IDS = [i.id for i in CATALOGUE]


TIERS = {
    "crisis": {"tier": "crisis", "label": "Crisis-range reading",
               "action": "MySafe escalation: call the patient now; ER advice if symptomatic"},
    "high": {"tier": "high", "label": "High risk (next 24 h)",
             "action": "Clinician alert + patient protocol pushed via MyZenn"},
    "medium": {"tier": "medium", "label": "Elevated risk",
               "action": "Patient nudge via MyZenn; review at next check-in"},
    "low": {"tier": "low", "label": "Stable", "action": "Included in weekly digest"},
}


def tier(prob: float, last_sbp: float | None, last_dbp: float | None) -> dict:
    if (last_sbp or 0) >= CRISIS_SBP or (last_dbp or 0) >= CRISIS_DBP:
        return dict(TIERS["crisis"])
    if prob >= TIER_HIGH:
        return dict(TIERS["high"])
    if prob >= TIER_MEDIUM:
        return dict(TIERS["medium"])
    return dict(TIERS["low"])


def context_vector(feat_row: dict, prob: float) -> np.ndarray:
    """Bandit context: what is driving this patient right now."""
    g = lambda k, d=0.0: d if feat_row.get(k) is None or np.isnan(feat_row.get(k)) else float(feat_row[k])
    return np.array([
        1.0,
        np.clip(g("stress_24h_vs_7d") / 15, -2, 2),
        np.clip(-g("hrv_24h_vs_7d_pct") / 20, -2, 2),
        np.clip(g("sleep_debt") / 4, 0, 3),
        np.clip(g("consecutive_missed") / 2, 0, 3),
        np.clip(g("salt_logged_48h_g") / 6, 0, 3),
        prob,
    ])


class LinUCB:
    """Disjoint LinUCB (Li et al., 2010). Mirrors MyCompass's bandit so both layers share one maths."""

    def __init__(self, arms: list[str], dim: int, alpha: float = 0.6, lam: float = 1.0):
        self.arms, self.dim, self.alpha = arms, dim, alpha
        self.A = {a: np.eye(dim) * lam for a in arms}
        self.b = {a: np.zeros(dim) for a in arms}
        self.pulls = {a: 0 for a in arms}
        self.reward_sum = {a: 0.0 for a in arms}

    def scores(self, x: np.ndarray) -> dict:
        out = {}
        for a in self.arms:
            Ainv = np.linalg.inv(self.A[a])
            theta = Ainv @ self.b[a]
            out[a] = {"mean": float(theta @ x), "ucb": float(theta @ x + self.alpha * np.sqrt(x @ Ainv @ x))}
        return out

    def select(self, x: np.ndarray) -> str:
        s = self.scores(x)
        return max(s, key=lambda a: s[a]["ucb"])

    def update(self, arm: str, x: np.ndarray, reward: float):
        self.A[arm] += np.outer(x, x)
        self.b[arm] += reward * x
        self.pulls[arm] += 1
        self.reward_sum[arm] += reward

    def to_json(self) -> dict:
        return {"arms": self.arms, "dim": self.dim, "alpha": self.alpha,
                "A": {a: self.A[a].tolist() for a in self.arms}, "b": {a: self.b[a].tolist() for a in self.arms},
                "pulls": self.pulls, "reward_sum": self.reward_sum}

    @classmethod
    def from_json(cls, d: dict) -> "LinUCB":
        m = cls(d["arms"], d["dim"], d["alpha"])
        m.A = {a: np.array(v) for a, v in d["A"].items()}
        m.b = {a: np.array(v) for a, v in d["b"].items()}
        m.pulls, m.reward_sum = d["pulls"], d["reward_sum"]
        return m

    def save(self, path=ARTIFACT_DIR / "sentinel_bandit.json"):
        path.write_text(json.dumps(self.to_json()))

    @classmethod
    def load(cls, path=ARTIFACT_DIR / "sentinel_bandit.json") -> "LinUCB":
        return cls.from_json(json.loads(path.read_text()))


def catalogue_json() -> list[dict]:
    return [{**{k: v for k, v in asdict(i).items() if k != "scenario"}, "scenario": asdict(i.scenario)} for i in CATALOGUE]
