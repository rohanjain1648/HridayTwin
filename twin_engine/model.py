"""Risk engine: gradient-boosted trees with clinical monotonicity constraints + isotonic calibration."""

from __future__ import annotations

import json

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from .config import ARTIFACT_DIR
from .features import driver_group, pretty

# Direction a feature is *clinically allowed* to move risk (+1 up, −1 down). Keeps the model
# physiologically sensible and makes what-if simulations trustworthy.
MONOTONE = {
    "cuff_sbp_last": 1, "cuff_dbp_last": 1, "cuff_sbp_mean_3d": 1, "cuff_sbp_mean_7d": 1, "cuff_sbp_max_3d": 1,
    "stress_mean_24h": 1, "stress_max_24h": 1, "stress_mean_72h": 1, "stress_24h_vs_7d": 1,
    "hrv_mean_24h": -1, "hrv_night": -1, "hrv_mean_72h": -1, "hrv_24h_vs_7d_pct": -1,
    "sleep_last_h": -1, "sleep_avg_3n": -1, "sleep_debt": 1, "sleep_eff_last": -1,
    "doses_last_24h": -1, "doses_last_3d": -1, "doses_last_7d": -1, "med_level_est": -1, "consecutive_missed": 1,
    "salt_logged_24h_g": 1, "salt_logged_48h_g": 1, "mood_last": -1, "mood_mean_3d": -1, "myzenn_min_72h": -1,
    "hr_mean_24h": 1, "hr_rest_night": 1, "hr_24h_vs_7d": 1, "hrv_slope_48h": -1, "mood_delta_7d": -1,
    "sleep_deep_pct_last": -1, "sleep_awake_min_last": 1, "cuff_sbp_trend": 1, "cuff_am_pm_gap_7d": 1,
}

PARAMS = dict(objective="binary", learning_rate=0.04, num_leaves=31, min_child_samples=60,
              feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=2.0,
              verbose=-1, seed=7)


def train_booster(X: pd.DataFrame, y: np.ndarray, Xv: pd.DataFrame, yv: np.ndarray,
                  monotone: bool = True, rounds: int = 1200) -> lgb.Booster:
    params = dict(PARAMS)
    if monotone:
        params["monotone_constraints"] = [MONOTONE.get(c, 0) for c in X.columns]
        params["monotone_constraints_method"] = "advanced"
    dtr = lgb.Dataset(X, y)
    dva = lgb.Dataset(Xv, yv, reference=dtr)
    return lgb.train(params, dtr, num_boost_round=rounds, valid_sets=[dva],
                     callbacks=[lgb.early_stopping(80, verbose=False)])


class PlattCalibrator:
    """Logistic recalibration on the log-odds. Smooth and strictly monotone, so small what-if changes
    produce proportionate risk changes (isotonic steps would flatten them)."""

    def fit(self, raw: np.ndarray, y: np.ndarray) -> "PlattCalibrator":
        from sklearn.linear_model import LogisticRegression
        z = _logit(raw).reshape(-1, 1)
        lr = LogisticRegression(C=100.0).fit(z, y)
        self.a, self.b = float(lr.coef_[0, 0]), float(lr.intercept_[0])
        return self

    def predict(self, raw: np.ndarray) -> np.ndarray:
        return 1 / (1 + np.exp(-(self.a * _logit(raw) + self.b)))


def _logit(p):
    p = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


class RiskModel:
    def __init__(self, booster: lgb.Booster, calibrator: "PlattCalibrator | IsotonicRegression", features: list[str]):
        self.booster = booster
        self.calibrator = calibrator
        self.features = features

    def raw(self, X: pd.DataFrame) -> np.ndarray:
        return self.booster.predict(X[self.features], num_iteration=self.booster.best_iteration)

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self.calibrator.predict(self.raw(X))

    def explain(self, X: pd.DataFrame, top: int = 8) -> dict:
        """Per-feature contributions (log-odds, TreeSHAP) for a single row, grouped into clinical drivers."""
        contrib = self.booster.predict(X[self.features].iloc[[0]], pred_contrib=True,
                                       num_iteration=self.booster.best_iteration)[0]
        base, vals = float(contrib[-1]), contrib[:-1]
        row = X[self.features].iloc[0]
        feats = sorted(
            [{"feature": f, "label": pretty(f), "group": driver_group(f), "value": _num(row[f]), "impact": float(v)}
             for f, v in zip(self.features, vals)],
            key=lambda d: -abs(d["impact"]))
        groups: dict[str, float] = {}
        for d in feats:
            groups[d["group"]] = groups.get(d["group"], 0.0) + d["impact"]
        return {"base_logit": base,
                "groups": [{"group": g, "impact": round(v, 3)} for g, v in sorted(groups.items(), key=lambda kv: -kv[1])],
                "top_features": feats[:top]}

    def save(self, path=ARTIFACT_DIR):
        path.mkdir(parents=True, exist_ok=True)
        self.booster.save_model(str(path / "risk_model.txt"), num_iteration=self.booster.best_iteration)
        joblib.dump(self.calibrator, path / "calibrator.joblib")
        (path / "features.json").write_text(json.dumps(self.features))

    @classmethod
    def load(cls, path=ARTIFACT_DIR) -> "RiskModel":
        b = lgb.Booster(model_file=str(path / "risk_model.txt"))
        return cls(b, joblib.load(path / "calibrator.joblib"), json.loads((path / "features.json").read_text()))


def _num(v):
    try:
        f = float(v)
        return None if np.isnan(f) else round(f, 2)
    except (TypeError, ValueError):
        return None
