"""Core guarantees of HridayTwin.   python -m pytest -q"""

import json

import numpy as np
import pandas as pd
import pytest

from twin_engine.config import ARTIFACT_DIR
from twin_engine.features import Cohort, build_features, dynamic_features
from twin_engine.model import RiskModel
from twin_engine.twin import Prior, Scenario, apply_scenario, calibrate


@pytest.fixture(scope="module")
def cohort():
    return Cohort()


@pytest.fixture(scope="module")
def model():
    return RiskModel.load()


def _corrupt_future(ps, t):
    """Replace everything at or after hour t with garbage."""
    m = ps.copy()
    for arr in (m.hr, m.hrv, m.steps, m.stress, m.session, m.salt_g, m.mood):
        arr[t:] = 999.0
    m.cuff.loc[m.cuff["hour"] >= t - 1e-9, ["sbp", "dbp"]] = 999.0
    m.sleep.loc[m.sleep["avail_hour"] >= t, ["total_sleep_h", "awake_min", "deep_pct"]] = 999.0
    m.dose[(np.arange(len(m.dose)) * 24 + 9) >= t] = 0
    return m


def test_no_future_leakage(cohort):
    """Features at time t must be identical whatever happens after t."""
    pid = cohort.patient_ids[0]
    ps = cohort.streams(pid)
    for t in (24 * 10, 24 * 30 + 6, 24 * 50 + 18):
        a = dynamic_features(ps, np.array([t]))
        b = dynamic_features(_corrupt_future(ps, t), np.array([t]))
        pd.testing.assert_frame_equal(a, b)


def test_patient_split_is_disjoint():
    split = json.loads((ARTIFACT_DIR / "split.json").read_text())
    tr, va, te = map(set, (split["train"], split["valid"], split["test"]))
    assert not (tr & va) and not (tr & te) and not (va & te)


def test_calibrated_probabilities(cohort, model):
    pid = cohort.patient_ids[1]
    X = build_features(cohort.streams(pid), cohort.static.loc[pid], cohort.prediction_hours()[:50])
    p = model.predict(X)
    assert np.all((p >= 0) & (p <= 1))


def test_adherence_never_increases_risk(cohort, model):
    """Clinical monotonicity: taking every dose cannot make the predicted risk worse."""
    prior = Prior(**json.loads((ARTIFACT_DIR / "twin_prior.json").read_text()))
    split = json.loads((ARTIFACT_DIR / "split.json").read_text())
    t = cohort.H - 6
    for pid in split["test"][:25]:
        ps = cohort.streams(pid)
        tw = calibrate(ps, prior, until_hour=t)
        base = model.predict(build_features(ps, cohort.static.loc[pid], np.array([t])))[0]
        m = apply_scenario(ps, t, Scenario(adherence=True), tw=tw)
        after = model.predict(build_features(m, cohort.static.loc[pid], np.array([t])))[0]
        assert after <= base + 1e-9


def test_scenario_does_not_mutate_original(cohort):
    ps = cohort.streams(cohort.patient_ids[2])
    before = ps.stress.copy()
    apply_scenario(ps, cohort.H - 6, Scenario(breathing_min=20, sleep_extra_h=1))
    np.testing.assert_array_equal(before, ps.stress)
