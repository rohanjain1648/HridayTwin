# HridayTwin — Ideation & Winning Strategy

*Happiest Health Digital Twin Challenge 2026 · Track: Hypertension · Built on MyZenn*

---

## 1. What the judges are scoring (read between the lines)

| Requirement in the brief | What most teams will do | What we do |
|---|---|---|
| Fuse **static EHR** + **dynamic wearable** streams | Concatenate two tables into one model | Prove the fusion adds value with an **ablation study** (EHR-only vs wearable-only vs fused) |
| **Predict an adverse event** | "Risk score" with no time horizon | **Hypertensive surge in the next 24 h**, with a measured **median lead time** |
| "Digital Twin" | A dashboard with a patient's data | A **hybrid twin**: a per-patient calibrated physiology model plus an ML risk engine, able to run **"what-if" simulations** |
| **Doctor-facing UI** | Static mock-up | A working clinician console with triage, explanations, simulator and care-plan actions |
| Synthetic / open data (DPDP, HIPAA) | Random numbers | A **causal physiology simulator** with Synthea-schema EHR and India-specific risk factors |
| Real-world healthcare impact | Generic slide | India framing: 188M adults with hypertension, only ~15% controlled (WHO, 2023); stress, sleep, salt and adherence as levers |

## 2. The insight: hypertension is not only a vascular problem

Most BP tools watch the cuff. But in young and middle-aged urban Indians the **drivers** are behavioural and psychological:
chronic stress, short or broken sleep, missed medication, and salt-heavy meals. These show up in wearables **before** they
show up on the cuff: HRV falls, resting HR drifts up, sleep fragments, mood check-ins drop.

**MyZenn already measures the mind layer** (mood check-ins, stress, HRV over BLE, sleep proxies) and already has a
proactive intervention engine (MySentinel) and a proven set of stress tools (MyBreath slow breathing, MyBody scan, MyYoga,
MyPeace). Slow breathing at about 6 breaths/min is a known BP-lowering technique (the device-guided breathing class is
FDA-cleared as an adjunct for hypertension).

> **HridayTwin = the first stress-aware hypertension digital twin.** It predicts a BP surge 24 h ahead, tells the doctor
> *why* (stress vs sleep vs salt vs missed meds), and simulates which intervention would prevent it.

"Hriday" (हृदय) means *heart*.

## 3. The product in one screen

A doctor opens the **HridayTwin console**:

1. **Triage roster**: patients ranked by 24 h surge risk, with a phenotype badge (Stress-driven, Salt-sensitive, Non-dipper, Adherence-gap).
2. **Virtual patient view**
   - EHR card: demographics, diagnoses, labs (eGFR, HbA1c, LDL, Na/K), meds, genetic markers (AGT M235T, ACE I/D, polygenic score)
   - 7-day wearable streams: HR, HRV (RMSSD), steps, sleep stages, home-cuff BP, MyZenn mood/stress
   - **Risk gauge**: probability of a hypertensive surge in the next 24 h, plus the projected BP curve for that window
   - **Why**: the top drivers for this prediction, with direction and size
3. **Twin simulator**: sliders for *+sleep hours*, *daily MyBreath minutes*, *medication adherence*, *sodium reduction*, *steps*.
   The twin re-runs and shows the new risk and BP curve live. Example: "10 min MyBreath + full adherence cuts tomorrow's risk from 71% to 24%."
4. **Care-plan actions**: *Prescribe MyZenn protocol* (pushes to the patient's MyZenn app via MySentinel), *Tele-consult*, *Titrate meds*.
   MySafe escalation fires automatically at crisis-range readings.
5. **Live device mode**: pair a real BLE chest strap or watch (MyZenn's `useBiometricDevice` hook) and stream HR/HRV into the twin in real time.

## 4. Technical design

```
 Synthea-style EHR ─┐                                      ┌─► Risk engine (LightGBM, calibrated)
 (static)           ├─► Fusion feature store ──────────────┤     P(surge in next 24 h) + drivers
 Wearables/IoT  ────┘   (7-day windows, circadian,         │
 (dynamic, hourly)       HRV trend, sleep debt, adherence) └─► Mechanistic twin (per-patient calibrated)
                                                               BP = base + circadian + β·stress + γ·sleep debt
                                                                    + salt − meds·adherence …
                                                               → counterfactual "what-if" simulation
                                    ▼
             MySentinel policy + LinUCB bandit → chooses the intervention (MyBreath / MyBody / MyYoga / med reminder)
                                    ▼
                    FastAPI  ──►  React clinician console (MyZenn design system)
```

**Event definition.** A hypertensive surge is SBP ≥ 160 or DBP ≥ 100 (stage-2 range) sustained for 2 or more consecutive hours
on the ground-truth ambulatory BP signal. The model is queried every 6 h and predicts whether a surge starts in the next 24 h.
It **never sees** the ambulatory signal, only sparse home-cuff readings (morning and evening), as in real life.

**Why hybrid (physics + ML)?** The ML model is accurate but cannot answer "what if". The mechanistic model is interpretable and
can simulate, but is less accurate. Together they give accuracy *and* counterfactuals, which is what a digital twin is.

**Evaluation.** Patient-level train/test split (no patient appears in both), AUROC, AUPRC, Brier score, sensitivity at a fixed
alert budget, median lead time, and the fusion ablation.

## 5. Why this wins

1. **Answers every line of the brief** (fusion, prediction, twin, doctor UI, synthetic data) with evidence, not claims.
2. **A real "twin"**, not a dashboard: per-patient calibration and counterfactual simulation.
3. **Unique angle**: the mind-body link, which no pure-vitals team will have. It is backed by a live product (myzenn.com).
4. **Closes the loop**: prediction → explanation → simulation → intervention → learning (bandit).
5. **India-first**: salt and festival diet effects, adherence gaps, Hindi-ready UX, DPDP-aligned privacy (only derived scores leave the device).
6. **Demo-able in 5 minutes** and runs on a laptop with one command.

## 6. 20-minute video outline

| Min | Segment |
|---|---|
| 0–2 | Problem: India's silent hypertension epidemic (188M, ~15% controlled); why reactive care fails |
| 2–4 | Insight: stress, sleep, salt, adherence; MyZenn's mind layer |
| 4–7 | Data: the synthetic EHR + wearable simulator, DPDP compliance |
| 7–11 | Model: features, LightGBM, hybrid twin, evaluation and ablation |
| 11–17 | Live demo: triage → patient → why → simulator → prescribe → live BLE device |
| 17–19 | Architecture, privacy, scalability, cost |
| 19–20 | Impact, roadmap (clinical validation with a partner hospital), team |
