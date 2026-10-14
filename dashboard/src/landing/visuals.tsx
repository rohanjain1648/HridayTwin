import { useEffect, useRef, useState } from "react";
import snap from "./snapshot.json";

export const S = snap;
export const M = snap.metrics;
export const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Animates a number towards its target (user-triggered motion only). */
export function useTween(target: number, ms = 600) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      setV(a + (target - a) * e);
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target, ms]);
  return v;
}

/** Catmull-Rom spline through the points, as cubic Béziers: softens corners, keeps every point. */
function smooth(p: [number, number][]) {
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[Math.max(0, i - 1)], b = p[i], c = p[i + 1], e = p[Math.min(p.length - 1, i + 2)];
    const c1 = [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6], c2 = [c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${c[0].toFixed(1)},${c[1].toFixed(1)}`;
  }
  return d;
}

const tierColor = (r: number) => (r >= 0.55 ? "var(--rose)" : r >= 0.3 ? "var(--amber)" : "var(--teal)");

/** Semicircular risk dial. */
export function Dial({ risk, size = 150 }: { risk: number; size?: number }) {
  const r = size * 0.38, cx = size / 2, cy = size * 0.56;
  const a = Math.PI * (1 - Math.min(Math.max(risk, 0), 1));
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  return (
    <svg width={size} height={size * 0.66} viewBox={`0 0 ${size} ${size * 0.66}`} aria-hidden>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--rose-soft)" strokeWidth={12} strokeLinecap="round" />
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x} ${y}`} fill="none" stroke={tierColor(risk)} strokeWidth={12} strokeLinecap="round"
            style={{ transition: "d .6s ease, stroke .6s" }} />
    </svg>
  );
}

// ── Twin curve: last 3 days of home-cuff readings → projected next 24 h ──────
const NOW = S.now_hour;
const X0 = NOW - 48, X1 = NOW + 24, Y0 = 105, Y1 = 190;

export function TwinCurve({ curve, baseline, w = 520, h = 230 }: { curve: number[]; baseline?: number[]; w?: number; h?: number }) {
  const pad = { l: 34, r: 12, t: 14, b: 26 };
  const sx = (hr: number) => pad.l + ((hr - X0) / (X1 - X0)) * (w - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - (v - Y0) / (Y1 - Y0)) * (h - pad.t - pad.b);
  const proj = S.projection;
  const line = smooth(curve.map((v, i) => [sx(proj[i].hour + 0.5), sy(v)] as [number, number]));
  const band = proj.map((p, i) => `${i ? "L" : "M"}${sx(p.hour + 0.5).toFixed(1)},${sy(p.hi).toFixed(1)}`).join(" ")
    + " " + [...proj].reverse().map(p => `L${sx(p.hour + 0.5).toFixed(1)},${sy(p.lo).toFixed(1)}`).join(" ") + " Z";
  const cuff = S.cuff.filter(c => c.hour >= X0);
  const days = [0, 1, 2].map(d => X0 + d * 24);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img"
         aria-label="Home blood pressure readings for the last three days, then the twin's projection for the next 24 hours">
      <rect x={sx(NOW)} y={pad.t} width={sx(X1) - sx(NOW)} height={h - pad.t - pad.b} fill="var(--teal-soft)" opacity={0.55} rx={8} />
      {[120, 140, 160, 180].map(v => (
        <g key={v}>
          <line x1={pad.l} x2={w - pad.r} y1={sy(v)} y2={sy(v)} stroke={v === 160 ? "var(--rose)" : "var(--line)"}
                strokeDasharray={v === 160 ? "5 4" : undefined} strokeWidth={v === 160 ? 1.4 : 1} />
          <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end" className="lp-axis">{v}</text>
        </g>
      ))}
      {days.map((d, i) => (
        <text key={d} x={sx(d) + 4} y={h - 8} className="lp-axis">{["2 days ago", "Yesterday", "Now"][i]}</text>
      ))}
      <text x={sx(X1) - 4} y={h - 8} textAnchor="end" className="lp-axis">+24 h</text>
      {w >= 400 && <text x={pad.l + 4} y={sy(160) - 6} className="lp-axis lp-axis-rose">Surge line 160</text>}
      {!baseline && <path d={band} fill="var(--teal)" opacity={0.13} />}
      {baseline && (
        <path d={smooth(baseline.map((v, i) => [sx(proj[i].hour + 0.5), sy(v)] as [number, number]))} fill="none"
              stroke="var(--rose)" strokeWidth={2} strokeDasharray="4 5" opacity={0.7} />
      )}
      <path d={line} fill="none" stroke="var(--teal)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
            className="lp-curve" />
      <line x1={sx(NOW)} x2={sx(NOW)} y1={pad.t} y2={h - pad.b} stroke="var(--ink)" strokeWidth={1.2} />
      {cuff.map((c, i) => <circle key={i} cx={sx(c.hour)} cy={sy(c.sbp)} r={4.5} fill="var(--ink)" />)}
    </svg>
  );
}

// ── Mini visuals for the journey's detail panel ─────────────────────────────
function Bars({ rows, max, unit }: { rows: { label: string; value: number; tone?: string }[]; max: number; unit?: string }) {
  return (
    <div className="mv-bars">
      {rows.map(r => (
        <div key={r.label} className="mv-bar">
          <span>{r.label}</span>
          <div className="mv-track"><div style={{ width: `${Math.min(100, (Math.abs(r.value) / max) * 100)}%`, background: r.tone ?? "var(--teal)" }} /></div>
          <b>{r.value > 0 && unit !== "%" ? "+" : ""}{r.value}{unit ?? ""}</b>
        </div>
      ))}
    </div>
  );
}

function Spark({ points, color, w = 260, h = 46 }: { points: number[]; color: string; w?: number; h?: number }) {
  const lo = Math.min(...points), hi = Math.max(...points);
  const d = points.map((v, i) => `${i ? "L" : "M"}${(i / (points.length - 1)) * w},${h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8)}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden><path d={d} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" /></svg>;
}

const avg = (a: number[]) => Math.round(a.reduce((s, v) => s + v, 0) / a.length);

export function MiniVisual({ kind }: { kind: string }) {
  const sens = S.sensitivities as Record<string, number>;
  const ser = S.series;
  const snapRow = S.snapshot as Record<string, number | null>;
  switch (kind) {
    case "ehr":
      return (
        <div className="mv-records">
          {S.records.map(([a, b]) => (
            <div key={a} className="mv-rec"><span>{a}</span><code>{b}</code></div>
          ))}
        </div>
      );
    case "wearable": {
      const hrvChange = snapRow.hrv_24h_vs_7d_pct ?? 0;
      return (
        <div className="mv-stack">
          <div className="mv-label"><span>Heart rate, last 3 days</span><b style={{ color: "var(--rose)" }}>avg {avg(ser.hr)} bpm</b></div>
          <Spark points={ser.hr} color="var(--rose)" />
          <div className="mv-label"><span>HRV (RMSSD)</span><b style={{ color: "var(--teal)" }}>{hrvChange > 0 ? "+" : ""}{Math.round(hrvChange)}% vs 7 days</b></div>
          <Spark points={ser.hrv} color="var(--teal)" />
          <div className="mv-chips">
            <span className="chip-rose">Smart pillbox: {snapRow.doses_last_7d ?? 0} of 7 doses this week</span>
          </div>
        </div>
      );
    }
    case "mind":
      return (
        <div className="mv-stack">
          <div className="mv-label"><span>MyZenn mood check-ins</span><b>{ser.mood[0]} → {ser.mood[ser.mood.length - 1]}</b></div>
          <div className="mv-dots">{ser.mood.map((v, i) => <span key={i} style={{ height: v * 9 }} />)}</div>
          <div className="mv-chips">
            <span className="chip-lav">Stress score {Math.round(snapRow.stress_mean_24h ?? 0)}</span>
            <span className="chip-butter">{ser.salt_days} salty meal logged</span>
            <span className="chip-teal">MyBreath, {ser.session_min} min</span>
          </div>
        </div>
      );
    case "twin":
      return (
        <Bars max={5} rows={[
          { label: "Stress, per 10 pts", value: +(sens.stress / 10).toFixed(1), tone: "var(--lav)" },
          { label: "Sleep debt, per h", value: +sens.sleep_debt.toFixed(1), tone: "var(--teal)" },
          { label: "Salt, per g", value: +sens.salt_load.toFixed(1), tone: "var(--amber)" },
          { label: "Missed meds", value: +(-sens.drug_level).toFixed(1), tone: "var(--rose)" },
        ]} unit=" mmHg" />
      );
    case "forecast":
      return (
        <div className="mv-forecast">
          <div className="mv-dial"><Dial risk={S.risk} size={150} /><b>{pct(S.risk)}</b><span>surge risk, next 24 h</span></div>
          <div className="mv-curve"><TwinCurve curve={S.projection.map(p => p.sbp)} w={300} h={150} /></div>
        </div>
      );
    case "decision":
      return (
        <div className="mv-ladder">
          {[["Stable", "below 30%", "var(--teal)", "Weekly digest"], ["Elevated", "30–55%", "var(--amber)", "Nudge in MyZenn"],
            ["High", "55% and up", "var(--rose)", "Doctor alert + protocol"], ["Crisis", "180/110 reading", "#9b2242", "MySafe call now"]].map(([t, r, c, a]) => (
            <div key={t} className="mv-rung"><i style={{ background: c }} /><b>{t}</b><span>{r}</span><em>{a}</em></div>
          ))}
        </div>
      );
    case "explain":
      return (
        <Bars max={2.2} rows={S.groups.slice(0, 5).map(g => ({
          label: g.group, value: +g.impact.toFixed(2), tone: g.impact > 0 ? "var(--rose)" : "var(--teal)",
        }))} />
      );
    case "simulate": {
      const s = S.scenarios as Record<string, { risk: number }>;
      return (
        <div className="mv-sim">
          {[["Today", s["000"].risk], ["Every dose", s["001"].risk], ["+ MyBreath + sleep", s["111"].risk]].map(([l, r], i) => (
            <div key={l as string} className="mv-sim-step">
              <b style={{ color: tierColor(r as number) }}>{pct(r as number)}</b><span>{l as string}</span>
              {i < 2 && <i aria-hidden>→</i>}
            </div>
          ))}
        </div>
      );
    }
    case "prescribe":
      return (
        <div className="mv-phone">
          <div className="mv-notif">
            <div className="mv-notif-head"><span className="mv-app">MyZenn</span><span>now</span></div>
            <b>A moment of calm is waiting</b>
            <p>Tomorrow evening looks heavy. 10 minutes of MyBreath at 6 pm?</p>
            <div className="mv-notif-act"><span>Schedule 6 pm</span><span>Do it now</span><span>Not today</span></div>
          </div>
          <small>Lock-screen text stays generic: no diagnosis on a visible screen.</small>
        </div>
      );
    case "learn":
      return (
        <Bars max={20} unit=" pts" rows={[
          { label: "Learned policy", value: M.bandit, tone: "var(--teal)" },
          { label: "Random choice", value: M.random, tone: "var(--line-strong)" },
          { label: "Best possible", value: M.oracle, tone: "var(--butter-ink)" },
        ]} />
      );
    default:
      return null;
  }
}
