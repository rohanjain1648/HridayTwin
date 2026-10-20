# HridayTwin: 12-slide presentation content

Team AlphaGo, Jadavpur University · Happiest Health Digital Twin Challenge 2026, hypertension track.

Every number below comes from `artifacts/metrics.json` (100 held-out patients). Every visual named below already
exists in the repository. Export the finished deck to PDF as well as PPTX: the brief asks for "PDF/PPT".

**Look and feel.** MyZenn palette: ink `#15304b`, teal `#009e9a`, soft teal `#dff2f0`, amber `#d9912b`, crisis red `#c8412f`,
paper `#f7faf9`. One idea per slide, one big number where there is one. Headline as a full sentence, at most four bullets.

**Timing for the 20-minute video.** Slides 1–4: 4 min · 5–8: 6 min · 9–10 (live demo inside): 7 min · 11–12: 3 min.

---

## Slide 1. Title

**Headline:** HridayTwin: a stress-aware digital twin for hypertension

**Sub-line:** Predicts a blood-pressure surge 24 hours before it happens, explains why, and simulates which intervention
would prevent it. Built on MyZenn.

**On slide (small):** Team AlphaGo · Jadavpur University · Happiest Health Digital Twin Challenge 2026 · github.com/rohanjain1648/HridayTwin

**Visual:** `docs/screenshots/landing.png` cropped to the hero, or the risk dial from `docs/screenshots/console.png`.

**Speaker notes:** "Hriday means heart. We built a virtual copy of each patient's blood pressure. It reads their health
record and their smartwatch, warns the doctor a day before a dangerous surge, and tells them what would stop it."

---

## Slide 2. The problem

**Headline:** India's hypertension crisis happens between clinic visits.

**Big number:** 188 million Indian adults have hypertension; about 15% have it under control (WHO, 2023).

**Bullets:**
- Blood pressure is checked every few months; surges happen on ordinary days in between.
- Everyday triggers: stress, short or broken sleep, missed doses, salty meals.
- These show up on a smartwatch and in a wellness app *before* they show up on the cuff.
- Doctors have no early warning and no way to test "what if" for one specific patient.

**Visual:** a timeline: clinic visit, 90 empty days, clinic visit, with a surge in the gap.

**Speaker notes:** Stress the gap. Care is reactive because the data in between never reaches the doctor in a usable form.

---

## Slide 3. Our insight and solution

**Headline:** Surges announce themselves in the mind and body first. HridayTwin listens.

**Bullets:**
- **Predict:** every patient ranked by the chance of a sustained surge (≥160/100 for 2+ hours) in the next 24 h.
- **Explain:** today's drivers plus personal sensitivities ("+3.8 mmHg per 10 stress points").
- **Simulate:** what-if sliders (MyBreath minutes, extra sleep, every dose, low salt, walking); the twin re-runs live.
- **Act:** prescribe the protocol the twin says works best; it goes to the patient's MyZenn app. Crisis readings trigger MySafe.

**Visual:** a four-step loop (Predict → Explain → Simulate → Act → back to Predict). `docs/screenshots/landing_journey.png` works too.

**Speaker notes:** The unique angle is the mind-body link. HRV falls, resting heart rate drifts up and mood check-ins drop a
day or two before pressure rises. MyZenn already measures that layer.

---

## Slide 4. Two data streams, synthetic by design

**Headline:** Two data streams, fused. No real patient data anywhere.

**Two columns:**

| Static / historical EHR (Synthea-style) | Dynamic wearable + IoT (hourly) |
|---|---|
| Demographics, lifestyle, habitual salt | Heart rate, HRV (RMSSD), steps, stress score |
| Diagnoses in SNOMED-CT (T2DM, CKD, OSA, anxiety…) | Sleep stages and efficiency |
| Labs in LOINC (eGFR, HbA1c, lipids, Na, K, UACR) | Home BP cuff (morning / evening, often skipped) |
| Medications | Smart pillbox dose log |
| Genetic markers: AGT, ACE, CYP11B2, GNB3, polygenic score | MyZenn mood check-ins, breathing minutes, food log |

**Strip at the bottom:** 400 patients × 60 days · 576,000 hourly rows · 4,577 surges · causal physiology simulator ·
the hidden ambulatory BP is used only for labels, never as an input · DPDP Act and HIPAA safe.

**Visual:** `docs/diagrams/06_causal_simulator.png` (small), or the two columns alone.

**Speaker notes:** Because the simulator is causal, we know the true cause of every surge. That lets us check the twin's
explanations, not just its accuracy.

---

## Slide 5. Architecture

**Headline:** From raw streams to a doctor's decision in one pipeline.

**Visual (full slide):** `docs/diagrams/01_system_architecture.png`.

**Three call-outs on the image:**
1. Data streams: EHR, wearables, MyZenn signals, live sources (WebSocket, webcam, Bluetooth).
2. Hybrid twin engine: fusion features → risk engine + mechanistic twin → what-if → MySentinel.
3. Serving: FastAPI (REST + WebSocket) → clinician console → MyZenn app; outcomes return to the bandit.

**Speaker notes:** Walk left to right in 60 seconds. Mention that it runs on a laptop with one command and deploys as one
Docker container.

---

## Slide 6. The model: a hybrid twin

**Headline:** Machine learning for accuracy, physiology for "what if".

**Two columns:**
- **Risk engine (ML):** LightGBM on 71 strictly causal features every 6 hours. 36 clinical monotonicity constraints
  (taking more doses can never raise risk; lower HRV can never lower it). Platt-calibrated, so 30% means 30%. TreeSHAP
  explains each prediction.
- **Mechanistic twin (physiology):** BP = base − meds·adherence + β·stress + γ·sleep debt + salt sensitivity·salt + circadian.
  Calibrated per patient with a Bayesian posterior on their own cuff readings. Gives personal sensitivities, a phenotype
  and a 24 h BP projection with an 80% band.

**Bottom line:** A what-if scenario edits the recent streams, the physiology moves BP, and the ML model re-scores the
risk. That makes it a twin, not just a dashboard.

**Visual:** `docs/diagrams/04_hybrid_twin_whatif.png`.

**Speaker notes:** Explain why neither half is enough alone. ML can't answer counterfactuals, and physiology alone is less accurate.

---

## Slide 7. Results

**Headline:** On 100 patients the model never saw, HridayTwin warns 19 hours ahead.

**Four big numbers:**
- **0.920** AUROC for a surge in the next 24 h (AUPRC 0.672 at 13% prevalence; Brier 0.067).
- **79%** of surges flagged in advance at the 30% threshold.
- **19 h** median warning before onset; 96% of caught surges are flagged at least 6 h ahead.
- **0.6** high-tier alerts per patient per week, with 97% specificity and 72% PPV.

**Visual:** `artifacts/plots/performance.png` and `artifacts/plots/lead_time.png`.

**Speaker notes:** The split is by patient (240 train / 60 validation / 100 test), so no patient's data is in both training
and test. Alert burden matters to doctors; mention it before they ask.

---

## Slide 8. Why fusion and the twin both matter

**Headline:** Every stream adds signal, and the twin recovers each patient's real physiology.

**Left: fusion ablation (AUROC):**
- Wearables + MyZenn alone: 0.78
- EHR alone: 0.80
- Clinical rule (last home SBP): 0.85
- Home cuff alone (standard care): 0.886
- All dynamic streams: 0.918
- **HridayTwin fusion: 0.920**

**Right: twin validation:**
- Recovers each patient's hidden stress sensitivity: Spearman ρ = 0.76 (drug effect 0.59, salt 0.47, sleep 0.45).
- The true main driver is in the twin's top two for 84% of patients.

**Visual:** `artifacts/plots/ablation.png` and `artifacts/plots/twin_validation.png`.

**Speaker notes:** Be honest: the cuff carries most of the accuracy. The wearables and MyZenn add the *why* and the
early, behavioural warning that makes the interventions possible.

---

## Slide 9. The doctor's console (conceptual UI, fully working)

**Headline:** One morning, five clicks: triage, understand, simulate, act.

**Visual (large):** `docs/screenshots/console.png` with five numbered call-outs:
1. Triage roster: 100 patients ranked by 24 h risk, tier counts, phenotype badges.
2. BP twin chart: home cuff readings, the 24 h projection with its band, and the risk strip.
3. Why this risk: today's drivers and the patient's personal sensitivities.
4. What-if sliders: MyBreath minutes, sleep, adherence, salt, steps; the risk updates live.
5. Care plan: protocols ranked by simulated risk reduction; *Prescribe* opens the tool in MyZenn.

**Small inset:** `docs/screenshots/crisis.png`: crisis banner and one-click MySafe escalation.

**Demo moment (video):** Open Sunita Patel (HT-0278), who is adherence-dependent. Adherence rescue takes her risk from
64% to 17%. Add MyBreath and sleep and it falls further. Prescribe and show the MyBreath page opening on myzenn.com.

**Speaker notes:** This answers the brief's "how a doctor would interact with this virtual patient" with a working app,
not a mock-up. Use `docs/diagrams/07_clinician_workflow.png` if you want a lane view.

---

## Slide 10. Real time, closed loop, through MyZenn

**Headline:** Live data in, the right nudge out, and the twin keeps learning.

**Bullets:**
- **Three live sources:** WebSocket replay (one hour per tick), webcam heart rate (rPPG, within 3 bpm of the true rate on
  synthetic camera signals; video never leaves the browser), and Bluetooth straps with true HRV.
- **MySentinel tiers:** crisis (≥180/110) → MySafe call; high (≥55%) → doctor alert; elevated (≥30%) → MyZenn nudge.
  Hysteresis and a 12-hour cooldown stop alert fatigue.
- **Learning policy:** a LinUCB bandit, ported from MyZenn's MyCompass, cuts 24 h risk by 16 points on average, against 8.5
  for a random choice and 18 for the best possible choice.
- **Delivered in MyZenn:** MyBreath, MyBody, MyPeace and MyYoga at myzenn.com; the lock screen never shows a diagnosis.

**Visual:** `docs/screenshots/live_monitor.png` with `docs/diagrams/05_mysentinel_decision.png` beside it.

**Demo moment (video):** Live monitor → first suggested moment. Risk climbs and an alert fires while the true BP is still
under 160; the surge arrives hours later. Then turn on the camera and show your own heart rate entering the twin.

---

## Slide 11. Built to be trusted

**Headline:** Privacy, safety and clinical sense are part of the design.

**Three columns:**
- **Privacy:** synthetic training data only; camera video processed on-device, only the number is sent; every live reading
  stored with its source and quality; DPDP-aligned consent and India data residency planned for the pilot.
- **Safety:** monotonic constraints keep the model clinically sensible; crisis readings skip the queue; the doctor decides,
  the twin supports; every action is logged. Not a medical device.
- **Honest limits:** synthetic data only so far; night-time BP uses a population dip; camera HR not yet tested across skin
  tones; single-driver phenotype accuracy 60% (so we show the top two, 84%).

**Visual:** `docs/diagrams/08_privacy_deployment.png`.

**Speaker notes:** Judges trust teams who state limits before being asked.

---

## Slide 12. Impact, roadmap and the ask

**Headline:** From prototype to patients: MyZenn is live today, and HridayTwin is the bridge to cardiometabolic care.

**Impact:**
- A GP sees which hypertensive patients will surge tomorrow, why, and what will stop it.
- Patients get a gentle, specific nudge instead of a generic "reduce stress".
- One container, runs on a laptop; it scales by adding patients, not hardware.

**Roadmap:**
1. Retrain and validate on open data: MIMIC-IV, then open wearable datasets.
2. Pilot with a partner hospital in Kolkata, using ambulatory BP as ground truth.
3. Interoperability: FHIR `RiskAssessment` export and ABDM (ABHA) linkage.
4. Extend the twin to type 2 diabetes with CGM data (the same architecture).

**The ask:** a clinical partner and anonymised cohort access through Happiest Health.

**Footer:** GitHub · demo video · myzenn.com · Team AlphaGo, Jadavpur University.

**Speaker notes:** End on the loop: predict, explain, simulate, act, learn. Thank the jury.
