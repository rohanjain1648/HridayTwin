"""
Snapshot of real twin output for the landing page, so it works without the API running.

    python docs/make_landing_data.py

Writes dashboard/src/landing/snapshot.json. Every number comes from the trained model and the
held-out test patients; re-run after retraining.
"""

import itertools

import numpy as np
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from twin_engine.service import TwinService  # noqa: E402
from twin_engine.streaming import ReplaySession, TruthStore  # noqa: E402

PID = "HT-0278"  # adherence-dependent; the clearest what-if story
OUT = ROOT / "dashboard" / "src" / "landing" / "snapshot.json"

svc = TwinService()
m = svc.metrics
tw = svc.twin(PID)
st = svc.streams(PID)
row = next(r for r in svc.roster() if r["id"] == PID)

scenarios = {}
for breath, sleep, adh in itertools.product((0, 20), (0, 1), (False, True)):
    r = svc.simulate(PID, {"breathing_min": breath, "sleep_extra_h": sleep, "adherence": adh,
                           "low_salt": False, "steps_extra": 0})
    key = f"{int(bool(breath))}{sleep}{int(adh)}"
    scenarios[key] = {"risk": r["risk_after"], "peak": r["projection_after"]["peak_sbp"],
                      "curve": [p["sbp"] for p in r["projection_after"]["curve"]]}

# Early-warning replay: a stable patient, the alert, then the surge
preset = svc.replay_presets()[0]
rps = svc.cohort.streams(preset["patient_id"])
on = preset["onset_hour"]
_mean = lambda a, lo, hi: round(float(np.nanmean(a[lo:hi])), 1)
_sleep = rps.sleep[(rps.sleep.avail_hour >= on - 120) & (rps.sleep.avail_hour < on)]
_cuff = rps.cuff[(rps.cuff.hour >= on - 96) & (rps.cuff.hour < on)]
story = {
    "hrv_before": _mean(rps.hrv, on - 96, on - 48), "hrv_after": _mean(rps.hrv, on - 48, on),
    "stress_before": round(_mean(rps.stress, on - 96, on - 48)), "stress_after": round(_mean(rps.stress, on - 48, on)),
    "last_sleep_h": round(float(_sleep.total_sleep_h.iloc[-1]), 1),
    "doses_taken": int(rps.dose[on // 24 - 5: on // 24].sum()), "doses_days": 5,
    "max_cuff": int(_cuff.sbp.max()),
}
sess = ReplaySession(svc, TruthStore(), preset["patient_id"], preset["start_hour"])
replay = []
while not sess.done() and sess.hour <= preset["onset_hour"] + 8:
    t = sess.tick()
    replay.append({"hour": t["hour"], "risk": t["risk"], "sbp": t["truth_sbp"],
                   "alert": any(e["type"] == "alert" for e in t["events"])})

ehr = svc.ehr_record(PID)
lab = {l["code"]: l for l in ehr["labs"]}
gene = {g["GENE"]: g for g in ehr["genomics"]}
records = [[c["DESCRIPTION"], f"SNOMED {c['CODE']}"] for c in ehr["conditions"][:2]]
records.append([f"eGFR {lab['33914-3']['latest']:.0f} mL/min", "LOINC 33914-3"])
records.append([ehr["medications"][0]["DESCRIPTION"], ehr["medications"][0]["CLASS"]])
records.append([f"AGT M235T", gene["AGT"]["GENOTYPE"].replace("/", " / ")])

# Last 72 h of wearable data in 6-hour blocks, and the last week of MyZenn mood check-ins
hourly = [h for h in st["hourly"] if h["hour"] >= tw["now_hour"] - 72]
def blocks(key):
    out = []
    for i in range(0, len(hourly), 6):
        vals = [h[key] for h in hourly[i:i + 6] if h[key] is not None]
        if vals:
            out.append(round(sum(vals) / len(vals), 1))
    return out
moods = [h["mood"] for h in st["hourly"] if h["mood"] is not None]

snapshot = {
    "patient": {k: row[k] for k in ("id", "name", "age", "sex", "city", "phenotype", "tier", "conditions")},
    "records": records,
    "series": {"hr": blocks("hr"), "hrv": blocks("hrv"), "stress": blocks("stress"), "mood": moods[-7:],
               "salt_days": sum(1 for h in st["hourly"] if h["salt"]),
               "session_min": sum(h["session"] or 0 for h in st["hourly"])},
    "now_hour": tw["now_hour"],
    "risk": tw["risk"],
    "cuff": [{"hour": c["hour"], "sbp": c["sbp"]} for c in st["cuff"]],
    "projection": [{"hour": p["hour"], "sbp": p["sbp"], "lo": p["lo"], "hi": p["hi"]} for p in tw["projection"]["curve"]],
    "scenarios": scenarios,
    "groups": tw["explanation"]["groups"],
    "sensitivities": {k: round(v["value"], 2) for k, v in tw["sensitivities"].items()},
    "recommendations": [{k: r[k] for k in ("id", "name", "myzenn_tool", "risk_after", "risk_reduction")}
                        for r in tw["recommendations"]],
    "snapshot": tw["snapshot"],
    "replay": {"name": preset["name"], "driver": preset["driver"], "lead_h": preset["lead_h"], "story": story,
               "onset_hour": preset["onset_hour"], "points": replay},
    "metrics": {
        "auroc": round(m["test"]["auroc"], 3), "auprc": round(m["test"]["auprc"], 3), "brier": round(m["test"]["brier"], 3),
        "event_recall": round(m["lead_time_medium"]["event_recall"], 3),
        "median_lead_h": m["lead_time_medium"]["median_lead_h"],
        "patients": m["cohort"]["patients"], "test_patients": m["cohort"]["test_patients"],
        "days": m["cohort"]["days"], "features": m["cohort"]["features"], "samples": m["cohort"]["samples"],
        "events_total": m["cohort"]["events_total"],
        "ablation": {k: round(v["auroc"], 3) for k, v in m["ablation"].items()},
        "stress_rho": round(m["twin_validation"]["corr_stress_sensitivity"], 2),
        "top2": round(m["twin_validation"]["phenotype_top2_accuracy"], 2),
        "bandit": round(m["sentinel"]["mean_risk_reduction_bandit"] * 100),
        "random": round(m["sentinel"]["mean_risk_reduction_random"] * 100),
        "oracle": round(m["sentinel"]["mean_risk_reduction_oracle"] * 100),
    },
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(snapshot, indent=1))
print(f"wrote {OUT.relative_to(ROOT)} | {PID} risk {tw['risk']} | scenarios {len(scenarios)} | "
      f"replay {preset['name']} {len(replay)} pts, lead {preset['lead_h']} h")
