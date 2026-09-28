import { useEffect, useRef, useState } from "react";
import { Pause, Play, Send, Square, Zap } from "lucide-react";
import {
  Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, LineChart,
} from "recharts";
import { api, fmtHour, hourToDate, pct, RosterRow } from "../api";
import { CameraPulse } from "./CameraPulse";
import { LiveDevice } from "./LiveDevice";

interface Tick {
  type: "tick"; hour: number; t: string; hr: number | null; hrv: number | null; steps: number | null; stress: number | null;
  asleep: number; cuff: { sbp: number; dbp: number }[]; risk: number; tier: string; truth_sbp: number; truth_surge: boolean;
  events: { type: string; text: string; tier?: string; action?: string;
            recommendation?: { id: string; name: string; myzenn_tool: string; risk_after: number; risk_reduction: number } }[];
}
interface Preset { patient_id: string; name: string; start_hour: number; lead_h: number; driver: string; peak_sbp: number }

const SPEEDS = [{ label: "Slow", interval: 2 }, { label: "Normal", interval: 1 }, { label: "Fast", interval: 0.35 }];
const DRIVER = { stress: "stress-driven", sleep_debt: "sleep-driven", missed_meds: "missed doses", salt: "salt-driven" } as Record<string, string>;
const tick = { fontSize: 11, fill: "#6b7c8f" };
const tierColor = (t: string) => (t === "low" ? "#3b8f5a" : t === "medium" ? "#d9912b" : "#c8412f");

export function LiveMonitor({ row, nowHour, isNow, onSelect, onChanged }: {
  row: RosterRow; nowHour: number; isNow: boolean; onSelect: (id: string) => void; onChanged: () => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [log, setLog] = useState<(Tick["events"][number] & { t: string; hour: number })[]>([]);
  const [state, setState] = useState<"idle" | "running" | "paused" | "ended">("idle");
  const [speed, setSpeed] = useState(1);
  const [start, setStart] = useState<number>(nowHour - 96);
  const [showTruth, setShowTruth] = useState(true);
  const [history, setHistory] = useState<any>(null);
  const ws = useRef<WebSocket | null>(null);
  const pendingStart = useRef<number | null>(null);

  useEffect(() => {
    api.presets().then(ps => {
      setPresets(ps);
      // Demo deep link: /?view=live&autoplay=1 starts the first suggested moment
      if (new URLSearchParams(location.search).get("autoplay") && ps.length) { setSpeed(0.35); playPreset(ps[0]); }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadHistory = () => api.liveHistory(row.id).then(setHistory);
  useEffect(() => { loadHistory(); }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { ws.current?.close(); ws.current = null; };
  useEffect(() => () => close(), []);
  useEffect(() => {
    close(); setTicks([]); setLog([]); setState("idle");
    if (pendingStart.current != null) { const s = pendingStart.current; pendingStart.current = null; setStart(s); run(s); }
  }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (from = start) => {
    close();
    setTicks([]); setLog([]);
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const sock = new WebSocket(`${proto}://${location.host}/ws/stream/${row.id}?start=${from}&interval=${speed}`);
    ws.current = sock;
    sock.onopen = () => setState("running");
    sock.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.type === "tick") {
        setTicks(prev => [...prev, m].slice(-168));
        if (m.events.length) setLog(prev => [...m.events.map((e: any) => ({ ...e, t: m.t, hour: m.hour })).reverse(), ...prev].slice(0, 80));
      } else if (m.type === "end") setState("ended");
    };
    sock.onclose = () => setState(s => (s === "running" || s === "paused" ? "ended" : s));
  };
  const send = (cmd: object) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(cmd));
  const setSpeedLive = (interval: number) => { setSpeed(interval); send({ cmd: "speed", interval }); };

  const playPreset = (p: Preset) => {
    if (p.patient_id === row.id) { setStart(p.start_hour); run(p.start_hour); }
    else { pendingStart.current = p.start_hour; onSelect(p.patient_id); }
  };

  const last = ticks[ticks.length - 1];
  const data = ticks.map(t => ({
    hour: t.hour, risk: t.risk, truth: showTruth ? t.truth_sbp : null, cuff: t.cuff[0]?.sbp ?? null,
    hr: t.hr, hrv: t.hrv, stress: t.stress,
  }));
  const minH = nowHour - 50 * 24;

  return (
    <>
      <div className="identity">
        <div>
          <h2>Live monitor</h2>
          <div className="facts">Real-time data flowing into {row.name}'s twin: a replayed wearable feed, your webcam, or a Bluetooth strap.</div>
        </div>
      </div>

      <section className="panel" aria-labelledby="replay-h" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h2 id="replay-h">Streaming replay</h2>
          <span className="aside">One hour of sensor data per tick; the twin re-scores on every tick</span>
        </div>

        {presets.length > 0 && (
          <div className="presets">
            <span className="small muted">Suggested moments (held-out patients):</span>
            {presets.map(p => (
              <button key={p.patient_id + p.start_hour} className="chip" onClick={() => playPreset(p)}>
                <Zap size={12} aria-hidden /> {p.name}, {DRIVER[p.driver] ?? p.driver}, {p.lead_h} h warning
              </button>
            ))}
          </div>
        )}

        <div className="replay-controls">
          <label className="small" htmlFor="rs">Start from</label>
          <input id="rs" type="range" min={minH} max={nowHour - 24} step={6} value={start}
                 onChange={e => setStart(Number(e.target.value))} aria-valuetext={fmtHour(start)} />
          <span className="num small">{fmtHour(start)}</span>
          <div className="seg" role="group" aria-label="Speed">
            {SPEEDS.map(s => (
              <button key={s.label} className="chip" aria-pressed={speed === s.interval} onClick={() => setSpeedLive(s.interval)}>{s.label}</button>
            ))}
          </div>
          {state !== "running" && state !== "paused" &&
            <button className="btn" onClick={() => run()}><Play size={14} aria-hidden /> {state === "ended" ? "Replay again" : "Start stream"}</button>}
          {state === "running" && <button className="btn ghost" onClick={() => { send({ cmd: "pause" }); setState("paused"); }}><Pause size={14} aria-hidden /> Pause</button>}
          {state === "paused" && <button className="btn" onClick={() => { send({ cmd: "resume" }); setState("running"); }}><Play size={14} aria-hidden /> Resume</button>}
          {(state === "running" || state === "paused") && <button className="btn ghost" onClick={() => { close(); setState("ended"); }}><Square size={14} aria-hidden /> Stop</button>}
        </div>

        {ticks.length === 0 && <p className="empty small">Pick a suggested moment or press Start stream.</p>}
        {last && (
          <div className="monitor">
            <div>
              <div className="monitor-tiles">
                <div><span className="k">Twin time</span><span className="v num small-v">{hourToDate(last.hour).toLocaleString("en-IN", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
                <div><span className="k">24 h risk</span><span className="v num" style={{ color: tierColor(last.tier) }}>{pct(last.risk)}</span></div>
                <div><span className="k">Heart rate</span><span className="v num">{last.hr != null ? Math.round(last.hr) : "–"}</span></div>
                <div><span className="k">HRV</span><span className="v num">{last.hrv != null ? Math.round(last.hrv) : "–"}</span></div>
                <div><span className="k">Stress</span><span className="v num">{last.stress != null ? Math.round(last.stress) : "–"}</span></div>
                <div><span className="k">State</span><span className="v small-v">{last.asleep ? "Asleep" : "Awake"}</span></div>
              </div>
              <ResponsiveContainer width="100%" height={230}>
                <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <XAxis dataKey="hour" type="number" domain={["dataMin", "dataMax"]} tick={tick}
                         tickFormatter={h => hourToDate(h).toLocaleString("en-IN", { weekday: "short", hour: "2-digit" })} />
                  <YAxis yAxisId="bp" domain={[100, 200]} tick={tick} />
                  <YAxis yAxisId="risk" orientation="right" domain={[0, 1]} tickFormatter={v => `${Math.round(v * 100)}%`} tick={tick} />
                  <ReferenceLine yAxisId="bp" y={160} stroke="#c8412f" strokeDasharray="5 4" />
                  <ReferenceLine yAxisId="risk" y={0.55} stroke="#c8412f" strokeOpacity={0.4} />
                  <ReferenceLine yAxisId="risk" y={0.3} stroke="#d9912b" strokeOpacity={0.4} />
                  <Area yAxisId="risk" dataKey="risk" type="stepAfter" stroke="#15304b" fill="#15304b" fillOpacity={0.1} strokeWidth={2} isAnimationActive={false} />
                  {showTruth && <Line yAxisId="bp" dataKey="truth" stroke="#c8412f" strokeOpacity={0.55} strokeDasharray="2 3" dot={false} isAnimationActive={false} />}
                  <Scatter yAxisId="bp" dataKey="cuff" fill="#15304b" isAnimationActive={false} />
                  <Tooltip labelFormatter={h => fmtHour(Number(h))} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="legend">
                <span><i style={{ background: "#15304b" }} />24 h surge risk (right axis)</span>
                <span><i style={{ background: "#15304b", height: 8, width: 8, borderRadius: 4 }} />Home cuff</span>
                <label className="check"><input type="checkbox" checked={showTruth} onChange={e => setShowTruth(e.target.checked)} />
                  True ambulatory BP (evaluation only, the model never sees it)</label>
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                  <XAxis dataKey="hour" type="number" domain={["dataMin", "dataMax"]} hide />
                  <YAxis tick={tick} />
                  <Line dataKey="hr" stroke="#c8412f" dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls />
                  <Line dataKey="hrv" stroke="#009e9a" dot={false} strokeWidth={1.4} isAnimationActive={false} connectNulls />
                  <Tooltip labelFormatter={h => fmtHour(Number(h))} />
                </LineChart>
              </ResponsiveContainer>
              <div className="legend"><span><i style={{ background: "#c8412f" }} />Heart rate</span><span><i style={{ background: "#009e9a" }} />HRV</span></div>
            </div>
            <div className="event-log" aria-live="polite" aria-label="Event log">
              {log.map((e, i) => (
                <div key={i} className={`ev ev-${e.type}`}>
                  <span className="ev-time num">{hourToDate(e.hour).toLocaleString("en-IN", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span>{e.text}</span>
                  {e.recommendation && e.recommendation.risk_reduction > 0.005 && (
                    <div className="ev-rec">
                      Twin suggests <b>{e.recommendation.name}</b> ({e.recommendation.myzenn_tool}): risk to {pct(e.recommendation.risk_after)}.
                      <button className="btn" onClick={() => api.act(row.id, { type: "prescribe", detail: `${e.recommendation!.name} (from live alert)`, intervention_id: e.recommendation!.id })}>
                        <Send size={12} aria-hidden /> Prescribe
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="grid-2">
        <CameraPulse id={row.id} enabled={isNow} onUpdate={() => { loadHistory(); onChanged(); }} />
        <LiveDevice id={row.id} enabled={isNow} onUpdate={() => { loadHistory(); onChanged(); }} />
      </div>

      <section className="panel" aria-labelledby="hist-h">
        <div className="panel-head">
          <h2 id="hist-h">Stored live readings</h2>
          <span className="aside">Saved on the server (SQLite), so live sources build real history</span>
        </div>
        {!history || history.summary.samples === 0 ? (
          <p className="small muted">No live readings for {row.name} yet. Start the camera or pair a device.</p>
        ) : (
          <>
            <p className="small" style={{ marginBottom: 8 }}>
              {history.summary.samples} readings from {history.summary.sources.join(", ")}, first {new Date(history.summary.first).toLocaleString("en-IN")}.
              {history.active > 0 ? ` ${history.active} in the active session are shaping the twin now.` : " None active: the twin is using its recorded streams."}
            </p>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={history.samples.map((s: any, i: number) => ({ i, hr: s.hr, hrv: s.hrv }))} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <XAxis dataKey="i" hide />
                <YAxis tick={tick} />
                <Line dataKey="hr" stroke="#c8412f" dot={false} isAnimationActive={false} connectNulls />
                <Line dataKey="hrv" stroke="#009e9a" dot={false} isAnimationActive={false} connectNulls />
                <Tooltip />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </section>
    </>
  );
}
