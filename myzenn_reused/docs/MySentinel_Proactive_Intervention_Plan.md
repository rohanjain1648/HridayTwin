# MySentinel — Proactive Intervention Engine

> **"The AI that reaches out first."**
> Headspace waits for you to open the app. MyZenn comes to you — before you break down.

**Status**: Plan only — no code changes yet
**Author**: MyZenn Engineering
**Date**: June 2026

---

## 1. The Problem (Current Gap)

MyOracle (2-layer LSTM, in-browser) already predicts mood 24/48/72 hours ahead. But today:

| Today | The Gap |
|---|---|
| `checkAndNotify()` fires a **sonner toast** | Only visible **while the app is open** |
| `useReminders` uses basic `Notification` API | No service worker → dies when tab closes |
| Predictions stored in `localStorage` | Server never knows a dip is coming |
| No scheduling, no channels, no learning | One-shot toast, fixed threshold, no feedback |

**A prediction that nobody sees is worthless.** The entire moat — predicting a dip 72h ahead — currently evaporates the moment the user closes the tab.

---

## 2. The Vision

When MyOracle predicts a mood dip, **MySentinel** (a new server-side agent) autonomously:

1. **Evaluates** the forecast against an intervention policy (severity, confidence, user prefs, quiet hours, frequency caps)
2. **Selects** the best wellness tool for THIS user (reusing MyCompass RL arm statistics)
3. **Times** the outreach optimally (evening before a predicted dip, never at 3am)
4. **Chooses** the best channel (Web Push → WhatsApp → Email)
5. **Reaches out**: *"Tomorrow evening looks heavy 🌧️ — want to schedule a MyPeace session at 6pm?"*
6. **Learns** from the outcome (opened? acted? mood improved?) via a server-side contextual bandit — getting better at when/how/what to send for each individual user

This is a **7th autonomous agent** in the MyZenn agentic architecture — the pitch-deck headline writes itself.

---

## 3. User Experience Flows

### Flow A — The Core Loop (happy path)
```
Mon 9pm   User chats with MyPal, logs mood. MyOracle retrains in-browser,
          predicts Wed-evening score: 3.2/10 (dip). Forecast snapshot synced
          to server (scores only — no raw data).

Tue 7pm   MySentinel policy fires. Web Push arrives:
          "🌿 MyZenn: Tomorrow evening might feel heavy.
           Want to schedule 10 minutes of MyPeace at 6pm?"
          [Schedule 6pm]  [Do it now]  [Not today]

Wed 5:50pm Reminder push: "Your MyPeace session starts in 10 min 🧘"

Wed 6pm   User taps → deep link → /intervention/:id → pre-mood check →
          MyPeace session → post-mood check.

Wed 6:15pm Outcome logged: acted=true, mood 4→6. Reward +1.1 flows to
          MySentinel bandit AND MyCompass arm stats. Wed dip: averted.
```

### Flow B — Severity tiers
| Predicted score | Tier | Behavior |
|---|---|---|
| < 2.5 | **High** | Notify within 4–6h, supportive check-in tone, surface MySafetyNet plan + helplines. Never marketing-y. |
| 2.5 – 4.0 | **Medium** | Evening-before nudge with tool suggestion + scheduling CTA (the core flow) |
| 4.0 – 5.5 declining trend | **Low** | Folded into MyDigest weekly summary; no push |
| ≥ 5.5 | None | Optionally a positive reinforcement ("forecast looks bright ☀️") max 1×/week |

### Flow C — Consent & onboarding
First time MyOracle produces a dip prediction while user is in-app:
> *"MyOracle noticed a pattern. Want MyZenn to check in on you proactively — even when the app is closed? You control the channels, times, and frequency."*
→ Opt-in screen: channels (Push / WhatsApp / Email), quiet hours (default 22:00–08:00), max nudges/week (default 3). Stored server-side in `intervention_prefs`.

---

## 4. System Architecture

```
┌──────────────────────── USER DEVICE (browser/PWA) ────────────────────────┐
│                                                                            │
│  MyOracle LSTM (TF.js, in-browser)        Service Worker (NEW)             │
│  ├─ trains on local mood time-series      ├─ receives Web Push             │
│  ├─ predicts 24/48/72h scores             ├─ shows notification            │
│  └─ Forecast Sync Module (NEW) ──┐        └─ deep-link click handler       │
│                                  │                                         │
│  Pre/Post mood check (NEW)       │   Privacy boundary: ONLY derived        │
│  Intervention landing page (NEW) │   scores cross this line — never        │
│                                  │   raw journal/chat/mood data            │
└──────────────────────────────────┼─────────────────────────────────────────┘
                                   ▼ POST /api/oracle/forecast (JWT)
┌─────────────────── RELAY SERVER (Node.js · HF Spaces) ────────────────────┐
│                                                                            │
│  Forecast Ingest API ──► Supabase                                          │
│                                                                            │
│  MySentinel Agent (NEW)  ◄── node-cron every 15 min                        │
│  ├─ Policy Engine: severity tiers · confidence gate · quiet hours ·        │
│  │   frequency caps (3/wk) · cooldown (24h) · suppress-if-active-today     │
│  ├─ Tool Selector: per-user MyCompass arm summary, fallback map            │
│  │   (score<4→MyPeace, 4–6→MyBreath, else→MyParticles)                     │
│  ├─ Channel Bandit (LinUCB, server-side): {push, whatsapp, email}          │
│  │   × {send hour} × {template} — learns per user                          │
│  └─ Dispatcher ──► Web Push (VAPID) │ WhatsApp Cloud API │ Email           │
│                                                                            │
│  Outcome API: /api/intervention/:id/{opened|acted|dismissed} ──► rewards   │
└────────────────────────────────────────────────────────────────────────────┘
                                   ▲▼
┌──────────────────────── SUPABASE (GCP Mumbai) ─────────────────────────────┐
│  oracle_forecasts · intervention_prefs · push_subscriptions ·              │
│  interventions · intervention_outcomes        (all RLS-protected)          │
└────────────────────────────────────────────────────────────────────────────┘
```

**Why hybrid edge-cloud?** The LSTM must stay on-device (privacy moat + zero inference cost), but notifications must fire when the app is closed (server). The bridge is a tiny forecast snapshot — 3 floats + confidence + timezone — synced whenever the user is active. Raw mood/journal/chat data never leaves the device, preserving the DPDP story.

---

## 5. Data Model (Supabase, all RLS)

```sql
-- Synced from device after each in-browser prediction run
oracle_forecasts (
  id uuid PK, user_id uuid FK,
  score_24h float, score_48h float, score_72h float,
  confidence float, model_version text,
  tz text, locale text, created_at timestamptz
)

intervention_prefs (
  user_id uuid PK,
  push_enabled bool, whatsapp_enabled bool, email_enabled bool,
  whatsapp_number text NULL,           -- E.164, verified via OTP
  quiet_start time DEFAULT '22:00', quiet_end time DEFAULT '08:00',
  max_per_week int DEFAULT 3,
  consented_at timestamptz, locale text
)

push_subscriptions (
  id uuid PK, user_id uuid FK,
  endpoint text, p256dh text, auth text,
  user_agent text, created_at timestamptz
)

interventions (
  id uuid PK, user_id uuid FK, forecast_id uuid FK,
  severity text,                        -- high | medium | low
  tool_suggested text,                  -- e.g. 'mypeace'
  channel text,                         -- push | whatsapp | email
  template_id text, send_hour int,
  scheduled_for timestamptz,            -- when notification fires
  session_scheduled_for timestamptz NULL, -- user-chosen session slot
  status text,  -- scheduled|sent|opened|acted|dismissed|expired|suppressed
  sent_at timestamptz NULL
)

intervention_outcomes (
  intervention_id uuid PK FK,
  opened bool, acted bool, dismissed bool,
  mood_before float NULL, mood_after float NULL,
  reward float,                         -- computed, feeds bandit
  recorded_at timestamptz
)
```

---

## 6. MySentinel Policy Engine (decision logic)

Runs every 15 min via `node-cron` on the existing relay server (no new infra).

```
for each fresh forecast (last 24h, latest per user):
  1. GATE      confidence ≥ 0.5 AND min(score_24h..72h) < 4.0
  2. CONSENT   user has intervention_prefs.consented_at AND ≥1 channel enabled
  3. CAPS      sent_this_week < max_per_week AND last_sent > 24h ago
  4. ACTIVITY  skip if user had a session today (they're already engaged)
  5. SEVERITY  classify tier (see Flow B) → choose template family + urgency
  6. TIMING    target = evening before predicted dip (default 19:00 local),
               clamped outside quiet hours; high-tier → within 4–6h
  7. TOOL      per-user MyCompass top-arm summary if synced, else fallback map
  8. CHANNEL   LinUCB bandit pick over enabled channels × hour bucket
  9. WRITE     interventions row (status=scheduled)
DISPATCH loop: send all due rows, mark sent, handle channel failures
              (push fails → fallback to next enabled channel once)
```

**Reward function** (feeds the bandit after each intervention resolves):
```
opened        +0.3
acted         +0.7
mood_delta    +(after−before)/9        (bonus, when session completed)
ignored 48h    0.0
dismissed     −0.3
opt-down/out  −1.0   (and immediately widen caps / pause)
```

---

## 7. Channels

| Channel | Phase | Cost | Notes |
|---|---|---|---|
| **Web Push** (VAPID + service worker) | 1 | **Free** | Works app-closed on Android/desktop; iOS ≥16.4 requires PWA install. Add via `vite-plugin-pwa`. |
| **WhatsApp Cloud API** (Meta) | 3 | ~₹0.78/marketing msg; utility msgs in 24h window cheaper | THE channel for India. Requires approved message templates (submit in all supported languages) + business verification. Opt-in with OTP-verified number. |
| **Email** (Resend / Supabase SMTP) | 3 | ~Free at this scale | Fallback + weekly MyDigest carrier. |

**Lock-screen privacy rule**: notification text is always generic-supportive — *"A moment of calm is waiting 🌿"* — never *"your depression score will spike."* Mental-health content on a visible lock screen is a privacy harm and a DPDP/FTC risk.

---

## 8. The Learning Loop (what makes this agentic)

Two bandits, two layers:

1. **MyCompass (existing, on-device)** keeps learning *which tool* helps this user. MySentinel receives a periodic tiny summary (top-3 arms + scores) via the forecast sync payload — no architecture change to MyCompass.
2. **MySentinel bandit (new, server-side)** learns *when, how, and what to say*: context = {severity, day-of-week, hour bucket, channel, template family}; arms = channel × hour × template. Same LinUCB + Thompson Sampling math already proven in `useCompassRL.ts` — ported to the relay server.

Result: after ~10–15 interventions per user, MySentinel knows that *this* user responds to WhatsApp at 8pm with a gentle tone, while *that* user prefers push at lunchtime with a direct CTA. **No two users get the same Sentinel.**

---

## 9. Safety & Crisis Guardrails

- **High-severity tier never sells** — supportive check-in language only, MySafetyNet plan + helplines (iCall, Vandrevala, AASRA) one tap away.
- If recent on-device crisis flags were raised (MentalZen-BERT crisis head), MySentinel **suppresses gamified/cheerful templates** entirely for 7 days.
- Every notification footer: "MyZenn is an AI wellness companion, not a medical service."
- One-tap mute: "Pause check-ins for 2 weeks" — honored instantly, logged as strong negative reward.
- Hard ceiling regardless of bandit: never >1 proactive notification per 24h, never >max_per_week.

## 10. Privacy & Compliance (DPDP)

- Explicit, granular, revocable consent before any server-side scheduling.
- Only derived scores cross the device boundary; raw inputs stay in IndexedDB/localStorage.
- All new tables RLS-protected; cascade-delete with account deletion.
- WhatsApp numbers stored encrypted; OTP verification before first message.
- Data residency unchanged: Supabase GCP Mumbai.

---

## 11. Phased Rollout

| Phase | Scope | Effort |
|---|---|---|
| **1 — Push MVP** | Service worker + VAPID push, forecast sync API, 2 Supabase tables (`oracle_forecasts`, `push_subscriptions`), fixed rule (score<4 → push at 19:00), deep link to suggested tool | ~1–2 wks |
| **2 — Policy + Scheduling** | Full `interventions`/`prefs`/`outcomes` schema, policy engine with tiers/caps/quiet-hours, "schedule for 6pm" session flow, pre/post mood check, outcome logging | ~2 wks |
| **3 — WhatsApp + i18n** | Meta business verification, template approval (24 languages), OTP opt-in, channel fallback chain, email fallback | ~2 wks (verification lead time dominates — start paperwork in Phase 1) |
| **4 — Sentinel learns** | Server-side LinUCB over channel×hour×template, MyCompass arm-summary sync, metrics dashboard, A/B harness | ~2 wks |

## 12. Success Metrics

| Metric | Target |
|---|---|
| Opt-in rate (shown → consented) | ≥ 40% |
| Notification → open (CTR) | ≥ 25% |
| Open → completed session | ≥ 50% |
| **Dip-aversion rate** (predicted dip where actual mood ≥ predicted +1.5 after intervention) | ≥ 30% |
| D30 retention lift (intervention cohort vs control) | ≥ +15% |
| Opt-out / mute rate | < 5% |

The **dip-aversion rate** is the headline investor metric: *"MyZenn predicted 1,000 bad days and prevented 300 of them."* No meditation app on earth can make that claim.

## 13. Cost Estimate (10K MAU)

- Web Push: ₹0
- Relay server cron: ₹0 (existing HF Space)
- Supabase: within free/Pro tier
- WhatsApp: ~3 msgs/user/month × 30% opt-in ≈ 9K msgs ≈ **₹7K/month**
- **Total: < ₹10K/month at 10K MAU** — near-zero marginal cost for the single most differentiating feature in the product.

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Notification fatigue → uninstalls | Hard caps, bandit penalizes dismissals heavily, one-tap pause |
| iOS Safari push limits | Requires PWA install — add "Add to Home Screen" nudge; WhatsApp covers iOS gap in India |
| LSTM false positives (cold start <14 data points) | Confidence gate + min-data gate; low-confidence → digest-only, never push |
| WhatsApp template rejection | Submit utility-style templates (appointment-reminder category), not marketing |
| Forecast staleness (user inactive 5 days → no fresh sync) | Policy expires forecasts >72h old; re-engagement handled by a separate gentle "we miss you" track, capped at 1/month |
