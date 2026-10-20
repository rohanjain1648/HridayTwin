import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, Bluetooth, Camera, Github, HeartPulse, Lock, Radio, ShieldCheck, Stethoscope, Wind, Moon, Pill,
} from "lucide-react";
import { Journey } from "./Journey";
import { Dial, M, S, TwinCurve, pct, useTween } from "./visuals";
import { myzennUrl } from "../myzenn";
import "./landing.css";

const REPO = "https://github.com/rohanjain1648/HridayTwin";
const scen = S.scenarios as Record<string, { risk: number; peak: number; curve: number[] }>;

// ── Hero: Sunita's twin, live what-if ────────────────────────────────────────
function HeroTwin() {
  const [breath, setBreath] = useState(false);
  const [sleep, setSleep] = useState(false);
  const [dose, setDose] = useState(false);
  const key = `${+breath}${+sleep}${+dose}`;
  const sc = scen[key];
  const risk = useTween(sc.risk);
  const p = S.patient;
  const toggles: [string, boolean, (v: boolean) => void, typeof Wind][] = [
    ["MyBreath, 20 min", breath, setBreath, Wind],
    ["+1 hour of sleep", sleep, setSleep, Moon],
    ["Every dose taken", dose, setDose, Pill],
  ];
  return (
    <div className="ht-card">
      <div className="ht-head">
        <div className="ht-avatar" aria-hidden>{p.name.split(" ").map(w => w[0]).join("")}</div>
        <div>
          <b>{p.name}, {p.age}</b>
          <span>{p.city}, {p.phenotype.toLowerCase()}</span>
        </div>
        <div className="ht-risk" style={{ color: risk >= 0.55 ? "var(--rose)" : risk >= 0.3 ? "var(--amber)" : "var(--teal)" }}>
          <Dial risk={risk} size={74} />
          <span className="ht-risk-num"><strong>{pct(risk)}</strong><small>surge risk, next 24 h</small></span>
        </div>
      </div>
      <TwinCurve curve={sc.curve} baseline={key === "000" ? undefined : scen["000"].curve} />
      {key !== "000" && <p className="ht-legend"><i /> If nothing changes <i className="teal" /> With the fix</p>}
      <div className="ht-toggles" role="group" aria-label="Try a fix on Sunita's twin">
        {toggles.map(([label, on, set, Icon]) => (
          <button key={label} aria-pressed={on} onClick={() => set(!on)}>
            <Icon size={15} aria-hidden /> {label}
          </button>
        ))}
      </div>
      <p className="ht-foot">
        Projected peak <b>{Math.round(sc.peak)} mmHg</b>. Real output from the trained twin for a held-out synthetic patient.
      </p>
    </div>
  );
}

// ── Early-warning replay: risk rises before the true BP crosses 160 ─────────
function EarlyWarning() {
  const pts = S.replay.points;
  const firstAlert = pts.find(p => p.alert);
  const onset = S.replay.onset_hour;
  const lead = firstAlert ? onset - firstAlert.hour : S.replay.lead_h;
  const st = S.replay.story;
  const w = 640, h = 260, pad = { l: 40, r: 44, t: 18, b: 30 };
  const x0 = pts[0].hour, x1 = pts[pts.length - 1].hour;
  const sx = (hr: number) => pad.l + ((hr - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - (v - 100) / (190 - 100)) * (h - pad.t - pad.b);
  const sr = (r: number) => pad.t + (1 - r) * (h - pad.t - pad.b);
  const bp = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.hour).toFixed(1)},${sy(p.sbp).toFixed(1)}`).join(" ");
  const risk = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.hour).toFixed(1)},${sr(p.risk).toFixed(1)}`).join(" ");
  const area = `${risk} L${sx(x1)},${sr(0)} L${sx(x0)},${sr(0)} Z`;
  return (
    <div className="ew">
      <div className="ew-text">
        <h2>It raised the alarm a day early.</h2>
        <p>
          {S.replay.name} was stable. Then stress built for two days: his HRV fell from {st.hrv_before} to {st.hrv_after} ms, his
          stress score rose from {st.stress_before} to {st.stress_after}, and he slept {st.last_sleep_h} hours the night before.
          He took every dose, and his home cuff stayed under 160. The twin flagged him <b>{lead} hours</b> before his blood
          pressure crossed the line.
        </p>
        <p className="lp-muted">
          A real replay from a held-out synthetic patient. The dotted line is the hidden ambulatory BP the model never sees;
          it is shown only to check the prediction.
        </p>
      </div>
      <figure className="ew-chart">
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img"
             aria-label={`Surge risk rises ${lead} hours before the true blood pressure crosses 160`}>
          {[0.3, 0.55].map(r => (
            <line key={r} x1={pad.l} x2={w - pad.r} y1={sr(r)} y2={sr(r)} stroke="var(--line)" strokeDasharray="3 4" />
          ))}
          <line x1={pad.l} x2={w - pad.r} y1={sy(160)} y2={sy(160)} stroke="var(--rose)" strokeDasharray="5 4" />
          <text x={pad.l + 4} y={sy(160) - 6} className="lp-axis lp-axis-rose">Surge line 160 mmHg</text>
          <path d={area} fill="var(--teal)" opacity={0.14} />
          <path d={risk} fill="none" stroke="var(--teal)" strokeWidth={2.6} />
          <path d={bp} fill="none" stroke="var(--rose)" strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" />
          {firstAlert && (
            <g>
              <line x1={sx(firstAlert.hour)} x2={sx(firstAlert.hour)} y1={pad.t} y2={h - pad.b} stroke="var(--teal)" />
              <rect x={sx(firstAlert.hour) - 34} y={pad.t} width={68} height={22} rx={11} fill="var(--teal)" />
              <text x={sx(firstAlert.hour)} y={pad.t + 15} textAnchor="middle" className="ew-flag">Alert</text>
            </g>
          )}
          <line x1={sx(onset)} x2={sx(onset)} y1={pad.t} y2={h - pad.b} stroke="var(--rose)" />
          <rect x={sx(onset) - 34} y={pad.t} width={68} height={22} rx={11} fill="var(--rose)" />
          <text x={sx(onset)} y={pad.t + 15} textAnchor="middle" className="ew-flag">Surge</text>
          {firstAlert && (
            <g>
              <line x1={sx(firstAlert.hour) + 4} x2={sx(onset) - 4} y1={h - pad.b - 16} y2={h - pad.b - 16} stroke="var(--ink)" markerEnd="url(#arr)" />
              <text x={(sx(firstAlert.hour) + sx(onset)) / 2} y={h - pad.b - 22} textAnchor="middle" className="ew-lead">{lead} h of warning</text>
            </g>
          )}
          <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--ink)" /></marker></defs>
          <text x={pad.l - 8} y={sy(180) + 4} textAnchor="end" className="lp-axis">180</text>
          <text x={pad.l - 8} y={sy(120) + 4} textAnchor="end" className="lp-axis">120</text>
          <text x={w - pad.r + 8} y={sr(1) + 10} className="lp-axis">100%</text>
          <text x={w - pad.r + 8} y={sr(0.55) + 4} className="lp-axis">55%</text>
          <text x={w - pad.r + 8} y={sr(0.3) + 4} className="lp-axis">30%</text>
        </svg>
        <figcaption>
          <span><i style={{ background: "var(--teal)" }} />Twin's 24 h surge risk</span>
          <span><i className="dotted" />True blood pressure (hidden from the model)</span>
        </figcaption>
      </figure>
    </div>
  );
}

// ── Evidence ────────────────────────────────────────────────────────────────
function Evidence() {
  const ab = M.ablation as Record<string, number>;
  const rows: [string, number][] = [
    ["HridayTwin fusion", ab["HridayTwin fusion (EHR + streams)"]],
    ["Home cuff alone", ab["Home cuff only (standard care)"]],
    ["Last-reading rule of thumb", ab["Clinical rule (last home SBP)"]],
    ["Health record alone", ab["EHR only (static)"]],
    ["Wearables + MyZenn alone", ab["Wearables + MyZenn only"]],
  ];
  return (
    <section className="lp-section" id="evidence" aria-labelledby="ev-h">
      <div className="lp-head">
        <h2 id="ev-h">Tested on {M.test_patients} patients it never saw.</h2>
        <p>{M.patients} synthetic patients, {M.days} days each, {M.samples.toLocaleString("en-IN")} predictions. Training and test patients never overlap.</p>
      </div>
      <div className="evg">
        <div className="ev-stat ev-rose"><b>{M.auroc.toFixed(2)}</b><span>AUROC for a surge in the next 24 hours</span></div>
        <div className="ev-stat ev-teal"><b>{Math.round(M.event_recall * 100)}%</b><span>of surges flagged before they happened</span></div>
        <div className="ev-stat ev-butter"><b>{M.median_lead_h} h</b><span>median warning before onset</span></div>
        <div className="ev-stat ev-lav"><b>ρ {M.stress_rho}</b><span>hidden stress sensitivity recovered by the twin</span></div>
        <div className="ev-fusion">
          <h3>Fusing the two streams beats either one</h3>
          {rows.map(([label, v], i) => (
            <div key={label} className={`evf ${i === 0 ? "top" : ""}`}>
              <span>{label}</span>
              <div className="evf-track"><div style={{ width: `${((v - 0.5) / 0.5) * 100}%` }} /></div>
              <b>{v.toFixed(3)}</b>
            </div>
          ))}
          <small>AUROC on held-out patients. The rule of thumb is today's practice: act on the last home reading.</small>
        </div>
      </div>
    </section>
  );
}

// ── MyZenn: which tools the twin uses ───────────────────────────────────────
const TOOLKIT: { title: string; note: string; tone: string; items: [string, string, string][] }[] = [
  { title: "The twin prescribes", note: "Interventions with blood-pressure evidence", tone: "teal", items: [
    ["MyBreath", "Resonance mode: slow breathing at 6 a minute, no breath-holds", "AHA class IIa"],
    ["MyBody + MyPeace", "Body scan and wind-down audio for one more hour of sleep", "Sleep trials"],
    ["MyYoga", "Gentle flows; modest systolic drops in meta-analyses", "Mixed evidence"],
    ["MyResources", "Hypertension lessons: DASH-India swaps, less salt, adherence", "Guideline"],
  ] },
  { title: "The twin listens to", note: "Feeds the dynamic stream", tone: "lav", items: [
    ["MyPulse", "Bluetooth heart rate and true beat-to-beat HRV", "Live"],
    ["Camera heart rate", "rPPG from the webcam, built on MyZenn's camera pipeline", "Live"],
    ["MyWheel check-ins", "Mood and emotion labels become the mood signal", "Live"],
    ["MyGuru", "Onboarding questions add to the static record", "Adapt"],
  ] },
  { title: "Keeps patients safe", note: "The policy layer", tone: "rose", items: [
    ["MySentinel", "Proactive alerts, quiet hours, frequency caps", "Live"],
    ["MyCompass", "The learning bandit, ported to the server", "Live"],
    ["MySafe", "Crisis-range reading → a call, not a nudge", "Live"],
    ["MyOracle", "On-device forecasting: only scores leave the phone", "Design basis"],
  ] },
];
const NOT_USED = ["MyPlay", "MyFlow", "MyOrbit", "MyAnchor", "MyChimes", "MyVR", "MySpaces", "MyParticles", "MyLaughter", "MyStage", "MySenses", "MyBond"];

function Pacer() {
  const [on, setOn] = useState(false);
  const [inhale, setInhale] = useState(true);
  const [breaths, setBreaths] = useState(0);
  useEffect(() => {
    if (!on) return;
    setInhale(true);
    const id = setInterval(() => setInhale(v => { if (!v) setBreaths(b => b + 1); return !v; }), 5000);
    return () => clearInterval(id);
  }, [on]);
  return (
    <div className="pacer">
      <div className={`pacer-orb ${on ? (inhale ? "in" : "out") : ""}`} aria-hidden><span /></div>
      <div className="pacer-text">
        <h3>Try a minute of it</h3>
        <p>Resonance breathing, the hypertension mode we propose for MyBreath: 5 seconds in, 5 seconds out, six breaths a minute.</p>
        <p className="pacer-live" aria-live="polite">{on ? (inhale ? "Breathe in…" : "Breathe out…") : "Ready when you are."}{on && breaths > 0 ? ` ${breaths} of 6` : ""}</p>
        <button className="lp-btn lp-btn-soft" onClick={() => { setOn(v => !v); setBreaths(0); }}>
          <Wind size={16} aria-hidden /> {on ? "Stop" : "Start breathing"}
        </button>
      </div>
    </div>
  );
}

function Toolkit() {
  return (
    <section className="lp-section" id="myzenn" aria-labelledby="mz-h">
      <div className="lp-head">
        <h2 id="mz-h">Built on MyZenn, the mind layer hypertension care is missing.</h2>
        <p>
          MyZenn is a mental-wellness platform with 18 tools. We checked each one against the blood-pressure evidence.
          The twin uses the ones that work for hypertension and leaves the rest to MyZenn.
        </p>
      </div>
      <div className="tk-grid">
        {TOOLKIT.map(g => (
          <div key={g.title} className={`tk-col tk-${g.tone}`}>
            <h3>{g.title}</h3>
            <p className="lp-muted">{g.note}</p>
            <ul>
              {g.items.map(([name, desc, tag]) => (
                <li key={name}>
                  <div>
                    {myzennUrl(name)
                      ? <a className="tk-link" href={myzennUrl(name)!} target="_blank" rel="noreferrer"><b>{name}</b> ↗</a>
                      : <b>{name}</b>}
                    <em>{tag}</em>
                  </div>
                  <span>{desc}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="tk-bottom">
        <Pacer />
        <div className="tk-rest">
          <h3>Not prescribed for blood pressure</h3>
          <p className="lp-muted">Still part of MyZenn for wellbeing; too little BP evidence for a clinical twin to recommend them.</p>
          <div className="tk-tags">{NOT_USED.map(t => <span key={t}>{t}</span>)}</div>
        </div>
      </div>
    </section>
  );
}

// ── Real time + trust ───────────────────────────────────────────────────────
function RealTime() {
  const cards: [typeof Radio, string, string][] = [
    [Radio, "Streaming replay", "A patient's wearable, cuff, pillbox and app data arrive one hour per tick over a WebSocket. The twin re-scores on every tick and raises alerts with hysteresis, so they don't flap."],
    [Camera, "Camera heart rate", "No wearable needed. The webcam reads the pulse from tiny skin-colour changes, within 3 bpm in tests. The video never leaves the browser."],
    [Bluetooth, "Bluetooth strap", "Any standard heart-rate strap or watch pairs through Chrome and streams true beat-to-beat intervals for HRV."],
  ];
  const trust: [typeof Lock, string][] = [
    [Lock, "Synthetic data only, as the DPDP Act and HIPAA require"],
    [Stethoscope, "The twin recommends; the doctor prescribes"],
    [ShieldCheck, "Tested: no future-data leakage, more doses can never raise risk"],
    [HeartPulse, "A research prototype, not a medical device"],
  ];
  return (
    <section className="lp-section" id="realtime" aria-labelledby="rt-h">
      <div className="lp-head">
        <h2 id="rt-h">Real-time data, three ways in.</h2>
        <p>Every live reading is stored with its source and signal quality, and the twin's risk updates within seconds.</p>
      </div>
      <div className="rt-grid">
        {cards.map(([Icon, t, d]) => (
          <div key={t} className="rt-card"><span className="rt-icon"><Icon size={20} aria-hidden /></span><h3>{t}</h3><p>{d}</p></div>
        ))}
      </div>
      <ul className="trust">{trust.map(([Icon, t]) => <li key={t}><Icon size={18} aria-hidden /> {t}</li>)}</ul>
    </section>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [fontPreset, setFontPreset] = useState<"modern" | "clinical" | "tech">(() => {
    return (localStorage.getItem("ht_font_preset") as any) || "modern";
  });
  const journeyRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-font", fontPreset);
    localStorage.setItem("ht_font_preset", fontPreset);
  }, [fontPreset]);

  useEffect(() => {
    document.title = "HridayTwin, a hypertension digital twin";
    // The page renders after load, so the browser can't honour #section links on its own
    if (window.location.hash) {
      const id = window.location.hash.slice(1);
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    }
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <div className="lp">
      <header className={`lp-nav ${scrolled ? "scrolled" : ""}`}>
        <a className="lp-brand" href="/" aria-label="HridayTwin home">
          <span className="lp-mark"><HeartPulse size={18} aria-hidden /></span>HridayTwin
        </a>
        <nav aria-label="Sections">
          <a href="#journey">How it works</a>
          <a href="#evidence">Evidence</a>
          <a href="#myzenn">MyZenn</a>
          <a href="#realtime">Real time</a>
        </nav>
        <div className="lp-font-picker" title="Typography styling" role="radiogroup" aria-label="Font styling preset">
          <button className="lp-font-btn" aria-pressed={fontPreset === "modern"} onClick={() => setFontPreset("modern")} title="Modern (Inter + Plus Jakarta Sans + JetBrains Mono)">Modern</button>
          <button className="lp-font-btn" aria-pressed={fontPreset === "clinical"} onClick={() => setFontPreset("clinical")} title="Clinical (Pure Inter + JetBrains Mono)">Clinical</button>
          <button className="lp-font-btn" aria-pressed={fontPreset === "tech"} onClick={() => setFontPreset("tech")} title="Tech (Outfit + Plus Jakarta Sans + JetBrains Mono)">Tech</button>
        </div>
        <a className="lp-btn lp-btn-glow" href="/console">Open the console</a>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-text">
            <span className="lp-badge"><i />Happiest Health Digital Twin Challenge 2026, hypertension track</span>
            <h1>See the surge coming. <span className="lp-grad">Stop it before it starts.</span></h1>
            <p className="lp-lede">
              HridayTwin is a digital twin of each patient's blood pressure. It fuses the health record with wearable and MyZenn
              data, warns the doctor a day ahead, and tests the fix on the twin before the patient tries it.
            </p>
            <div className="lp-ctas">
              <a className="lp-btn lp-btn-ink" href="/console">Open the clinician console <ArrowRight size={16} aria-hidden /></a>
              <button className="lp-btn lp-btn-soft" onClick={() => journeyRef.current?.scrollIntoView({ behavior: "smooth" })}>
                Follow the journey
              </button>
            </div>
            <dl className="lp-mini">
              <div><dt>{M.auroc.toFixed(2)}</dt><dd>AUROC on {M.test_patients} unseen patients</dd></div>
              <div><dt>{Math.round(M.event_recall * 100)}%</dt><dd>of surges flagged in advance</dd></div>
              <div><dt>{M.median_lead_h} h</dt><dd>median warning</dd></div>
            </dl>
          </div>
          <HeroTwin />
        </section>

        <section className="lp-journey" id="journey" ref={journeyRef} aria-labelledby="jn-h">
          <div className="lp-journey-card">
            <h2 id="jn-h" className="lp-center">From signal to save. <span className="lp-grad">The twin works in three phases.</span></h2>
            <Journey />
          </div>
        </section>

        <section className="lp-section"><EarlyWarning /></section>
        <Evidence />
        <Toolkit />
        <RealTime />

        <section className="lp-cta">
          <h2>Meet the twin.</h2>
          <p>Open the console, pick a patient, and try a fix before anyone takes a pill.</p>
          <div className="lp-ctas center">
            <a className="lp-btn lp-btn-ink" href="/console">Open the clinician console <ArrowRight size={16} aria-hidden /></a>
            <a className="lp-btn lp-btn-soft" href="/console?view=live&autoplay=1">Watch a live replay</a>
            <a className="lp-btn lp-btn-soft" href={REPO} target="_blank" rel="noreferrer"><Github size={16} aria-hidden /> Code on GitHub</a>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <span><span className="lp-mark sm"><HeartPulse size={12} aria-hidden /></span>HridayTwin, built on MyZenn</span>
        <span>Synthetic data only. Not a medical device.</span>
      </footer>
    </div>
  );
}
