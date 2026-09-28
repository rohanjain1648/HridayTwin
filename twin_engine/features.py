"""
Fusion feature store: static EHR + dynamic wearable/IoT streams → one feature vector per
(patient, prediction time). The same code path serves training, evaluation, the live API and
the what-if simulator, so there is no train/serve skew.

A prediction made at hour t only uses data strictly before t.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import EHR_DIR, STREAM_DIR, TRUTH_DIR, LOOKBACK_DAYS, HORIZON_HOURS, PREDICTION_HOURS
from .simulator import START

# ─── Static (EHR) ────────────────────────────────────────────────────────

DX_CODES = {"t2dm": "44054006", "ckd": "709044004", "osa": "78275009", "anxiety": "197480006",
            "depression": "35489007", "prior_mi": "22298006", "stroke": "230690007", "dyslipidemia": "55822004"}
LAB_CODES = {"egfr": "33914-3", "hba1c": "4548-4", "ldl": "18262-6", "uacr": "9318-7",
             "potassium": "2823-3", "sodium_lab": "2951-2", "creatinine": "2160-0"}


def load_static() -> pd.DataFrame:
    pts = pd.read_csv(EHR_DIR / "patients.csv")
    cond = pd.read_csv(EHR_DIR / "conditions.csv", dtype={"CODE": str})
    obs = pd.read_csv(EHR_DIR / "observations.csv", dtype={"CODE": str})
    meds = pd.read_csv(EHR_DIR / "medications.csv")
    gen = pd.read_csv(EHR_DIR / "genomics.csv")

    s = pts.set_index("Id")
    out = pd.DataFrame(index=s.index)
    out["age"] = s["AGE"]
    out["sex_male"] = (s["GENDER"] == "M").astype(int)
    out["bmi"] = s["BMI"]
    out["tobacco"] = s["TOBACCO"]
    out["alcohol"] = s["ALCOHOL"]
    out["salt_g_day"] = s["SALT_G_DAY"]
    out["office_sbp"] = s["OFFICE_SBP"]
    out["myzenn_user"] = s["MYZENN_USER"]
    for k, code in DX_CODES.items():
        ids = set(cond.loc[cond["CODE"] == code, "PATIENT"])
        out[f"dx_{k}"] = out.index.isin(ids).astype(int)
    latest = obs.sort_values("DATE").groupby(["PATIENT", "CODE"])["VALUE"].last().unstack()
    for k, code in LAB_CODES.items():
        out[f"lab_{k}"] = latest[code].reindex(out.index)
    out["lab_uacr"] = np.log1p(out["lab_uacr"])
    bp = meds[meds["INDICATION"] == "Essential hypertension"]
    out["n_bp_meds"] = bp.groupby("PATIENT").size().reindex(out.index).fillna(0).astype(int)
    g = gen.pivot_table(index="PATIENT", columns="GENE", values="RISK_ALLELES", aggfunc="first")
    for gene in ("AGT", "ACE", "CYP11B2", "GNB3", "PRS"):
        out[f"gen_{gene.lower()}"] = g[gene].reindex(out.index).astype(float)
    return out


# ─── Dynamic streams per patient ─────────────────────────────────────────

@dataclass
class PatientStreams:
    pid: str
    H: int
    hr: np.ndarray
    hrv: np.ndarray
    steps: np.ndarray
    stress: np.ndarray
    asleep: np.ndarray
    session: np.ndarray
    sleep: pd.DataFrame          # one row per night; `avail_hour` = hour index when it becomes known
    cuff: pd.DataFrame           # hour (float), sbp, dbp
    dose: np.ndarray             # per day 0/1
    salt_g: np.ndarray           # hourly logged extra salt (g)
    mood: np.ndarray             # hourly, NaN except check-ins
    events: pd.DataFrame = field(default_factory=pd.DataFrame)  # ground truth (labels only)

    def copy(self) -> "PatientStreams":
        return copy.deepcopy(self)


def _hour_index(ts: pd.Series) -> np.ndarray:
    return ((pd.to_datetime(ts) - START) / pd.Timedelta(hours=1)).to_numpy()


class Cohort:
    """Loads every stream once and slices it per patient."""

    def __init__(self, with_truth: bool = True):
        self.static = load_static()
        hourly = pd.read_parquet(STREAM_DIR / "hourly.parquet")
        self.H = int(hourly.groupby("patient_id").size().iloc[0])
        self.days = self.H // 24
        self._hourly = {k: g for k, g in hourly.groupby("patient_id", sort=False)}
        self._sleep = {k: g for k, g in pd.read_parquet(STREAM_DIR / "sleep.parquet").groupby("patient_id")}
        self._cuff = {k: g for k, g in pd.read_parquet(STREAM_DIR / "cuff.parquet").groupby("patient_id")}
        self._pill = {k: g for k, g in pd.read_parquet(STREAM_DIR / "pillbox.parquet").groupby("patient_id")}
        self._diet = {k: g for k, g in pd.read_parquet(STREAM_DIR / "diet.parquet").groupby("patient_id")}
        self._mood = {k: g for k, g in pd.read_parquet(STREAM_DIR / "mood.parquet").groupby("patient_id")}
        self._events = {}
        if with_truth and (TRUTH_DIR / "events.csv").exists():
            ev = pd.read_csv(TRUTH_DIR / "events.csv", parse_dates=["onset"])
            self._events = {k: g for k, g in ev.groupby("patient_id")}
        self.patient_ids = list(self.static.index)
        self._cache: dict[str, PatientStreams] = {}

    def streams(self, pid: str) -> PatientStreams:
        if pid in self._cache:
            return self._cache[pid]
        h = self._hourly[pid]
        H = len(h)
        sl = self._sleep.get(pid, pd.DataFrame()).copy()
        sl["avail_hour"] = np.floor(_hour_index(sl["waketime"])) + 1
        cu = self._cuff.get(pid, pd.DataFrame(columns=["ts", "sbp", "dbp"])).copy()
        cu["hour"] = _hour_index(cu["ts"])
        salt = np.zeros(H)
        d = self._diet.get(pid)
        if d is not None and len(d):
            idx = np.floor(_hour_index(d["ts"])).astype(int)
            np.add.at(salt, idx, d["est_extra_salt_g"].to_numpy())
        mood = np.full(H, np.nan)
        m = self._mood.get(pid)
        if m is not None and len(m):
            mood[np.floor(_hour_index(m["ts"])).astype(int)] = m["mood_score"].to_numpy()
        ps = PatientStreams(
            pid=pid, H=H,
            hr=h["heart_rate"].to_numpy(float), hrv=h["hrv_rmssd"].to_numpy(float),
            steps=h["steps"].to_numpy(float), stress=h["stress_score"].to_numpy(float),
            asleep=h["asleep"].to_numpy(int), session=h["myzenn_session_min"].to_numpy(float),
            sleep=sl.reset_index(drop=True), cuff=cu[["hour", "sbp", "dbp"]].astype(float).reset_index(drop=True),
            dose=self._pill[pid]["dose_taken"].to_numpy(float), salt_g=salt, mood=mood,
            events=self._events.get(pid, pd.DataFrame()),
        )
        self._cache[pid] = ps
        return ps

    def prediction_hours(self) -> np.ndarray:
        start = LOOKBACK_DAYS * 24
        return np.array([h for h in range(start, self.H - HORIZON_HOURS + 1) if h % 24 in PREDICTION_HOURS])


# ─── Feature computation ─────────────────────────────────────────────────

def _roll(x: np.ndarray, w: int, how: str = "mean", minp: int | None = None) -> np.ndarray:
    s = pd.Series(x)
    r = s.rolling(w, min_periods=minp if minp is not None else max(1, w // 8))
    return getattr(r, how)().to_numpy()


def _at(series: np.ndarray, hours: np.ndarray) -> np.ndarray:
    """Value of a causal rolling series for predictions at `hours` (uses data up to hours-1)."""
    return series[hours - 1]


def _step_series(H: int, avail: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Hourly forward-filled series: value becomes visible at its availability hour."""
    out = np.full(H, np.nan)
    ok = (avail >= 0) & (avail < H)
    out[avail[ok].astype(int)] = values[ok]
    return pd.Series(out).ffill().to_numpy()


def dynamic_features(ps: PatientStreams, hours: np.ndarray) -> pd.DataFrame:
    H = ps.H
    f: dict[str, np.ndarray] = {}

    # Home cuff BP (sparse, irregular)
    cuff_s = np.full(H, np.nan)
    cuff_d = np.full(H, np.nan)
    cuff_am = np.full(H, np.nan)
    cuff_pm = np.full(H, np.nan)
    hidx = np.floor(ps.cuff["hour"].to_numpy()).astype(int)
    # a reading taken during hour h is usable from hour h+1
    vis = np.clip(hidx + 1, 0, H - 1)
    cuff_s[vis] = ps.cuff["sbp"].to_numpy()
    cuff_d[vis] = ps.cuff["dbp"].to_numpy()
    am = (hidx % 24) < 12
    cuff_am[vis[am]] = ps.cuff["sbp"].to_numpy()[am]
    cuff_pm[vis[~am]] = ps.cuff["sbp"].to_numpy()[~am]
    last_idx = pd.Series(np.where(~np.isnan(cuff_s), np.arange(H), np.nan)).ffill().to_numpy()
    f["cuff_sbp_last"] = _at(pd.Series(cuff_s).ffill().to_numpy(), hours)
    f["cuff_dbp_last"] = _at(pd.Series(cuff_d).ffill().to_numpy(), hours)
    f["cuff_hours_since"] = np.minimum(hours - _at(last_idx, hours), 240)
    f["cuff_sbp_mean_3d"] = _at(_roll(cuff_s, 72, minp=1), hours)
    f["cuff_sbp_mean_7d"] = _at(_roll(cuff_s, 168, minp=1), hours)
    f["cuff_sbp_max_3d"] = _at(_roll(cuff_s, 72, "max", minp=1), hours)
    prev = _roll(cuff_s, 96, minp=1)
    f["cuff_sbp_trend"] = f["cuff_sbp_mean_3d"] - np.concatenate([np.full(72, np.nan), prev[:-72]])[hours - 1]
    f["cuff_am_pm_gap_7d"] = _at(_roll(cuff_am, 168, minp=1), hours) - _at(_roll(cuff_pm, 168, minp=1), hours)
    f["cuff_n_7d"] = _at(_roll(~np.isnan(cuff_s) * 1.0, 168, "sum", minp=1), hours)

    # Heart rate & HRV (wearable)
    hr_sleep = np.where(ps.asleep == 1, ps.hr, np.nan)
    hrv_sleep = np.where(ps.asleep == 1, ps.hrv, np.nan)
    hr24, hr7 = _roll(ps.hr, 24), _roll(ps.hr, 168)
    hrv24, hrv72, hrv7 = _roll(ps.hrv, 24), _roll(ps.hrv, 72), _roll(ps.hrv, 168)
    f["hr_mean_24h"] = _at(hr24, hours)
    f["hr_rest_night"] = _at(_roll(hr_sleep, 24, minp=1), hours)
    f["hr_24h_vs_7d"] = _at(hr24 - hr7, hours)
    f["hrv_mean_24h"] = _at(hrv24, hours)
    f["hrv_night"] = _at(_roll(hrv_sleep, 24, minp=1), hours)
    f["hrv_mean_72h"] = _at(hrv72, hours)
    f["hrv_24h_vs_7d_pct"] = _at(100 * (hrv24 - hrv7) / hrv7, hours)
    f["hrv_slope_48h"] = (_at(hrv24, hours) - hrv24[np.maximum(hours - 49, 0)]) / 2

    # Stress score (wearable, HRV-derived)
    st24 = _roll(ps.stress, 24)
    f["stress_mean_24h"] = _at(st24, hours)
    f["stress_max_24h"] = _at(_roll(ps.stress, 24, "max"), hours)
    f["stress_mean_72h"] = _at(_roll(ps.stress, 72), hours)
    f["stress_24h_vs_7d"] = _at(st24 - _roll(ps.stress, 168), hours)

    # Activity
    st_sum24 = _roll(np.nan_to_num(ps.steps), 24, "sum")
    st_sum7 = _roll(np.nan_to_num(ps.steps), 168, "sum") / 7
    f["steps_24h"] = _at(st_sum24, hours)
    f["steps_24h_vs_7d_pct"] = _at(100 * (st_sum24 - st_sum7) / np.maximum(st_sum7, 1), hours)

    # Sleep (nightly summaries)
    sl = ps.sleep
    avail = sl["avail_hour"].to_numpy()
    tot = sl["total_sleep_h"].to_numpy()
    debt = np.zeros(len(tot))
    r = 0.0
    for i, v in enumerate(tot):
        r = 0.7 * r + max(0.0, 7.5 - v)
        debt[i] = r
    f["sleep_last_h"] = _at(_step_series(H, avail, tot), hours)
    f["sleep_eff_last"] = _at(_step_series(H, avail, sl["sleep_efficiency"].to_numpy()), hours)
    f["sleep_deep_pct_last"] = _at(_step_series(H, avail, sl["deep_pct"].to_numpy()), hours)
    f["sleep_awake_min_last"] = _at(_step_series(H, avail, sl["awake_min"].to_numpy()), hours)
    f["sleep_avg_3n"] = _at(_step_series(H, avail, pd.Series(tot).rolling(3, min_periods=1).mean().to_numpy()), hours)
    f["sleep_debt"] = _at(_step_series(H, avail, debt), hours)

    # Medication adherence (smart pillbox: dose logged ~08:00, visible from 09:00)
    dose_h = np.zeros(H)
    dose_h[np.arange(len(ps.dose)) * 24 + 9] = ps.dose
    f["doses_last_24h"] = _at(_roll(dose_h, 24, "sum", minp=1), hours)
    f["doses_last_3d"] = _at(_roll(dose_h, 72, "sum", minp=1), hours)
    f["doses_last_7d"] = _at(_roll(dose_h, 168, "sum", minp=1), hours)
    miss = np.zeros(len(ps.dose))
    c = 0
    for i, v in enumerate(ps.dose):
        c = 0 if v else c + 1
        miss[i] = c
    f["consecutive_missed"] = _at(_step_series(H, np.arange(len(ps.dose)) * 24 + 9, miss), hours)
    lvl = np.zeros(len(ps.dose))
    r = 0.8
    for i, v in enumerate(ps.dose):
        r = 0.5 * r + 0.5 * v
        lvl[i] = r
    f["med_level_est"] = _at(_step_series(H, np.arange(len(ps.dose)) * 24 + 9, lvl), hours)

    # Diet log (MyZenn food log)
    f["salt_logged_24h_g"] = _at(_roll(ps.salt_g, 24, "sum", minp=1), hours)
    f["salt_logged_48h_g"] = _at(_roll(ps.salt_g, 48, "sum", minp=1), hours)

    # MyZenn mind layer: mood check-ins + breathing/meditation sessions
    mood_ff = pd.Series(ps.mood).ffill().to_numpy()
    f["mood_last"] = _at(mood_ff, hours)
    f["mood_mean_3d"] = _at(_roll(ps.mood, 72, minp=1), hours)
    f["mood_delta_7d"] = f["mood_last"] - _at(_roll(ps.mood, 168, minp=1), hours)
    f["myzenn_min_72h"] = _at(_roll(ps.session, 72, "sum", minp=1), hours)

    f["hour_of_day"] = hours % 24
    f["day_of_week"] = (START.dayofweek + hours // 24) % 7
    return pd.DataFrame(f)


def build_features(ps: PatientStreams, static_row: pd.Series, hours: np.ndarray) -> pd.DataFrame:
    dyn = dynamic_features(ps, np.asarray(hours, dtype=int))
    stat = pd.DataFrame([static_row.to_numpy()] * len(dyn), columns=[f"ehr_{c}" for c in static_row.index])
    return pd.concat([stat, dyn], axis=1)


def labels(ps: PatientStreams, hours: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """y = 1 if a surge begins within [t, t + HORIZON). Also returns hours-until-onset (NaN if none)."""
    onsets = np.sort(ps.events["onset_hour"].to_numpy()) if len(ps.events) else np.array([])
    y = np.zeros(len(hours), dtype=int)
    lead = np.full(len(hours), np.nan)
    for i, t in enumerate(hours):
        nxt = onsets[onsets >= t]
        if len(nxt) and nxt[0] < t + HORIZON_HOURS:
            y[i] = 1
            lead[i] = nxt[0] - t
    return y, lead


# ─── Human-readable names & driver groups (used in explanations) ─────────

DRIVER_GROUPS = {
    "BP history": ("cuff_",),
    "Stress & HRV": ("hrv_", "stress_", "hr_"),
    "Sleep": ("sleep_",),
    "Medication adherence": ("doses_", "consecutive_missed", "med_level"),
    "Salt intake": ("salt_logged",),
    "Activity": ("steps_",),
    "Mood (MyZenn)": ("mood_", "myzenn_"),
    "EHR & genetics": ("ehr_",),
    "Time of day": ("hour_of_day", "day_of_week"),
}

PRETTY = {
    "cuff_sbp_last": "Last home SBP", "cuff_dbp_last": "Last home DBP", "cuff_sbp_mean_3d": "Home SBP, 3-day mean",
    "cuff_sbp_mean_7d": "Home SBP, 7-day mean", "cuff_sbp_max_3d": "Home SBP, 3-day max",
    "cuff_sbp_trend": "Home SBP trend", "cuff_am_pm_gap_7d": "Morning–evening SBP gap",
    "cuff_hours_since": "Hours since last cuff reading", "cuff_n_7d": "Cuff readings in 7 days",
    "hr_mean_24h": "Heart rate, 24 h", "hr_rest_night": "Resting HR (sleep)", "hr_24h_vs_7d": "HR vs 7-day baseline",
    "hrv_mean_24h": "HRV (RMSSD), 24 h", "hrv_night": "Night HRV", "hrv_mean_72h": "HRV, 72 h",
    "hrv_24h_vs_7d_pct": "HRV vs 7-day baseline (%)", "hrv_slope_48h": "HRV slope, 48 h",
    "stress_mean_24h": "Stress score, 24 h", "stress_max_24h": "Peak stress, 24 h", "stress_mean_72h": "Stress score, 72 h",
    "stress_24h_vs_7d": "Stress vs 7-day baseline", "steps_24h": "Steps, 24 h", "steps_24h_vs_7d_pct": "Steps vs baseline (%)",
    "sleep_last_h": "Last night's sleep (h)", "sleep_eff_last": "Sleep efficiency", "sleep_deep_pct_last": "Deep sleep %",
    "sleep_awake_min_last": "Awake time in bed (min)", "sleep_avg_3n": "Sleep, 3-night avg", "sleep_debt": "Sleep debt (h)",
    "doses_last_24h": "Doses taken, 24 h", "doses_last_3d": "Doses taken, 3 days", "doses_last_7d": "Doses taken, 7 days",
    "consecutive_missed": "Consecutive missed doses", "med_level_est": "Estimated drug level",
    "salt_logged_24h_g": "Logged extra salt, 24 h (g)", "salt_logged_48h_g": "Logged extra salt, 48 h (g)",
    "mood_last": "Last mood check-in", "mood_mean_3d": "Mood, 3-day mean", "mood_delta_7d": "Mood vs 7-day baseline",
    "myzenn_min_72h": "MyZenn practice, 72 h (min)", "hour_of_day": "Hour of day", "day_of_week": "Day of week",
}


def driver_group(feature: str) -> str:
    for g, prefixes in DRIVER_GROUPS.items():
        if any(feature.startswith(p) for p in prefixes):
            return g
    return "Other"


def pretty(feature: str) -> str:
    if feature.startswith("ehr_"):
        return "EHR: " + feature[4:].replace("_", " ")
    return PRETTY.get(feature, feature)
