"""Real-time layer: live sample store, live overlay on the twin, and the streaming replay."""

import numpy as np
import pytest

from twin_engine.features import build_features
from twin_engine.livestore import LiveStore
from twin_engine.service import TwinService
from twin_engine.streaming import ReplaySession, TruthStore


@pytest.fixture(scope="module")
def svc(tmp_path_factory):
    s = TwinService()
    s.livestore = LiveStore(tmp_path_factory.mktemp("live") / "live.db")  # never touch the demo database
    return s


def test_live_samples_persist_and_stop(svc):
    pid = svc.test_ids[0]
    svc.ingest_live(pid, {"hr": 96, "hrv": 15, "source": "bluetooth"})
    svc.ingest_live(pid, {"hr": 98, "hrv": 14, "source": "bluetooth"})
    assert len(svc.livestore.active(pid)) == 2
    assert svc.twin(pid)["live"] is True
    svc.clear_live(pid)
    assert svc.livestore.active(pid) == []
    assert svc.livestore.summary(pid)["samples"] == 2          # history is kept after stopping
    assert svc.twin(pid)["live"] is False


def test_live_overlay_only_changes_recent_hours(svc):
    pid = svc.test_ids[1]
    base = svc.cohort.streams(pid)
    svc.ingest_live(pid, {"hr": 110, "hrv": 10, "source": "camera"})
    live = svc._streams(pid)
    assert np.array_equal(live.hr[: svc.now - 3], base.hr[: svc.now - 3], equal_nan=True)  # NaN = watch off wrist
    assert np.all(live.hr[svc.now - 3: svc.now] == 110)
    svc.clear_live(pid)


def test_replay_matches_batch_scoring(svc):
    """A tick's risk must equal the batch model at the same moment (same features, no leakage)."""
    pid = svc.test_ids[2]
    sess = ReplaySession(svc, TruthStore(), pid, start=svc.now - 30)
    ticks = [sess.tick() for _ in range(12)]
    ps = svc.cohort.streams(pid)
    for tk in ticks:
        X = build_features(ps, svc.cohort.static.loc[pid], np.array([tk["hour"] + 1]))
        assert abs(tk["risk"] - round(float(svc.model.predict(X)[0]), 3)) < 1e-9


def test_replay_alerts_do_not_flap(svc):
    """Hysteresis + cooldown: no tier should be alerted twice within 12 hours."""
    for pid in svc.test_ids[:15]:
        sess = ReplaySession(svc, TruthStore(), pid, start=svc.now - 120)
        seen = {}
        while not sess.done():
            tk = sess.tick()
            for e in tk["events"]:
                if e["type"] == "alert":
                    assert tk["hour"] - seen.get(e["tier"], -99) >= 12
                    seen[e["tier"]] = tk["hour"]
                    assert e["recommendation"] is not None
