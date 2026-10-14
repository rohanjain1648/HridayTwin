import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Brain, ChevronLeft, ChevronRight, FileHeart, Gauge, HeartPulse, Lightbulb, Pause, Play, Repeat, Send,
  SlidersHorizontal, Split, Watch, type LucideIcon,
} from "lucide-react";
import { M, MiniVisual, S, pct } from "./visuals";

type Phase = "sense" | "predict" | "act";
interface Step { n: number; phase: Phase; icon: LucideIcon; title: string; short: string; head: string; body: string; facts: string[]; visual: string }

const scen = S.scenarios as Record<string, { risk: number }>;
const drivers = S.groups.filter(g => g.impact > 0).slice(0, 2).map(g => g.group.toLowerCase());

const STEPS: Step[] = [
  { n: 1, phase: "sense", icon: FileHeart, title: "Health record", short: "Demographics, diagnoses, labs and genes.",
    head: "Who this patient is",
    body: "A Synthea-style record: demographics and lifestyle, SNOMED-CT diagnoses, three points of LOINC lab history, medications, and blood-pressure genes such as AGT M235T and ACE I/D.",
    facts: ["SNOMED-CT", "LOINC", "4 BP genes + polygenic score"], visual: "ehr" },
  { n: 2, phase: "sense", icon: Watch, title: "Wearables & devices", short: "Heart rate, HRV, sleep, steps, cuff, pillbox.",
    head: "How the body is doing, every hour",
    body: "A smartwatch streams heart rate, HRV, sleep stages and steps. A home cuff adds morning and evening readings, and a smart pillbox logs each dose. Sunita's pillbox shows no doses taken this week.",
    facts: ["Hourly", "Home cuff twice a day", "Smart pillbox"], visual: "wearable" },
  { n: 3, phase: "sense", icon: Brain, title: "Mind layer", short: "Stress, mood and breathing from MyZenn.",
    head: "What a cuff can't see",
    body: "MyZenn adds the triggers: mood check-ins, a stress score from HRV, logged salty meals and every MyBreath session. Stress usually builds for a day or two before the pressure rises. That gap is the early warning.",
    facts: ["Mood check-ins", "Stress from HRV", "Diet log"], visual: "mind" },
  { n: 4, phase: "predict", icon: HeartPulse, title: "Personal twin", short: "Learns how this body responds.",
    head: "How this body responds",
    body: `A physiology model is fitted to the patient's own cuff readings, so it knows how many mmHg this person gains per unit of stress, per hour of lost sleep, per missed dose and per gram of salt. On the test cohort it recovers hidden stress sensitivity with ρ = ${M.stress_rho}.`,
    facts: ["Bayesian calibration", `ρ = ${M.stress_rho}`, "Phenotype"], visual: "twin" },
  { n: 5, phase: "predict", icon: Gauge, title: "Forecast", short: "Surge risk for the next 24 hours.",
    head: "The next 24 hours",
    body: `Every 6 hours, ${M.features} strictly causal features feed a calibrated LightGBM model bound by 36 clinical rules. Out comes the chance of a sustained surge above 160/100 in the next day, plus a projected BP curve. Sunita: ${pct(S.risk)}.`,
    facts: [`AUROC ${M.auroc}`, "Every 6 h", "36 clinical rules"], visual: "forecast" },
  { n: 6, phase: "act", icon: Lightbulb, title: "Explain", short: "Why risk is high today.",
    head: "Why today",
    body: `TreeSHAP turns the forecast into reasons a doctor can check, ranked by how hard each one pushes. For Sunita, ${drivers.join(" and ")} lead.`,
    facts: ["TreeSHAP", "Driver groups", "Personal sensitivities"], visual: "explain" },
  { n: 7, phase: "act", icon: SlidersHorizontal, title: "Simulate", short: "Try the fix on the twin first.",
    head: "Try the fix on the twin first",
    body: `Add MyBreath minutes, an extra hour of sleep or full adherence. The physiology moves the BP, then the model re-scores the risk. Every dose alone takes Sunita from ${pct(scen["000"].risk)} to ${pct(scen["001"].risk)}; add MyBreath and sleep and it falls to ${pct(scen["111"].risk)}.`,
    facts: ["Hybrid counterfactual", "5 interventions", "Live in the console"], visual: "simulate" },
  { n: 8, phase: "act", icon: Send, title: "Prescribe", short: "Straight to the patient's MyZenn app.",
    head: "Straight to the patient's phone",
    body: "MySentinel sends the chosen protocol to the MyZenn app, timed for the evening before the predicted surge. The lock screen only says a moment of calm is waiting, never a diagnosis.",
    facts: ["MySentinel", "MyBreath, MyBody, MyYoga", "MySafe for crises"], visual: "prescribe" },
  { n: 9, phase: "act", icon: Repeat, title: "Learn", short: "Every outcome sharpens the next choice.",
    head: "Better with every outcome",
    body: `A contextual bandit, ported from MyZenn's MyCompass, learns which intervention works in which situation. Pre-trained on 1,500 twin cases, it cuts risk by ${M.bandit} points, against ${M.random} for a random choice.`,
    facts: ["LinUCB", "From MyCompass", "Learns per patient"], visual: "learn" },
];

const DECISION = {
  head: "Is a surge likely in the next 24 hours?",
  body: "Above 30% risk the twin moves to act. Below it, the twin keeps watching and re-scores every 6 hours. A crisis-range reading (180/110) skips the queue and triggers a MySafe call.",
};

const PHASES: { id: Phase; label: string; first: number }[] = [
  { id: "sense", label: "Phase 1 · Sense", first: 0 },
  { id: "predict", label: "Phase 2 · Predict", first: 3 },
  { id: "act", label: "Phase 3 · Act", first: 5 },
];

// Positions along the path: steps 1–5, the decision, then steps 6–9.
const ORDER: (number | "d")[] = [0, 1, 2, 3, 4, "d", 5, 6, 7, 8];
const DPOS = 5;
const phaseOf = (pos: number): Phase => (pos === DPOS ? "predict" : STEPS[ORDER[pos] as number].phase);
const PHASE_COLOR: Record<Phase, string> = { sense: "var(--rose)", predict: "var(--teal)", act: "var(--amber)" };

interface Pt { x: number; y: number; rx: number; ry: number }

export function Journey() {
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [answer, setAnswer] = useState<"yes" | "no">("yes");
  const [geo, setGeo] = useState<{ w: number; h: number; pts: Pt[] } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<(HTMLElement | null)[]>([]);
  const sectionRef = useRef<HTMLDivElement>(null);
  const userPaused = useRef(false);

  const maxPos = answer === "no" ? DPOS : ORDER.length - 1;
  const go = useCallback((p: number) => setPos(Math.max(0, Math.min(maxPos, p))), [maxPos]);

  // Measure node centres so the connecting path follows the real layout at any width.
  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const wr = wrap.getBoundingClientRect();
      const pts = dotRefs.current.map(el => {
        const r = el!.getBoundingClientRect();
        return { x: r.left - wr.left + r.width / 2, y: r.top - wr.top + r.height / 2, rx: r.width / 2, ry: r.height / 2 };
      });
      setGeo({ w: wr.width, h: wr.height, pts });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Start playing once the journey scrolls into view (never for reduced-motion users).
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !sectionRef.current) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !userPaused.current) setPlaying(true);
      if (!e.isIntersecting) setPlaying(false);
    }, { threshold: 0.35 });
    io.observe(sectionRef.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setPos(p => (p >= maxPos ? 0 : p + 1)), pos === DPOS ? 3200 : 4600);
    return () => clearTimeout(t);
  }, [playing, pos, maxPos]);

  const pick = (p: number) => { userPaused.current = true; setPlaying(false); go(p); };
  const toggle = () => { userPaused.current = !playing ? false : true; setPlaying(v => !v); };
  const choose = (a: "yes" | "no") => {
    setAnswer(a);
    userPaused.current = true;
    setPlaying(false);
    setPos(DPOS);
  };

  const stateOf = (p: number) => {
    if (answer === "no" && p > DPOS) return "off";
    return p < pos ? "done" : p === pos ? "active" : "future";
  };

  // ── connecting path ──────────────────────────────────────────────────────
  const segs: { d: string; done: boolean; color: string; key: string }[] = [];
  let loop = "";
  if (geo) {
    const P = geo.pts;
    for (let k = 0; k < ORDER.length - 1; k++) {
      const a = P[k], b = P[k + 1];
      let d: string;
      if (k === DPOS) {
        // U-turn from the decision, down the right edge, back along the gap, into step 6
        const R = 26, xR = geo.w - 6, ymid = b.y - b.ry - 40;
        d = `M${a.x + a.rx},${a.y} H${xR - R} A${R},${R} 0 0 1 ${xR},${a.y + R} V${ymid - R} A${R},${R} 0 0 1 ${xR - R},${ymid}`
          + ` H${b.x + R} A${R},${R} 0 0 0 ${b.x},${ymid + R} V${b.y - b.ry}`;
      } else {
        d = `M${a.x + a.rx},${a.y} H${b.x - b.rx}`;
      }
      const off = answer === "no" && k >= DPOS;
      segs.push({ d, done: !off && pos > k, color: PHASE_COLOR[phaseOf(k + 1)], key: `s${k}` });
    }
    if (answer === "no") {
      const d = P[DPOS], s = P[0], top = s.y - s.ry - 46, R = 22;
      loop = `M${d.x},${d.y - d.ry} V${top + R} A${R},${R} 0 0 0 ${d.x - R},${top} H${s.x + R} A${R},${R} 0 0 0 ${s.x},${top + R} V${s.y - s.ry}`;
    }
  }

  const isDecision = pos === DPOS;
  const step = isDecision ? null : STEPS[ORDER[pos] as number];
  const phase = phaseOf(pos);
  const stepNo = isDecision ? null : (ORDER[pos] as number) + 1;

  const renderNode = (p: number) => {
    const o = ORDER[p];
    const st = stateOf(p);
    if (o === "d") {
      return (
        <div key="d" className={`jn-col jn-decision is-${st}`}>
          <div className="jn-dotarea">
            <div className="jn-dcard" ref={el => (dotRefs.current[p] = el)}>
              <Split size={18} aria-hidden />
              <b>Surge likely?</b>
              <div className="jn-yesno" role="group" aria-label="Is a surge likely in the next 24 hours?">
                <button aria-pressed={answer === "yes"} onClick={() => choose("yes")}>Yes</button>
                <button aria-pressed={answer === "no"} onClick={() => choose("no")}>No</button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    const s = STEPS[o];
    const Icon = s.icon;
    return (
      <div key={s.n} className={`jn-col is-${st} ph-${s.phase}`}>
        <div className="jn-dotarea">
          <button className="jn-dot" ref={el => (dotRefs.current[p] = el)} onClick={() => pick(p)}
                  aria-current={st === "active" ? "step" : undefined} aria-label={`Step ${s.n}: ${s.title}`}
                  disabled={st === "off"}>
            <span className="jn-badge">{s.n}</span>
            <Icon size={26} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
        <h3>{s.title}</h3>
        <p>{s.short}</p>
      </div>
    );
  };

  return (
    <div className="jn" ref={sectionRef}>
      <div className="jn-phases" role="group" aria-label="Phases">
        {PHASES.map(ph => (
          <button key={ph.id} className={`jn-pill pill-${ph.id}`} aria-pressed={phase === ph.id}
                  disabled={answer === "no" && ph.id === "act"}
                  onClick={() => pick(ORDER.indexOf(ph.first))}>{ph.label}</button>
        ))}
      </div>

      <div className="jn-map" ref={wrapRef}>
        {geo && (
          <svg className="jn-svg" width={geo.w} height={geo.h} aria-hidden>
            {segs.map((s, k) => (
              <g key={s.key}>
                <path d={s.d} className="jn-seg-future" />
                {s.done && <path d={s.d} pathLength={1} className={`jn-seg-done ${k === pos - 1 ? "just" : ""}`} style={{ stroke: s.color }} />}
              </g>
            ))}
            {loop && <path d={loop} className="jn-loop" />}
            {pos > 0 && segs[pos - 1] && (
              <circle key={`head${pos}`} r={7} className="jn-head" style={{ fill: segs[pos - 1].color }}>
                <animateMotion dur="0.9s" fill="freeze" path={segs[pos - 1].d} />
              </circle>
            )}
          </svg>
        )}
        <div className="jn-row jn-row1">{[0, 1, 2, 3, 4, 5].map(renderNode)}</div>
        <div className="jn-row jn-row2">{[6, 7, 8, 9].map(renderNode)}</div>
        {answer === "no" && <p className="jn-loopnote">No: the twin keeps watching and re-scores every 6 hours.</p>}
      </div>

      <div className={`jn-panel ph-${phase}`} aria-live="polite">
        <div className="jn-panel-text">
          <div className="jn-kicker">
            {isDecision ? "The decision" : `Step ${stepNo} of 9`}<span aria-hidden> · </span>
            {phase === "sense" ? "Sense" : phase === "predict" ? "Predict" : "Act"}
          </div>
          <h3>{isDecision ? DECISION.head : step!.head}</h3>
          <p>{isDecision ? DECISION.body : step!.body}</p>
          {!isDecision && <div className="jn-facts">{step!.facts.map(f => <span key={f}>{f}</span>)}</div>}
          <div className="jn-controls">
            <button className="jn-arrow" onClick={() => pick(pos - 1)} disabled={pos === 0} aria-label="Previous step"><ChevronLeft size={18} /></button>
            <button className={`jn-play ${playing ? "on" : ""}`} onClick={toggle}>
              {playing ? <><Pause size={14} aria-hidden /> Playing…</> : <><Play size={14} aria-hidden /> Play the journey</>}
            </button>
            <button className="jn-arrow" onClick={() => pick(pos + 1)} disabled={pos === maxPos} aria-label="Next step"><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="jn-panel-visual" key={pos}>
          <MiniVisual kind={isDecision ? "decision" : step!.visual} />
        </div>
      </div>
    </div>
  );
}
