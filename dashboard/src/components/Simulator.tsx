import { useEffect, useState } from "react";
import { api, pct, Scenario, SimResult } from "../api";

export const EMPTY: Scenario = { sleep_extra_h: 0, breathing_min: 0, adherence: false, low_salt: false, steps_extra: 0 };

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="toggle">
      <span id={label}>{label}</span>
      <button className="switch" role="switch" aria-checked={on} aria-labelledby={label} onClick={() => onChange(!on)} />
    </div>
  );
}

export function Simulator({ id, at, scenario, setScenario, onResult }: {
  id: string; at: number; scenario: Scenario; setScenario: (s: Scenario) => void; onResult: (r: SimResult | null) => void;
}) {
  const [res, setRes] = useState<SimResult | null>(null);
  const [busy, setBusy] = useState(false);
  const isEmpty = JSON.stringify(scenario) === JSON.stringify(EMPTY);

  useEffect(() => {
    if (isEmpty) { setRes(null); onResult(null); return; }
    setBusy(true);
    const t = setTimeout(() => {
      api.simulate(id, scenario, at).then(r => { setRes(r); onResult(r); }).finally(() => setBusy(false));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, at, JSON.stringify(scenario)]);

  const set = (k: keyof Scenario, v: number | boolean) => setScenario({ ...scenario, [k]: v });

  return (
    <section className="panel" aria-labelledby="sim-h">
      <div className="panel-head">
        <h2 id="sim-h">What if…</h2>
        <span className="aside">Runs on this patient's twin</span>
        {!isEmpty && <button className="btn ghost" onClick={() => setScenario(EMPTY)}>Reset</button>}
      </div>
      <div className="control">
        <label htmlFor="br">MyBreath slow breathing <span className="num">{scenario.breathing_min} min/day</span></label>
        <input id="br" type="range" min={0} max={30} step={5} value={scenario.breathing_min}
               onChange={e => set("breathing_min", Number(e.target.value))} />
      </div>
      <div className="control">
        <label htmlFor="sl">Extra sleep <span className="num">+{scenario.sleep_extra_h} h/night</span></label>
        <input id="sl" type="range" min={0} max={2} step={0.5} value={scenario.sleep_extra_h}
               onChange={e => set("sleep_extra_h", Number(e.target.value))} />
      </div>
      <div className="control">
        <label htmlFor="st">Extra walking <span className="num">+{scenario.steps_extra.toLocaleString("en-IN")} steps/day</span></label>
        <input id="st" type="range" min={0} max={6000} step={1000} value={scenario.steps_extra}
               onChange={e => set("steps_extra", Number(e.target.value))} />
      </div>
      <Switch label="Every dose taken (pillbox reminders)" on={scenario.adherence} onChange={v => set("adherence", v)} />
      <Switch label="Low-salt meals for 3 days" on={scenario.low_salt} onChange={v => set("low_salt", v)} />

      {res && (
        <div className="sim-result" aria-live="polite">
          <div>
            <div className="small muted">24 h surge risk</div>
            <div className="big num">{pct(res.risk_before)} to {pct(res.risk_after)}</div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div className="delta num">{res.risk_reduction >= 0 ? "−" : "+"}{Math.abs(Math.round(res.risk_reduction * 100))} points</div>
            <div className="small muted num">Peak SBP {res.projection_before.peak_sbp} to {res.projection_after.peak_sbp}</div>
          </div>
        </div>
      )}
      {!res && !busy && <p className="small muted" style={{ marginTop: 12 }}>Move a slider to see how the twin responds.</p>}
      {busy && <p className="small muted" style={{ marginTop: 12 }}>Simulating…</p>}
    </section>
  );
}
