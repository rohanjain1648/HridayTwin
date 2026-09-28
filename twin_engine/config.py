"""Shared paths and clinical constants."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
EHR_DIR = DATA_DIR / "ehr"
STREAM_DIR = DATA_DIR / "streams"
TRUTH_DIR = DATA_DIR / "ground_truth"
ARTIFACT_DIR = ROOT / "artifacts"

# Adverse event definition: stage-2 range BP sustained for >= SURGE_MIN_HOURS consecutive hours.
SURGE_SBP = 160
SURGE_DBP = 100
SURGE_MIN_HOURS = 2

# Hypertensive crisis range: triggers MySafe escalation immediately.
CRISIS_SBP = 180
CRISIS_DBP = 110

# Prediction protocol
LOOKBACK_DAYS = 7
HORIZON_HOURS = 24
PREDICTION_HOURS = (0, 6, 12, 18)  # model is queried every 6 h

# Alert tiers (probability of surge in next 24 h)
TIER_HIGH = 0.55
TIER_MEDIUM = 0.30

SEED = 42
