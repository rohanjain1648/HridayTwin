# HridayTwin: demo video script (about 22 minutes)

Record the slides (docs/HridayTwin_Presentation.pptx) and the live console (http://localhost:8000) side by side.
Upload as an **unlisted** YouTube video and paste the link into the README. Speaker cues are in *italics*.

Before recording: run `python -m uvicorn api.main:app --port 8000`, open the console in Chrome, and have a Bluetooth
heart-rate strap charged (optional; the demo stream works without one).

---

## 1. Opening (0:00–1:30) · slide 1

"Hi, we're team [name] from [college]. This is **HridayTwin**. Hriday means heart. It's a digital twin for hypertension
that predicts a dangerous blood-pressure surge a day before it happens, tells the doctor why, simulates which
intervention would prevent it, and sends the plan to the patient. We built it on MyZenn, our live mental-wellness
platform at myzenn.com, because the thing that's missing in hypertension care is the mind."

## 2. The problem (1:30–4:00) · slide 2

- WHO 2023: 188 million Indian adults with hypertension, and only about 15% controlled.
- Clinic BP is a snapshot every few months. Home cuffs are used irregularly and read in isolation.
- Surges happen on ordinary days: a deadline week, three short nights, a missed refill, a wedding dinner.
- *Pause.* "By the time a doctor sees the number, it has already happened. We wanted to see it coming."

## 3. The insight (4:00–5:30) · slide 3

- Stress lowers HRV and raises resting heart rate over one to two days. Sleep debt accumulates. Missed doses let the
  drug level fall. Salt loads for a day or more.
- All four are visible to a smartwatch, a pillbox and a wellness app **before** the cuff sees them.
- MyZenn already captures the mind layer: mood check-ins, stress, Bluetooth HRV, and tools like MyBreath slow breathing
  that lower sympathetic tone.

## 4. What we built (5:30–7:00) · slide 4

Predict, explain, simulate, act. *Name each in one sentence.* "Everything you'll see in the demo is working code."

## 5. Data and the sandbox rules (7:00–9:30) · slide 5

- Two streams, exactly as the brief asks: a Synthea-style EHR with SNOMED and LOINC codes, lab history and genetic
  markers; and hourly wearable and IoT data.
- "We didn't want random numbers, so we wrote a causal physiology simulator." *Show the formula on slide 7 briefly.*
- 400 patients, 60 days, 576,000 hourly rows, 4,577 surges.
- Key honesty point: the labels come from a hidden ambulatory BP signal that **the model never sees**. It only gets
  what a real clinic gets.

## 6. Architecture (9:30–10:30) · slide 6

Walk left to right: data → fusion feature store → risk engine and mechanistic twin → what-if and MySentinel → API →
console and MyZenn app. Point out the feedback loop from patient outcomes back to the bandit.

## 7. How the twin works (10:30–12:30) · slide 7

- The ML half is accurate: LightGBM on 71 strictly causal features, 36 clinical monotonicity constraints, calibrated.
- The physics half can simulate: a Bayesian model calibrated on *this* patient's own cuff readings gives personal
  sensitivities.
- "When you move a slider, the physiology moves the BP and the ML re-scores the risk. That combination is what makes it a twin
  rather than a dashboard."

## 8. Live demo (12:30–18:30) · console

1. **Roster** (30 s): "100 patients the model never saw in training, ranked by 24-hour surge risk." Point to tier counts
   and phenotype badges.
2. **Crisis patient, Sneha Nair** (45 s): red banner, last home BP 177/113. Click *Escalate via MySafe*. "Lifestyle changes
   barely move her risk; the care plan says so honestly. She needs a call, now."
3. **Sunita Patel, HT-0278** (2 min):
   - Chart: cuff readings flowing into the projected next 24 hours; the band is the uncertainty.
   - Risk dial: about 64%. *Why this risk*: medication adherence and BP history push up.
   - Care plan: *Adherence rescue* ranked first, 64% to 17%. Click *Preview*: the dashed curve appears.
   - What-if: add MyBreath 20 minutes and one hour of sleep. Risk falls to about 6%. Click *Prescribe*.
4. **Twin clock** (1 min): drag back a week, tick *Show actual surges*. "The lower strip is what the model said at each
   point. Watch it rise before these red windows." Return to now.
5. **Live monitor: streaming replay** (1.5 min): open the *Live monitor* tab and click the first suggested moment
   (Sanjay Iyer, stress-driven, 21 h warning). "Each tick is one hour of real sensor data arriving." Point to HRV sliding and
   the stress score rising, then the MySentinel alert with its drivers and recommended protocol. Tick *True ambulatory BP*:
   "the model never sees this line; the alert came first." Click *Prescribe* on the alert.
6. **Live monitor: camera heart rate** (1 min): *Start camera*, keep your forehead in the teal box. After about 10 seconds
   your heart rate appears and flows into the twin; the twin's risk updates. "No wearable, and the video never leaves the
   browser." Mention the Bluetooth strap for true HRV. Click *Stop and restore*: the readings stay in the stored history.
7. **Health record** (30 s): demographics, SNOMED diagnoses, LOINC lab history, genetic markers.

## 9. Results (18:30–20:30) · slides 8–10 or the Model evidence tab

- AUROC 0.92 on held-out patients; 79% of surges flagged in advance, with a median warning of 19 hours; Brier 0.067.
- Fusion ablation: fusion beats the home cuff alone and the clinical rule of thumb; wearables and MyZenn alone reach
  0.78 without any cuff.
- Twin validation: recovers each patient's hidden stress sensitivity with ρ = 0.76.
- MySentinel: the learned policy cuts risk by 16 points versus 8.5 for random.
- *Honesty line:* "Single-driver phenotype accuracy is close to the majority baseline, so we show the top-two drivers.
  We'd rather tell you than have you find it."

## 10. Trust, impact and roadmap (20:30–21:45) · slides 13–14

Privacy by design (synthetic data; only derived scores leave the phone), clinician in the loop, crisis safety net, automated
tests. Roadmap: MIMIC-IV retraining, a Bengaluru hospital pilot with ambulatory BP, the CDSCO software-as-medical-device
pathway, ABDM integration.

## 11. Close (21:45–22:15) · slide 15

"HridayTwin: predict the surge, explain it, simulate the fix, and act before it happens. Thank you."
