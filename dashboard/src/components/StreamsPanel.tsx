import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart, Area } from "recharts";
import { fmtHour, hourToDate, Streams } from "../api";

const tick = { fontSize: 11, fill: "#6b7c8f" };
const dayTick = (h: number) => hourToDate(h).toLocaleDateString("en-IN", { weekday: "short" });

export function StreamsPanel({ s }: { s: Streams }) {
  const lo = s.now_hour - 7 * 24;
  const ticks = Array.from({ length: 8 }, (_, i) => lo + i * 24);
  const days: Record<string, { day: string; steps: number; session: number; salt: number }> = {};
  s.hourly.forEach(h => {
    const d = hourToDate(h.hour).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });
    days[d] ??= { day: d, steps: 0, session: 0, salt: 0 };
    days[d].steps += h.steps ?? 0;
    days[d].session += h.session ?? 0;
    days[d].salt += h.salt ?? 0;
  });
  const daily = Object.values(days);
  const moods = s.hourly.filter(h => h.mood != null).map(h => ({ hour: h.hour, mood: h.mood }));
  const sleep = s.sleep.map(n => ({
    date: new Date(n.date).toLocaleDateString("en-IN", { weekday: "short" }),
    deep: +(n.total * n.deep / 100).toFixed(2), rem: +(n.total * n.rem / 100).toFixed(2),
    light: +(n.total * n.light / 100).toFixed(2), total: n.total,
  }));

  return (
    <section className="panel" aria-labelledby="streams-h">
      <div className="panel-head">
        <h2 id="streams-h">Wearable and MyZenn streams, last 7 days</h2>
        <span className="aside">Smartwatch, smart pillbox, home cuff and MyZenn check-ins</span>
      </div>
      <div className="grid-3">
        <div>
          <div className="stream-title"><span>Heart rate and HRV</span><span className="muted">bpm / ms</span></div>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={s.hourly} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <XAxis dataKey="hour" type="number" domain={[lo, s.now_hour]} ticks={ticks} tickFormatter={dayTick} tick={tick} />
              <YAxis tick={tick} />
              <Line dataKey="hr" stroke="#c8412f" dot={false} strokeWidth={1} isAnimationActive={false} connectNulls />
              <Line dataKey="hrv" stroke="#009e9a" dot={false} strokeWidth={1.3} isAnimationActive={false} connectNulls />
              <Tooltip labelFormatter={h => fmtHour(Number(h))} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="stream-title"><span>Stress score</span><span className="muted">0–100, from HRV</span></div>
          <ResponsiveContainer width="100%" height={140}>
            <ComposedChart data={s.hourly} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <XAxis dataKey="hour" type="number" domain={[lo, s.now_hour]} ticks={ticks} tickFormatter={dayTick} tick={tick} />
              <YAxis domain={[0, 100]} tick={tick} />
              <Area dataKey="stress" stroke="#d9912b" fill="#d9912b" fillOpacity={0.2} dot={false} isAnimationActive={false} connectNulls />
              <Tooltip labelFormatter={h => fmtHour(Number(h))} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="stream-title"><span>Sleep stages</span><span className="muted">hours per night</span></div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={sleep} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <XAxis dataKey="date" tick={tick} />
              <YAxis tick={tick} domain={[0, 9]} />
              <Bar dataKey="deep" stackId="s" fill="#15304b" isAnimationActive={false} />
              <Bar dataKey="rem" stackId="s" fill="#009e9a" isAnimationActive={false} />
              <Bar dataKey="light" stackId="s" fill="#a9d8d4" isAnimationActive={false} />
              <Tooltip />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="stream-title"><span>Daily steps</span></div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <XAxis dataKey="day" tick={tick} />
              <YAxis tick={tick} />
              <Bar dataKey="steps" fill="#6b7c8f" isAnimationActive={false} />
              <Tooltip formatter={(v: any) => Math.round(v).toLocaleString("en-IN")} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="stream-title"><span>MyZenn mood check-ins</span><span className="muted">1–10</span></div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={moods} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <XAxis dataKey="hour" type="number" domain={[lo, s.now_hour]} ticks={ticks} tickFormatter={dayTick} tick={tick} />
              <YAxis domain={[1, 10]} tick={tick} />
              <Line dataKey="mood" stroke="#15304b" strokeWidth={1.5} isAnimationActive={false} />
              <Tooltip labelFormatter={h => fmtHour(Number(h))} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="stream-title"><span>Medication (smart pillbox)</span></div>
          <div className="adh" role="list">
            {s.doses.filter(d => d.visible).map(d => (
              <span key={d.date} role="listitem" className={d.taken ? "yes" : "no"}
                    title={`${d.date}: ${d.taken ? "taken" : "missed"}`}>{d.taken ? "✓" : "✕"}</span>
            ))}
          </div>
          <div className="stream-title" style={{ marginTop: 14 }}><span>Logged salty meals and MyZenn practice</span></div>
          <div className="small muted">
            {daily.map(d => (
              <div key={d.day} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{d.day}</span>
                <span className="num">{[d.salt ? `salty meal (+${d.salt.toFixed(0)} g)` : null, d.session ? `${d.session} min MyZenn` : null].filter(Boolean).join(", ") || "nothing logged"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
