"""Renders the HridayTwin diagram set with Graphviz.   python docs/make_diagrams.py

Writes docs/diagrams/NN_name.pdf + .png for each diagram and docs/HridayTwin_Diagrams.pdf (all pages).
Needs the Graphviz binaries (https://graphviz.org/download/) and `pip install graphviz pypdf`.
"""

import os
import shutil
from html import escape
from pathlib import Path

import graphviz

if shutil.which("dot") is None:  # Windows installer does not always add Graphviz to PATH
    for d in (r"C:\Program Files\Graphviz\bin", r"C:\Program Files (x86)\Graphviz\bin"):
        if Path(d, "dot.exe").exists():
            os.environ["PATH"] += os.pathsep + d

DOCS = Path(__file__).parent
OUT = DOCS / "diagrams"
INK, TEAL, TEAL_W, PAPER, SLATE, RED, RED_W, AMBER, AMBER_W, LAV, LAV_W = (
    "#15304b", "#009e9a", "#dff2f0", "#f7faf9", "#6b7c8f", "#c8412f", "#fbe9e6", "#d9912b", "#fbf1e0", "#6b5fb5", "#eeebfa")
FONT = "Helvetica"


def card(title: str, lines=(), color: str = INK) -> str:
    """HTML label: bold title plus small body lines."""
    rows = f'<TR><TD ALIGN="LEFT"><B><FONT POINT-SIZE="13" COLOR="{color}">{escape(title)}</FONT></B></TD></TR>'
    for ln in lines:
        rows += f'<TR><TD ALIGN="LEFT"><FONT POINT-SIZE="10" COLOR="#3a5068">{escape(ln)}</FONT></TD></TR>'
    return f'<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="1">{rows}</TABLE>>'


def new(name: str, title: str, subtitle: str, rankdir: str = "LR", **graph) -> graphviz.Digraph:
    g = graphviz.Digraph(name)
    g.attr(rankdir=rankdir, bgcolor=PAPER, fontname=FONT, pad="0.4", nodesep="0.35", ranksep="0.55",
           labelloc="t", labeljust="l", newrank="true", compound="true",
           label=f'<<FONT POINT-SIZE="22" COLOR="{INK}"><B>{escape(title)}</B></FONT><BR ALIGN="LEFT"/>'
                 f'<FONT POINT-SIZE="12" COLOR="{SLATE}">{escape(subtitle)}</FONT><BR ALIGN="LEFT"/> >', **graph)
    g.attr("node", shape="box", style="rounded,filled", fillcolor="white", color=INK, penwidth="1.3",
           fontname=FONT, margin="0.16,0.08")
    g.attr("edge", color=INK, penwidth="1.3", arrowsize="0.8", fontname=FONT, fontsize="10", fontcolor=SLATE)
    return g


def node(g, key, title, lines=(), color=INK, fill="white", **kw):
    g.node(key, card(title, lines, color), color=color, fillcolor=fill, **kw)


def group(parent, key, label, color):
    sub = graphviz.Digraph(name=f"cluster_{key}")
    sub.attr(label=f'<<B>{escape(label)}</B>>', fontcolor=color, fontsize="14", color=color, style="rounded,dashed",
             penwidth="1.2", margin="14", labeljust="l")
    return sub


# ── 1. System architecture ─────────────────────────────────────────────────
def system_architecture():
    g = new("01_system_architecture", "HridayTwin: system architecture",
            "Two data streams fused into a hybrid digital twin; a doctor-facing console; interventions delivered through MyZenn.")
    data = group(g, "data", "1  Data streams (synthetic + live)", INK)
    node(data, "ehr", "Static / historical EHR", ["Synthea-style CSVs", "Demographics, lifestyle, habitual salt",
                                                   "Diagnoses (SNOMED-CT)", "Labs (LOINC): eGFR, HbA1c, UACR, Na, K",
                                                   "Medications", "Genes: AGT, ACE, CYP11B2, GNB3, PRS"])
    node(data, "wear", "Wearables + IoT (hourly)", ["Smartwatch: HR, HRV (RMSSD), steps,", "stress score, sleep stages",
                                                     "Home BP cuff (morning / evening)", "Smart pillbox dose log"])
    node(data, "mz", "MyZenn app signals", ["Mood check-ins (MyWheel)", "MyBreath / meditation minutes", "Salty-meal food log"],
         color=LAV, fill=LAV_W)
    node(data, "live", "Live sources", ["WebSocket replay, 1 hour per tick", "Webcam heart rate (rPPG, in browser)",
                                         "Bluetooth HR strap / watch (RR → HRV)"])
    data.node("sqlite", card("SQLite live.db", ["every live reading,", "source + signal quality"]), shape="cylinder",
              style="filled", fillcolor="white", color=SLATE)
    node(data, "sim", "Physiology simulator", ["400 patients × 60 days, hourly", "generates every stream below"],
         color=TEAL, fill=TEAL_W)
    node(data, "truth", "Hidden ambulatory BP", ["surge labels; never a model input"], color=RED, fill=RED_W)
    with data.subgraph() as col:
        col.attr(rank="same")
        for k in ("sim", "ehr", "wear", "mz", "truth"):
            col.node(k)
    g.subgraph(data)

    eng = group(g, "engine", "2  Hybrid digital twin engine (Python)", TEAL)
    node(eng, "feat", "Fusion feature store", ["71 strictly causal features every 6 h", "HRV vs 7-day baseline, sleep debt,",
                                                "missed-dose streak, salt, mood trend", "+ static EHR and genetics"])
    node(eng, "risk", "Risk engine (ML)", ["LightGBM, 36 clinical monotone constraints", "Platt-calibrated P(surge in 24 h)",
                                           "TreeSHAP driver explanations"])
    node(eng, "twin", "Mechanistic twin", ["Bayesian per-patient calibration", "Personal sensitivities, phenotype",
                                           "24 h BP projection, 80% band"])
    node(eng, "whatif", "What-if simulator", ["Scenario edits the recent streams", "physiology moves BP → ML re-scores risk"],
         color=TEAL, fill=TEAL_W)
    node(eng, "sentinel", "MySentinel policy", ["Tiers: crisis / high / elevated / stable", "Hysteresis + 12 h alert cooldown",
                                                "LinUCB bandit picks the intervention"], color=TEAL, fill=TEAL_W)
    with eng.subgraph() as col:
        col.attr(rank="same"); col.node("twin"); col.node("risk")
    with eng.subgraph() as col:
        col.attr(rank="same"); col.node("whatif"); col.node("sentinel")
    g.subgraph(eng)

    ux = group(g, "ux", "3  Serving and experiences", INK)
    node(ux, "api", "FastAPI service", ["REST: /patients /twin /simulate", "/streams /actions /live /model/metrics",
                                        "WebSocket: /ws/stream/{id}"])
    node(ux, "console", "Clinician console", ["React + TypeScript, MyZenn design", "Triage roster, BP twin chart, risk dial",
                                              "Why this risk, what-if, care plan", "Live monitor, health record, evidence"])
    node(ux, "app", "MyZenn patient app  ·  myzenn.com", ["MyBreath, MyBody, MyPeace, MyYoga", "MySentinel nudges",
                                                          "MySafe crisis escalation"], color=AMBER, fill=AMBER_W)
    with ux.subgraph() as col:
        col.attr(rank="same"); col.node("api"); col.node("console"); col.node("app")
    g.subgraph(ux)

    g.edge("sim", "ehr", style="invis"); g.edge("ehr", "wear", style="invis"); g.edge("wear", "mz", style="invis"); g.edge("mz", "truth", style="invis")
    g.edge("ehr", "feat"); g.edge("wear", "feat"); g.edge("mz", "feat")
    g.edge("live", "sqlite", label="POST /api/live")
    g.edge("sqlite", "feat", label="overlay", style="dashed")
    g.edge("truth", "risk", style="dashed", color=RED, fontcolor=RED, label="training labels only")
    g.edge("feat", "risk"); g.edge("feat", "twin")
    g.edge("twin", "whatif"); g.edge("risk", "whatif"); g.edge("risk", "sentinel")
    g.edge("whatif", "sentinel", label="ranked\ncare plan")
    g.edge("sentinel", "api", label="JSON")
    g.edge("api", "console", dir="both", label="REST +\nWebSocket")
    g.edge("console", "app", color=AMBER, fontcolor=AMBER, label="Prescribe\n(deep link)")
    g.edge("app", "sentinel", color=AMBER, fontcolor=AMBER, style="dashed", label="outcomes →\nbandit reward", constraint="false")
    return g


# ── 2. Data fusion and ML pipeline ─────────────────────────────────────────
def ml_pipeline():
    g = new("02_ml_pipeline", "Data fusion and model training pipeline",
            "How the synthetic cohort becomes a calibrated 24-hour surge predictor, with every number from held-out patients.",
            rankdir="TB")
    node(g, "sim", "Physiology simulator", ["400 patients × 60 days, hourly",
                                            "576,000 hourly rows, 4,577 surges"], color=TEAL, fill=TEAL_W)
    node(g, "ehr", "EHR tables (static)", ["patients, conditions, observations,", "medications, genomics"])
    node(g, "streams", "Streams (dynamic)", ["hourly wearable, cuff, pillbox,", "diet, mood, sleep"])
    node(g, "truth", "Hidden ground truth", ["hourly ambulatory BP, latent params,", "surge events: never shown to the model"],
         color=RED, fill=RED_W)
    node(g, "feat", "Feature builder", ["Queried at 00, 06, 12, 18 h; 7-day lookback", "71 features, strictly causal",
                                        "(test: corrupting the future changes nothing)"])
    node(g, "label", "Label", ["Surge starts in the next 24 h:", "SBP ≥ 160 or DBP ≥ 100 for ≥ 2 h"], color=RED, fill=RED_W)
    node(g, "ds", "Training table", ["83,600 samples × 71 features", "positive rate 13.6%"])
    node(g, "split", "Patient-level split", ["240 train / 60 validation / 100 test", "no patient in two sets"])
    node(g, "train", "LightGBM", ["36 monotone constraints", "early stopping on validation (156 trees)"])
    node(g, "cal", "Platt calibration", ["fitted on validation patients"])
    node(g, "eval", "Held-out evaluation (100 patients)", ["AUROC 0.920, AUPRC 0.672, Brier 0.067",
                                                            "79% of surges flagged at ≥ 30%, median 19 h ahead"],
         color=TEAL, fill=TEAL_W)
    node(g, "abl", "Fusion ablation (AUROC)", ["EHR only 0.80, wearables + MyZenn 0.78", "home cuff 0.89, all dynamic 0.918",
                                               "fusion 0.920"])
    node(g, "shap", "TreeSHAP", ["per-prediction drivers,", "grouped: BP history, stress & HRV, sleep…"])
    node(g, "prior", "Twin population prior", ["fitted on training patients"])
    node(g, "tval", "Twin validation", ["stress sensitivity recovered, ρ = 0.76", "true driver in top two for 84%"],
         color=TEAL, fill=TEAL_W)
    node(g, "bandit", "LinUCB bandit", ["pre-trained on 1,500 in-silico twin cases", "−16 pts risk vs −8.5 random (oracle −18)"])
    g.node("art", card("artifacts/", ["risk_model.txt, calibrator.joblib, twin_prior.json,",
                                      "sentinel_bandit.json, metrics.json, plots/"]), shape="cylinder", style="filled")
    g.edge("sim", "ehr"); g.edge("sim", "streams"); g.edge("sim", "truth", color=RED)
    g.edge("ehr", "feat"); g.edge("streams", "feat"); g.edge("truth", "label", color=RED)
    g.edge("feat", "ds"); g.edge("label", "ds", color=RED)
    g.edge("ds", "split"); g.edge("split", "train"); g.edge("train", "cal"); g.edge("cal", "eval")
    g.edge("split", "abl"); g.edge("train", "shap"); g.edge("split", "prior"); g.edge("prior", "tval")
    g.edge("prior", "bandit", xlabel="simulates outcomes")
    for s in ("eval", "shap", "tval", "bandit", "abl"):
        g.edge(s, "art", style="dashed", color=SLATE)
    return g


# ── 3. Real-time data flow ─────────────────────────────────────────────────
def realtime():
    g = new("03_realtime_flow", "Real-time data flow",
            "Three live sources feed one twin. Every reading is stored, and the risk updates within seconds.")
    src = group(g, "src", "Sources", INK)
    node(src, "replay", "Streaming replay", ["patient's wearable, cuff, pillbox", "and app data, 1 hour per tick"])
    node(src, "cam", "Webcam", ["forehead region, 30 fps"])
    node(src, "ble", "Bluetooth strap / watch", ["standard BLE heart-rate profile", "with RR intervals (true HRV)"])
    g.subgraph(src)
    browser = group(g, "browser", "In the browser (video never leaves the device)", LAV)
    node(browser, "rppg", "rPPG", ["POS algorithm + FFT", "signal-quality gate, skin check"], color=LAV, fill=LAV_W)
    node(browser, "hook", "useBiometricDevice", ["MyZenn MyPulse hook"], color=LAV, fill=LAV_W)
    g.subgraph(browser)
    srv = group(g, "srv", "HridayTwin server", TEAL)
    node(srv, "ws", "WS /ws/stream/{id}", ["pause, resume, speed"])
    node(srv, "post", "POST /api/live/{id}", ["hr, hrv, source, quality"])
    srv.node("db", card("LiveStore (SQLite)", ["every reading kept with", "source and quality"]), shape="cylinder",
             style="filled", fillcolor="white", color=SLATE)
    node(srv, "overlay", "Active-session overlay", ["median HR / HRV of the live session", "replaces the twin's last 3 hours"])
    node(srv, "score", "Re-score the twin", ["features → LightGBM → calibrated risk", "projection + drivers"], color=TEAL, fill=TEAL_W)
    node(srv, "alert", "MySentinel alert", ["tier with hysteresis (no flapping)", "12 h cooldown per tier",
                                            "drivers + recommended protocol"], color=TEAL, fill=TEAL_W)
    node(srv, "events", "Stream events", ["cuff reading, missed dose,", "mood check-in"])
    with srv.subgraph() as col:
        col.attr(rank="same"); col.node("alert"); col.node("events")
    g.subgraph(srv)
    out = group(g, "out", "Clinician and patient", AMBER)
    node(out, "console", "Live monitor (console)", ["risk line, event log, alerts", "true BP overlay for evaluation only"])
    node(out, "app", "MyZenn app", ["protocol + reminder"], color=AMBER, fill=AMBER_W)
    with out.subgraph() as col:
        col.attr(rank="same"); col.node("console"); col.node("app")
    g.subgraph(out)
    g.edge("replay", "ws"); g.edge("cam", "rppg"); g.edge("ble", "hook")
    g.edge("rppg", "post", label="HR only"); g.edge("hook", "post", label="HR + HRV")
    g.edge("post", "db"); g.edge("db", "overlay"); g.edge("overlay", "score")
    g.edge("ws", "score", label="every tick"); g.edge("ws", "events")
    g.edge("score", "alert")
    g.edge("alert", "console"); g.edge("events", "console")
    g.edge("console", "app", color=AMBER, fontcolor=AMBER, label="Prescribe")
    return g


# ── 4. Hybrid twin and what-if ─────────────────────────────────────────────
def hybrid_whatif():
    g = new("04_hybrid_twin_whatif", "The hybrid twin: ML for accuracy, physiology for what-if",
            "A scenario changes the patient's recent behaviour; the physiology moves blood pressure; the ML model re-scores the risk.",
            rankdir="TB")
    node(g, "hist", "This patient's last 7 days", ["cuff readings, HR, HRV, sleep,", "doses, salt, mood, MyZenn minutes"])
    node(g, "ehr", "EHR + genetics", ["age, BMI, CKD, OSA, anxiety,", "AGT genotype, PRS"])
    node(g, "prior", "Population prior", ["from 240 training patients"])
    node(g, "post", "Bayesian calibration", ["posterior fitted on the patient's own cuff readings"], color=TEAL, fill=TEAL_W)
    node(g, "sens", "Personal sensitivities", ["mmHg per 10 stress points, per hour of sleep debt,",
                                                "per gram of extra salt; drug effect"])
    node(g, "pheno", "Phenotype", ["stress-reactive, salt-sensitive,", "adherence-dependent, sleep-linked"])
    node(g, "scen", "Scenario (doctor's sliders)", ["MyBreath minutes, +sleep hours, every dose,", "low salt, extra steps"],
         color=AMBER, fill=AMBER_W)
    node(g, "edit", "Edit the recent streams", ["less stress and higher HRV, less sleep debt,", "full med level, lower salt load"])
    node(g, "phys", "Physiology propagates", ["BP = base − meds·adherence + β·stress + γ·sleep debt", "+ salt sensitivity·salt + circadian"])
    node(g, "ml", "ML re-scores", ["features rebuilt → LightGBM → Platt"])
    node(g, "proj", "New 24 h BP projection", ["with 80% band (dashed on the chart)"], color=TEAL, fill=TEAL_W)
    node(g, "risk", "Risk before → after", ["e.g. 64% → 17% with adherence rescue"], color=TEAL, fill=TEAL_W)
    node(g, "plan", "Care plan", ["5 protocols ranked by simulated risk reduction", "Prescribe → MyZenn"], color=AMBER, fill=AMBER_W)
    g.edge("hist", "post"); g.edge("prior", "post"); g.edge("ehr", "prior", style="dashed")
    g.edge("post", "sens"); g.edge("sens", "pheno")
    g.edge("scen", "edit"); g.edge("hist", "edit", style="dashed")
    g.edge("edit", "phys"); g.edge("sens", "phys"); g.edge("edit", "ml")
    g.edge("phys", "proj"); g.edge("ml", "risk"); g.edge("proj", "plan"); g.edge("risk", "plan")
    with g.subgraph() as s:
        s.attr(rank="same"); s.node("phys"); s.node("ml")
    return g


# ── 5. MySentinel decision flow ────────────────────────────────────────────
def sentinel_flow():
    g = new("05_mysentinel_decision", "MySentinel: from a risk score to an action",
            "Safety rules first, then the learned policy. Thresholds from twin_engine/config.py.", rankdir="TB")
    g.attr(nodesep="0.5")
    node(g, "in", "New data or the 6-hourly re-score", ["cuff reading, wearable hour, live reading"])
    g.attr("node", shape="diamond", style="filled", fillcolor="white", margin="0.05")
    g.node("q1", "Reading ≥ 180/110?", fontsize="11")
    g.node("q2", "Risk ≥ 55%?", fontsize="11")
    g.node("q3", "Risk ≥ 30%?", fontsize="11")
    g.node("q4", "Same tier alerted\nin last 12 h?", fontsize="11")
    g.attr("node", shape="box", style="rounded,filled", margin="0.16,0.08")
    node(g, "crisis", "Crisis: MySafe", ["call the patient now; ER advice", "if symptomatic"], color=RED, fill=RED_W)
    node(g, "high", "High: clinician alert", ["drivers + protocol to the doctor"], color=RED, fill="white")
    node(g, "med", "Elevated: nudge", ["protocol in the MyZenn app"], color=AMBER, fill=AMBER_W)
    node(g, "low", "Stable", ["weekly digest, keep watching"], color=TEAL, fill=TEAL_W)
    node(g, "hold", "Hold", ["log only; hysteresis stops flapping"], color=SLATE)
    node(g, "bandit", "LinUCB picks the protocol", ["context: phenotype, drivers, risk", "5 arms: breath, sleep, adherence,",
                                                     "salt, move"], color=TEAL, fill=TEAL_W)
    node(g, "twin", "Twin checks each arm", ["simulated risk reduction"])
    node(g, "send", "Deliver", ["MyZenn deep link (MyBreath, MyBody, MyYoga…)", "quiet hours, no diagnosis on lock screen"],
         color=AMBER, fill=AMBER_W)
    node(g, "out", "Outcome", ["risk change over the next 24 h"])
    g.edge("in", "q1")
    g.edge("q1", "crisis", xlabel="yes"); g.edge("q1", "q2", xlabel="no")
    g.edge("q2", "q4", xlabel="yes"); g.edge("q2", "q3", xlabel="no")
    g.edge("q3", "q4", xlabel="yes"); g.edge("q3", "low", xlabel="no")
    g.edge("q4", "hold", xlabel="yes"); g.edge("q4", "high", xlabel="no, high"); g.edge("q4", "med", xlabel="no, elevated")
    g.edge("high", "bandit"); g.edge("med", "bandit")
    g.edge("bandit", "twin"); g.edge("twin", "send"); g.edge("send", "out")
    g.edge("out", "bandit", style="dashed", color=TEAL, fontcolor=TEAL, xlabel="reward → update", constraint="false")
    return g


# ── 6. Causal model behind the synthetic data ──────────────────────────────
def causal_model():
    g = new("06_causal_simulator", "The causal model behind the synthetic cohort",
            "Why every surge has a known cause. Dashed = hidden from the model; solid = what a real clinic would observe.",
            rankdir="TB")
    g.attr(ranksep="0.6", nodesep="0.3")
    hid = dict(style="rounded,filled,dashed", fillcolor="#eef2f6", color=SLATE)
    st = group(g, "static", "Observed inputs: static EHR and MyZenn practice", INK)
    for k, t in (("agebmi", "Age, BMI"), ("ckd", "CKD, T2DM"), ("osa", "Sleep apnoea"), ("anx", "Anxiety"),
                 ("genes", "Genes: AGT, PRS, risk alleles"), ("habit", "Habitual salt, tobacco, alcohol"),
                 ("job", "Occupation")):
        node(st, k, t)
    node(st, "session", "MyZenn breathing session", ["observed in the app"], color=LAV, fill=LAV_W)
    with st.subgraph() as row:
        row.attr(rank="same")
        for k in ("agebmi", "ckd", "osa", "anx", "genes", "habit", "job", "session"):
            row.node(k)
    g.subgraph(st)
    lat = group(g, "latent", "Hidden physiology and daily drivers (never shown to the model)", SLATE)
    for k, t, ln in (("base", "Base SBP", []), ("beta", "Stress sensitivity β", []), ("gamma", "Sleep sensitivity γ", []),
                     ("saltsens", "Salt sensitivity", []), ("dip", "Night dip / morning surge", ["non-dipper if OSA, CKD, T2DM"]),
                     ("stress", "Stress", ["episodes build over 1–2 days", "+ workday bump"]),
                     ("debt", "Sleep debt", ["short, broken nights"]), ("medlvl", "Medication level", ["missed-dose gaps"]),
                     ("saltload", "Salt load", ["festival / restaurant meals"]), ("act", "Activity", [])):
        lat.node(k, card(t, ln, SLATE), **hid)
    lat.node("abpm", card("Ambulatory BP (hourly)", ["SBP = base − meds·level + β·stress", "+ γ·debt + salt sens·salt",
                                                     "+ circadian + noise"], RED),
             style="rounded,filled,dashed", fillcolor=RED_W, color=RED)
    g.subgraph(lat)
    obs = group(g, "obs", "What a real clinic would observe", TEAL)
    for k, t, ln in (("watch", "Smartwatch", ["HR, HRV (RMSSD), stress score, steps"]),
                     ("sleep", "Sleep stages", ["deep, REM, awakenings"]), ("mood", "MyZenn mood check-ins", []),
                     ("pill", "Smart pillbox log", []), ("diet", "Food log", ["65% of salty meals logged"]),
                     ("cuff", "Home cuff", ["morning 72%, evening 58% of days"])):
        node(obs, k, t, ln, color=TEAL)
    with obs.subgraph() as col:
        col.attr(rank="same")
        for k in ("watch", "sleep", "mood", "pill", "diet", "cuff"):
            col.node(k)
    g.subgraph(obs)
    g.node("surge", card("Surge label", ["≥ 160/100 for ≥ 2 h"], RED), style="rounded,filled,dashed", fillcolor=RED_W, color=RED)
    for a, b in (("agebmi", "base"), ("agebmi", "beta"), ("ckd", "base"), ("ckd", "saltsens"), ("ckd", "dip"),
                 ("genes", "base"), ("genes", "saltsens"), ("habit", "base"), ("osa", "gamma"), ("osa", "dip"),
                 ("osa", "debt"), ("anx", "beta"), ("anx", "stress"), ("job", "stress")):
        g.edge(a, b, color=SLATE)
    g.edge("session", "stress", color=LAV, label="relief")
    g.edge("stress", "debt", color=SLATE); g.edge("stress", "act", color=SLATE)
    for a in ("base", "beta", "gamma", "saltsens", "dip", "stress", "debt", "medlvl", "saltload", "act"):
        g.edge(a, "abpm", color=SLATE)
    g.edge("session", "abpm", color=LAV, label="acute −4 mmHg", constraint="false")
    for a, b in (("stress", "watch"), ("debt", "watch"), ("act", "watch"), ("stress", "mood"), ("debt", "sleep"),
                 ("medlvl", "pill"), ("saltload", "diet")):
        g.edge(a, b, color=TEAL)
    g.edge("abpm", "cuff", color=TEAL, label="sparse, noisy")
    g.edge("abpm", "surge", color=RED)
    return g


# ── 7. Clinician workflow ──────────────────────────────────────────────────
def clinician_workflow():
    g = new("07_clinician_workflow", "How a doctor works with the virtual patient",
            "One morning in the HridayTwin console, and what the patient sees in MyZenn.")
    lanes = (("doc", "Doctor", INK, ["d1", "d2", "d3", "d4", "d5", "d6"]),
             ("tw", "HridayTwin", TEAL, ["t1", "t2", "t3", "t4", "t5", "t6"]),
             ("pt", "Patient (MyZenn)", AMBER, ["p1", "p2", "p3", "p4", "p5", "p6"]))
    text = {
        "d1": ("1  Morning triage", ["patients sorted by 24 h risk"]), "t1": ("Rank the panel", ["tier counts, phenotype badges", "re-scored every 6 h"]),
        "d2": ("2  Open a virtual patient", []), "t2": ("BP twin chart", ["cuff readings + 24 h projection", "risk dial, next-24 h facts"]),
        "d3": ("3  Ask why", []), "t3": ("Explain", ["SHAP drivers today", "personal sensitivities"]),
        "d4": ("4  Try what-if", ["MyBreath, sleep, doses, salt, steps"]), "t4": ("Simulate", ["physiology → BP, ML → risk", "new dashed curve"]),
        "d5": ("5  Act", ["prescribe, tele-consult,", "medication review, MySafe"]), "t5": ("MySentinel", ["schedules the protocol", "logs the action"]),
        "d6": ("6  Follow up", ["live monitor, evidence tab"]), "t6": ("Keep learning", ["outcome → bandit reward"]),
        "p1": ("Wears watch, uses cuff", ["data flows in passively"]), "p2": ("", []), "p3": ("", []),
        "p4": ("", []), "p5": ("Gets a gentle nudge", ["“A moment of calm is waiting”", "opens MyBreath / MyBody / MyYoga"]),
        "p6": ("Practises; readings flow back", ["crisis reading → MySafe call"]),
    }
    for key, label, color, ids in lanes:
        lane = group(g, key, label, color)
        lane.attr(rank="same")
        for i in ids:
            t, ln = text[i]
            if t:
                fill = {INK: "white", TEAL: TEAL_W, AMBER: AMBER_W}[color]
                node(lane, i, t, ln, color=color, fill=fill)
            else:
                lane.node(i, "", style="invis", width="0.1")
        for a, b in zip(ids, ids[1:]):
            lane.edge(a, b, style="solid" if text[a][0] and text[b][0] else "invis", color=color)
        g.subgraph(lane)
    for i in range(1, 7):
        g.edge(f"d{i}", f"t{i}", dir="both", color=SLATE)
    g.edge("t5", "p5", color=AMBER, xlabel="deep link")
    g.edge("p1", "t1", color=TEAL, style="dashed", xlabel="streams")
    g.edge("p6", "t6", color=TEAL, style="dashed")
    return g


# ── 8. Privacy and deployment boundaries ───────────────────────────────────
def privacy_deployment():
    g = new("08_privacy_deployment", "Privacy and deployment",
            "Synthetic data only for training. On live devices, only derived numbers leave the phone or laptop.")
    dev = group(g, "dev", "Patient's device", LAV)
    node(dev, "cam", "Camera heart rate", ["video processed in the browser", "only the number is sent"], color=LAV, fill=LAV_W)
    node(dev, "ble", "Bluetooth wearable", ["HR + RR intervals"], color=LAV, fill=LAV_W)
    node(dev, "app", "MyZenn app", ["on-device forecasting design (MyOracle)", "nudges carry no diagnosis"], color=AMBER, fill=AMBER_W)
    g.subgraph(dev)
    srv = group(g, "srv", "HridayTwin server (Docker; one-click Render blueprint)", TEAL)
    node(srv, "api", "FastAPI + twin engine", ["risk, twin, what-if, MySentinel"])
    srv.node("db", card("SQLite + artifacts", ["live readings with source and quality", "trained model files"]), shape="cylinder",
             style="filled", fillcolor="white", color=SLATE)
    g.subgraph(srv)
    clin = group(g, "clin", "Clinic", INK)
    node(clin, "console", "Clinician console", ["decision support, the doctor decides", "every action is logged"])
    g.subgraph(clin)
    train = group(g, "train", "Training data: synthetic by design", RED)
    node(train, "sim", "Causal simulator", ["Synthea-schema EHR", "no real patient data (DPDP Act, HIPAA)"], color=RED, fill=RED_W)
    node(train, "next", "Next: open data", ["MIMIC-IV, open wearable datasets,", "then a consented pilot with ABPM"], color=SLATE)
    g.subgraph(train)
    g.edge("cam", "api", label="HTTPS: hr,\nsource, quality"); g.edge("ble", "api", label="hr, hrv")
    g.edge("api", "db", dir="both"); g.edge("api", "console", dir="both", label="JSON /\nWebSocket")
    g.edge("console", "app", color=AMBER, fontcolor=AMBER, label="prescription\ndeep link")
    g.edge("sim", "api", style="dashed", color=RED, fontcolor=RED, label="trains the\nmodels")
    g.edge("next", "sim", style="dotted", color=SLATE, arrowhead="none")
    return g


DIAGRAMS = [system_architecture, ml_pipeline, realtime, hybrid_whatif, sentinel_flow, causal_model,
            clinician_workflow, privacy_deployment]

if __name__ == "__main__":
    from pypdf import PdfWriter

    OUT.mkdir(exist_ok=True)
    pdfs = []
    for make in DIAGRAMS:
        g = make()
        pdfs.append(Path(g.render(outfile=OUT / f"{g.name}.pdf", cleanup=True)))
        g.graph_attr["dpi"] = "160"
        g.render(outfile=OUT / f"{g.name}.png", cleanup=True)
        print("saved", g.name)
    merged = PdfWriter()
    for p in pdfs:
        merged.append(p)
    merged.write(DOCS / "HridayTwin_Diagrams.pdf")
    print("saved HridayTwin_Diagrams.pdf")
