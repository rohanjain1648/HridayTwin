import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtHour, hourToDate, Projection, Streams, TwinView } from "../api";

const dayTick = (h: number) => hourToDate(h).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });

export function TwinChart({ twin, streams, whatIf, showOutcomes }: {
  twin: TwinView; streams: Streams; whatIf: Projection | null; showOutcomes: boolean;
}) {
  const now = twin.now_hour;
  const lo = now - 7 * 24, hi = now + 24;
  const data: any[] = [];
  streams.cuff.forEach(c => data.push({ hour: c.hour, cuff: c.sbp }));
  twin.projection.curve.forEach((p, i) => data.push({
    hour: p.hour + 0.5, proj: p.sbp, band: [p.lo, p.hi], whatif: whatIf?.curve[i]?.sbp ?? null,
  }));
  data.sort((a, b) => a.hour - b.hour);

  const risk = twin.risk_history.filter(r => r.hour >= lo).map(r => ({ hour: r.hour, prob: r.prob }));
  risk.push({ hour: now, prob: twin.risk });

  return (
    <div>
      <ResponsiveContainer width="100%" height={290}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -6 }}>
          <CartesianGrid stroke="rgba(0,158,154,0.12)" />
          <XAxis dataKey="hour" type="number" domain={[lo, hi]} ticks={Array.from({ length: 9 }, (_, i) => lo + i * 24)}
                 tickFormatter={dayTick} tick={{ fontSize: 12, fill: "#6b7c8f", fontFamily: "var(--font-sans)" }} />
          <YAxis domain={[100, 200]} tick={{ fontSize: 12, fill: "#6b7c8f", fontFamily: "var(--font-sans)" }} width={48} unit="" />
          <ReferenceArea x1={now} x2={hi} fill="#009e9a" fillOpacity={0.05} />
          {showOutcomes && streams.ground_truth_events.map(e => (
            <ReferenceArea key={e.hour} x1={e.hour} x2={e.hour + e.duration_h} fill="#c8412f" fillOpacity={e.future ? 0.28 : 0.14}
                           stroke={e.future ? "#c8412f" : undefined} strokeDasharray="3 3" />
          ))}
          <ReferenceLine y={160} stroke="#c8412f" strokeDasharray="5 4"
                         label={{ value: "Surge threshold 160", position: "insideTopLeft", fontSize: 11, fill: "#c8412f", fontFamily: "var(--font-sans)" }} />
          <ReferenceLine x={now} stroke="#15304b" label={{ value: "Now", position: "insideTopRight", fontSize: 11, fill: "#15304b", fontFamily: "var(--font-sans)" }} />
          <Area dataKey="band" stroke="none" fill="#009e9a" fillOpacity={0.16} isAnimationActive={false} connectNulls />
          <Line dataKey="proj" stroke="#009e9a" strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls />
          {whatIf && <Line dataKey="whatif" stroke="#007470" strokeWidth={2} strokeDasharray="6 4" dot={false}
                           isAnimationActive={false} connectNulls />}
          <Scatter dataKey="cuff" fill="#15304b" isAnimationActive={false} />
          <Tooltip labelFormatter={h => fmtHour(Number(h))}
                   wrapperStyle={{ fontFamily: "var(--font-sans)", fontSize: 13 }}
                   formatter={(v: any, n: string) => [Array.isArray(v) ? `${v[0]}–${v[1]}` : v,
                     ({ cuff: "Home cuff SBP", proj: "Twin projection", band: "80% band", whatif: "What-if projection" } as any)[n] ?? n]} />
        </ComposedChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={86}>
        <ComposedChart data={risk} margin={{ top: 4, right: 16, bottom: 0, left: -6 }}>
          <XAxis dataKey="hour" type="number" domain={[lo, hi]} hide />
          <YAxis domain={[0, 1]} ticks={[0, 0.3, 0.55, 1]} tickFormatter={v => `${Math.round(v * 100)}%`}
                 tick={{ fontSize: 11, fill: "#6b7c8f", fontFamily: "var(--font-sans)" }} width={48} />
          <ReferenceLine y={0.55} stroke="#c8412f" strokeDasharray="3 3" />
          <ReferenceLine y={0.3} stroke="#d9912b" strokeDasharray="3 3" />
          <ReferenceLine x={now} stroke="#15304b" />
          <Area dataKey="prob" type="stepAfter" stroke="#15304b" fill="#15304b" fillOpacity={0.08} strokeWidth={1.5}
                isAnimationActive={false} />
          <Tooltip labelFormatter={h => fmtHour(Number(h))} formatter={(v: any) => [`${Math.round(v * 100)}%`, "24 h surge risk"]} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="legend">
        <span><i style={{ background: "#15304b", height: 8, width: 8, borderRadius: 4 }} />Home cuff readings</span>
        <span><i style={{ background: "#009e9a" }} />Twin projection, next 24 h</span>
        {whatIf && <span><i style={{ background: "repeating-linear-gradient(90deg,#007470 0 5px,transparent 5px 8px)" }} />What-if</span>}
        <span><i style={{ background: "#15304b", opacity: .5 }} />Risk engine output (lower strip)</span>
        {showOutcomes && <span><i style={{ background: "#c8412f", opacity: .5, height: 8 }} />Actual surges (evaluation only)</span>}
      </div>
    </div>
  );
}

export function RiskDial({ risk, tier }: { risk: number; tier: string }) {
  const r = 70, cx = 90, cy = 86;
  const a = Math.PI * (1 - Math.min(Math.max(risk, 0), 1));
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  const color = tier === "low" ? "#3b8f5a" : tier === "medium" ? "#d9912b" : "#c8412f";
  return (
    <svg width={180} height={100} viewBox="0 0 180 100" role="img" aria-label={`24-hour surge risk ${Math.round(risk * 100)}%`}>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#e3ebe8" strokeWidth={14} strokeLinecap="round" />
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" />
    </svg>
  );
}
