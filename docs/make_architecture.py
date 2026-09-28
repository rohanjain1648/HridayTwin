"""Renders docs/HridayTwin_Architecture.pdf and .png.   python docs/make_architecture.py"""

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

OUT = Path(__file__).parent
INK, TEAL, TEAL_W, PAPER, SLATE, RED, AMBER = "#15304b", "#009e9a", "#dff2f0", "#f2f7f5", "#6b7c8f", "#c8412f", "#d9912b"

fig, ax = plt.subplots(figsize=(16.5, 10.5))
ax.set_xlim(0, 165)
ax.set_ylim(0, 105)
ax.axis("off")
fig.patch.set_facecolor(PAPER)


def box(x, y, w, h, title, lines=(), fc="white", ec=INK, tc=INK, lw=1.4, fs=11.5):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1.6", fc=fc, ec=ec, lw=lw))
    ax.text(x + 1.6, y + h - 2.4, title, fontsize=fs, fontweight="bold", color=tc, va="top")
    for i, ln in enumerate(lines):
        ax.text(x + 1.6, y + h - 6.2 - i * 3.1, ln, fontsize=8.9, color=tc if tc != INK else "#3a5068", va="top")


def group(x, y, w, h, label, color):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.6,rounding_size=2.5", fc="none", ec=color, lw=1.2, ls=(0, (5, 3))))
    ax.text(x + 1.5, y + h + 1.2, label, fontsize=11, color=color, fontweight="bold")


def arrow(x1, y1, x2, y2, color=INK, text=None, off=(0, 1.4)):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=14, color=color, lw=1.5))
    if text:
        ax.text((x1 + x2) / 2 + off[0], (y1 + y2) / 2 + off[1], text, fontsize=8.8, color=color, ha="center")


ax.text(2, 101.5, "HridayTwin: stress-aware hypertension digital twin", fontsize=20, fontweight="bold", color=INK)
ax.text(2, 97.6, "Happiest Health Digital Twin Challenge 2026, hypertension track. Built on MyZenn (myzenn.com).", fontsize=11.5, color=SLATE)

# ── Data layer ──
group(2, 8, 38, 83, "1  Data streams (synthetic + live)", INK)
box(4, 66, 34, 22, "Static / historical EHR", ["Synthea-style CSVs", "Demographics, lifestyle, salt intake", "Diagnoses (SNOMED-CT)", "Labs (LOINC): eGFR, HbA1c, UACR", "Medications; genes AGT, ACE, PRS"])
box(4, 38, 34, 25, "Dynamic wearable + IoT", ["Smartwatch, hourly: HR, HRV, steps,", "  stress score, sleep stages", "Home cuff, pillbox, MyZenn logs", "Real time: WebSocket replay stream,", "  webcam heart rate (rPPG), Bluetooth", "  strap; stored in SQLite"])
box(4, 11, 34, 24, "Physiology simulator", ["400 patients x 60 days, hourly", "BP = base - meds x adherence", "  + stress + sleep + salt + circadian", "Hidden ambulatory BP gives labels", "(model never sees the ground truth)"], fc=TEAL_W, ec=TEAL)
arrow(21, 35.5, 21, 37.6, TEAL)

# ── Twin engine ──
group(46, 8, 70, 83, "2  Hybrid digital twin engine (Python)", TEAL)
box(48, 68, 66, 20, "Fusion feature store", ["71 features per patient every 6 h, strictly causal (data before t only)",
                                                "BP history, HRV vs 7-day baseline, sleep debt, missed-dose streak, salt load,",
                                                "mood trend, MyZenn practice + static EHR / genetic risk"])
box(48, 40, 32, 24, "Risk engine (ML)", ["LightGBM, 36 clinical monotone", "  constraints", "Platt-calibrated P(surge in 24 h)", "TreeSHAP driver explanations", "AUROC 0.92, 19 h median lead"])
box(82, 40, 32, 24, "Mechanistic twin", ["Bayesian per-patient calibration", "  on own cuff readings", "Personal sensitivities, phenotype", "24 h BP projection with band", "Scenario propagation into BP"])
box(48, 11, 66, 25, "What-if simulator + MySentinel", ["Scenario: +sleep, MyBreath minutes, adherence, low salt, steps",
                                                         "-> physics moves BP -> ML re-scores risk (hybrid counterfactual)",
                                                         "Policy tiers: crisis -> MySafe | high -> clinician alert | medium -> nudge",
                                                         "LinUCB bandit (port of MyZenn MyCompass) pre-trained in silico:",
                                                         "   -17 pts risk vs -9 pts random"], fc=TEAL_W, ec=TEAL)
arrow(40, 77, 47.4, 77, INK)
arrow(40, 50, 47.4, 72, INK)
arrow(64, 67.6, 64, 64.6, INK)
arrow(98, 67.6, 98, 64.6, INK)
arrow(80.4, 52, 81.6, 52, TEAL)
arrow(64, 39.6, 64, 36.6, INK)
arrow(98, 39.6, 98, 36.6, INK)

# ── Serving / UI ──
group(122, 8, 41, 83, "3  Clinician + patient experience", INK)
box(124, 70, 37, 18, "FastAPI service", ["/patients  /twin  /simulate  /streams", "/actions  /live  /model/metrics", "WebSocket /ws/stream (real time)"])
box(124, 36, 37, 30, "HridayTwin clinician console", ["React + TypeScript (MyZenn design)", "Triage roster by 24 h risk + phenotype", "BP twin chart + risk dial", "Why this risk + personal sensitivities", "What-if sliders, ranked care plan", "Live monitor: stream, camera, BLE", "Health record + model evidence"], fc="white", ec=INK)
box(124, 11, 37, 21, "MyZenn patient app", ["Prescribed protocol -> MyBreath,", "  MyBody, MyPeace, MyYoga", "MySentinel push / WhatsApp nudges", "MySafe crisis escalation", "Outcomes feed the bandit"], fc="#fbf1e0", ec=AMBER)
arrow(116, 52, 123.4, 78, INK, "JSON")
arrow(142.5, 69.6, 142.5, 66.6, INK)
arrow(142.5, 35.6, 142.5, 32.6, AMBER, "Prescribe", off=(6, 0))
arrow(123.4, 14, 114.6, 14, AMBER, "outcomes", off=(0, -3.2))
ax.text(124, 3.5, "Privacy: only derived scores leave the device (MyZenn edge model). Data residency: India.", fontsize=9, color=SLATE)
ax.text(2, 3.5, "Every number is from held-out patients; see artifacts/metrics.json.", fontsize=9, color=SLATE)

fig.savefig(OUT / "HridayTwin_Architecture.pdf", facecolor=PAPER, bbox_inches="tight")
fig.savefig(OUT / "HridayTwin_Architecture.png", dpi=150, facecolor=PAPER, bbox_inches="tight")
print("saved")
