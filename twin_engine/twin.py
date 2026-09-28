"""
The mechanistic half of the hybrid digital twin.

1. Personal calibration: a Bayesian linear physiology model is fitted to each patient's own home-cuff
   readings, shrunk towards a population prior learned from the training cohort:

       SBP = θ0 + θ_stress·stress + θ_sleep·sleep_debt + θ_med·drug_level + θ_salt·salt_load + θ_am·morning

   The posterior gives this patient's personal sensitivities ("+14 mmHg per unit of stress") with
   uncertainty, and from them a phenotype (stress-reactive, sleep-sensitive, salt-sensitive,
   adherence-dependent).

2. Scenarios ("what-if"): lifestyle / care changes are applied to the patient's recent raw streams,
   then both the ML risk engine and the physiology model are re-run on the modified twin.

3. Projection: a 24-hour forward BP curve with an uncertainty band.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
import pandas as pd

from .features import PatientStreams
from .simulator import _gamma_kernel

TERMS = ["intercept", "stress", "sleep_debt", "drug_level", "salt_load", "morning"]
DRIVER_OF_TERM = {"stress": "stress", "sleep_debt": "sleep_debt", "drug_level": "missed_meds", "salt_load": "salt"}
PHENOTYPE = {
    "stress": "Stress-reactive",
    "sleep_debt": "Sleep-sensitive",
    "missed_meds": "Adherence-dependent",
    "salt": "Salt-sensitive",
}


# ─── Scenario (what-if) ──────────────────────────────────────────────────

@dataclass
class Scenario:
    sleep_extra_h: float = 0.0     # extra sleep per night
    breathing_min: float = 0.0     # daily MyBreath slow breathing (~6 breaths/min)
    adherence: bool = False        # smart-pillbox reminders → all doses taken
    low_salt: bool = False         # low-salt coaching → no salty meals
    steps_extra: float = 0.0       # extra daily steps (MyYoga / brisk walk)

    def is_baseline(self) -> bool:
        return not any([self.sleep_extra_h, self.breathing_min, self.adherence, self.low_salt, self.steps_extra])


def apply_scenario(ps: PatientStreams, t: int, sc: Scenario, window_h: int = 72,
                   tw: "TwinState | None" = None) -> PatientStreams:
    """Return a modified copy of the twin's recent streams as if the protocol had been followed.

    Effect sizes are conservative and drawn from the direction of published evidence:
    slow breathing raises HRV and lowers sympathetic tone; sleep extension lowers next-day BP;
    sodium reduction (DASH) lowers SBP by ~5 mmHg; adherence restores the drug effect.

    If a calibrated twin `tw` is given, the change in physiology is also propagated into the home-cuff
    readings through the patient's personal model (hybrid step: physics moves BP, ML re-scores risk).
    """
    m = _apply_streams(ps, t, sc, window_h)
    if tw is not None and m is not ps and len(ps.cuff):
        sel = (ps.cuff["hour"] >= t - window_h) & (ps.cuff["hour"] < t)
        if sel.any():
            hrs = np.floor(ps.cuff.loc[sel, "hour"].to_numpy()).astype(int)
            delta = (design(m, hrs) - design(ps, hrs)) @ tw.theta
            m.cuff.loc[sel, "sbp"] = ps.cuff.loc[sel, "sbp"].to_numpy() + delta
            m.cuff.loc[sel, "dbp"] = ps.cuff.loc[sel, "dbp"].to_numpy() + 0.5 * delta
    return m


def _apply_streams(ps: PatientStreams, t: int, sc: Scenario, window_h: int) -> PatientStreams:
    if sc.is_baseline():
        return ps
    m = ps.copy()
    lo = max(0, t - window_h)
    win = slice(lo, t)

    if sc.breathing_min:
        b = sc.breathing_min
        m.stress[win] *= 1 - min(0.35, 0.016 * b)
        m.hrv[win] *= 1 + min(0.30, 0.014 * b)
        m.hr[win] -= min(4.0, 0.15 * b)
        mood = m.mood[win]
        m.mood[win] = np.where(np.isnan(mood), np.nan, np.minimum(10, mood + min(1.5, 0.08 * b)))
        m.session[win] += np.where((np.arange(lo, t) % 24) == 21, b, 0)

    if sc.sleep_extra_h:
        e = sc.sleep_extra_h
        sel = (m.sleep["avail_hour"] >= t - window_h) & (m.sleep["avail_hour"] < t)
        m.sleep.loc[sel, "total_sleep_h"] = np.minimum(9.0, m.sleep.loc[sel, "total_sleep_h"] + e)
        m.sleep.loc[sel, "sleep_efficiency"] = np.minimum(97, m.sleep.loc[sel, "sleep_efficiency"] + 3 * e)
        m.sleep.loc[sel, "awake_min"] = np.maximum(5, m.sleep.loc[sel, "awake_min"] - 10 * e)
        m.sleep.loc[sel, "deep_pct"] = np.minimum(28, m.sleep.loc[sel, "deep_pct"] + 1.5 * e)
        asleep = m.asleep[win] == 1
        m.hrv[win] = np.where(asleep, m.hrv[win] * (1 + 0.05 * e), m.hrv[win])
        m.stress[win] *= 1 - min(0.15, 0.06 * e)

    if sc.adherence:
        days = np.arange(len(m.dose))
        m.dose[(days * 24 + 9 >= t - 168) & (days * 24 + 9 < t)] = 1

    if sc.low_salt:
        m.salt_g[win] = 0

    if sc.steps_extra:
        awake = (m.asleep[win] == 0) & ~np.isnan(m.steps[win])
        per_day_awake = max(1, awake.sum() / max(1, window_h / 24))
        m.steps[win] = np.where(awake, m.steps[win] + sc.steps_extra / per_day_awake, m.steps[win])
        m.stress[win] *= 1 - min(0.10, sc.steps_extra / 30000)

    m.stress[win] = np.clip(m.stress[win], 1, 99)
    return m


# ─── Physiology design matrix ────────────────────────────────────────────

def _sleep_debt_series(ps: PatientStreams) -> np.ndarray:
    tot = ps.sleep["total_sleep_h"].to_numpy()
    debt, r = np.zeros(len(tot)), 0.0
    for i, v in enumerate(tot):
        r = 0.7 * r + max(0.0, 7.5 - v)
        debt[i] = r
    out = np.full(ps.H, np.nan)
    av = ps.sleep["avail_hour"].to_numpy().astype(int)
    ok = av < ps.H
    out[av[ok]] = debt[ok]
    s = pd.Series(out).ffill().fillna(0).to_numpy()
    return s


def _drug_level_series(ps: PatientStreams, init: float = 0.8) -> np.ndarray:
    lvl, r = np.zeros(len(ps.dose)), init
    for i, v in enumerate(ps.dose):
        r = 0.5 * r + 0.5 * v
        lvl[i] = r
    out = np.full(ps.H, np.nan)
    out[np.arange(len(ps.dose)) * 24 + 9] = lvl
    return pd.Series(out).ffill().fillna(init).to_numpy()


def _salt_load_series(ps: PatientStreams) -> np.ndarray:
    load = np.zeros(ps.H)
    hrs = np.arange(ps.H)
    for t0 in np.nonzero(ps.salt_g)[0]:
        load += ps.salt_g[t0] * _gamma_kernel(hrs - t0)
    return load


def _stress_series(ps: PatientStreams) -> np.ndarray:
    return pd.Series(ps.stress).rolling(6, min_periods=1).mean().bfill().to_numpy() / 100


def design(ps: PatientStreams, hours: np.ndarray, cache: dict | None = None) -> np.ndarray:
    c = cache if cache is not None else {}
    if "stress" not in c:
        c.update(stress=_stress_series(ps), sleep=_sleep_debt_series(ps),
                 drug=_drug_level_series(ps), salt=_salt_load_series(ps))
    h = np.clip(np.asarray(hours, dtype=int), 0, ps.H - 1)
    hm1 = np.maximum(h - 1, 0)
    return np.column_stack([
        np.ones(len(h)), c["stress"][hm1], c["sleep"][h], c["drug"][h], c["salt"][h], ((h % 24) < 12).astype(float),
    ])


# ─── Population prior + per-patient Bayesian calibration ─────────────────

@dataclass
class Prior:
    mu: list
    tau: list
    sigma: float

    def to_dict(self):
        return asdict(self)


def fit_prior(streams: list[PatientStreams]) -> Prior:
    Xs, ys, per = [], [], []
    for ps in streams:
        if len(ps.cuff) < 10:
            continue
        hrs = np.floor(ps.cuff["hour"].to_numpy()).astype(int)
        X = design(ps, hrs)
        y = ps.cuff["sbp"].to_numpy(float)
        Xs.append(X)
        ys.append(y)
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        per.append(beta)
    X, y = np.vstack(Xs), np.concatenate(ys)
    mu, *_ = np.linalg.lstsq(X, y, rcond=None)
    per = np.array(per)
    # Between-patient spread (robust), used as prior width
    tau = 1.4826 * np.median(np.abs(per - np.median(per, axis=0)), axis=0)
    tau = np.maximum(tau, np.array([15.0, 8.0, 1.0, 5.0, 0.5, 3.0]))
    resid = []
    for Xp, yp, b in zip(Xs, ys, per):
        resid.append(yp - Xp @ b)
    sigma = float(np.std(np.concatenate(resid)))
    return Prior(mu=mu.tolist(), tau=tau.tolist(), sigma=max(sigma, 4.0))


@dataclass
class TwinState:
    theta: np.ndarray
    cov: np.ndarray
    sigma: float
    n_readings: int

    def sensitivities(self) -> dict:
        sd = np.sqrt(np.diag(self.cov))
        return {name: {"value": float(self.theta[i]), "sd": float(sd[i])} for i, name in enumerate(TERMS)}


def calibrate(ps: PatientStreams, prior: Prior, until_hour: int | None = None) -> TwinState:
    cu = ps.cuff if until_hour is None else ps.cuff[ps.cuff["hour"] < until_hour]
    hrs = np.floor(cu["hour"].to_numpy()).astype(int)
    X = design(ps, hrs)
    y = cu["sbp"].to_numpy(float)
    s2 = prior.sigma ** 2
    L0 = np.diag(1 / np.square(prior.tau))
    mu0 = np.array(prior.mu)
    A = X.T @ X / s2 + L0
    cov = np.linalg.inv(A)
    theta = cov @ (X.T @ y / s2 + L0 @ mu0)
    # Physiological sign constraints: stress, sleep debt and salt raise BP; antihypertensives lower it.
    theta[1:3] = np.maximum(theta[1:3], 0)
    theta[3] = min(theta[3], 0)
    theta[4] = max(theta[4], 0)
    return TwinState(theta=theta, cov=cov, sigma=prior.sigma, n_readings=len(y))


def driver_contributions(ps: PatientStreams, tw: TwinState, t: int, window_h: int = 336) -> dict:
    """How far each driver pushes this patient's BP up on a bad day (mmHg).

    Uses daily means of θ_j·x_j over the last 2 weeks (removes diurnal noise) and measures the
    90th-percentile excursion above the patient's own median."""
    hrs = np.arange(max(0, t - window_h), t)
    X = design(ps, hrs)
    day = (hrs - hrs[0]) // 24
    out = {}
    for j, term in enumerate(TERMS):
        if term in DRIVER_OF_TERM:
            daily = pd.Series(tw.theta[j] * X[:, j]).groupby(day).mean().to_numpy()
            out[DRIVER_OF_TERM[term]] = float(max(0.0, np.percentile(daily, 90) - np.median(daily)))
    return out


def phenotype(contrib: dict) -> dict:
    top = max(contrib, key=contrib.get)
    total = sum(contrib.values()) or 1
    return {"primary": PHENOTYPE[top], "driver": top,
            "shares": {PHENOTYPE[k]: round(v / total, 3) for k, v in sorted(contrib.items(), key=lambda kv: -kv[1])}}


def project(ps: PatientStreams, tw: TwinState, t: int, sc: Scenario | None = None, hours: int = 24) -> dict:
    """Forward BP curve for [t, t+hours) under the scenario (baseline = recent behaviour persists)."""
    sc = sc or Scenario()
    cache: dict = {}
    X_now = design(ps, np.array([t]), cache)[0]
    # Diurnal stress profile from the last 3 days (per hour of day)
    st = cache["stress"]
    lo = max(0, t - 72)
    prof = pd.Series(st[lo:t]).groupby(np.arange(lo, t) % 24).mean().reindex(range(24)).ffill().bfill().to_numpy()
    recent_adh = ps.dose[max(0, t // 24 - 7): t // 24].mean() if t // 24 > 0 else 0.8
    if sc.adherence:
        recent_adh = 1.0
    drug = X_now[3]
    salt = cache["salt"]
    # typical sleep window
    recent = ps.sleep[ps.sleep["avail_hour"] < t].tail(3)
    wake_h = int(np.round((recent["avail_hour"] - 1).mod(24).mean())) if len(recent) else 7
    sleep_len = float(recent["total_sleep_h"].mean()) if len(recent) else 7.0
    bed_h = int(np.round(wake_h - sleep_len - 0.5)) % 24

    rows = []
    for k in range(hours):
        h = t + k
        hod = h % 24
        if hod == 9:
            drug = 0.5 * drug + 0.5 * recent_adh
        salt_h = 0.0 if sc.low_salt else (salt[h] if h < ps.H else 0.0)
        x = np.array([1.0, prof[hod], X_now[2], drug, salt_h, float(hod < 12)])
        mean = float(x @ tw.theta)
        asleep = (hod >= bed_h or hod < wake_h) if bed_h > wake_h else (bed_h <= hod < wake_h)
        if asleep:
            mean *= 0.93  # population nocturnal dip; cuff readings cannot personalise night-time BP
        var = float(x @ tw.cov @ x) + tw.sigma ** 2
        rows.append({"hour": h, "sbp": round(mean, 1), "lo": round(mean - 1.28 * np.sqrt(var), 1),
                     "hi": round(mean + 1.28 * np.sqrt(var), 1), "asleep": bool(asleep)})
    return {"curve": rows, "peak_sbp": max(r["sbp"] for r in rows)}
