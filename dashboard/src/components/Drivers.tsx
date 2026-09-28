import { TwinView } from "../api";

export function Drivers({ twin }: { twin: TwinView }) {
  const groups = twin.explanation.groups.filter(g => Math.abs(g.impact) >= 0.02);
  const max = Math.max(...groups.map(g => Math.abs(g.impact)), 0.5);
  const sens = twin.sensitivities;
  return (
    <section className="panel" aria-labelledby="why-h">
      <div className="panel-head">
        <h2 id="why-h">Why this risk</h2>
        <span className="aside">Red pushes risk up, teal pulls it down</span>
      </div>
      {groups.map(g => {
        const w = (Math.abs(g.impact) / max) * 50;
        return (
          <div className="driver" key={g.group}>
            <span>{g.group}</span>
            <div className="bar-track" aria-hidden>
              <div className="axis" />
              <div className={`bar ${g.impact > 0 ? "up" : "down"}`} style={{ width: `${w}%` }} />
            </div>
            <span className="num small" style={{ textAlign: "right" }}>{g.impact > 0 ? "+" : ""}{g.impact.toFixed(2)}</span>
          </div>
        );
      })}
      <div className="feature-list">
        <h3 style={{ marginBottom: 4 }}>Strongest signals right now</h3>
        {twin.explanation.top_features.slice(0, 6).map(f => (
          <div className="feature" key={f.feature}>
            <span><span className={f.impact > 0 ? "arrow-up" : "arrow-down"}>{f.impact > 0 ? "▲" : "▼"}</span> {f.label}</span>
            <span className="num">{f.value ?? "–"}</span>
          </div>
        ))}
      </div>
      <div className="feature-list">
        <h3 style={{ marginBottom: 4 }}>Personal sensitivities (calibrated twin, {twin.n_cuff_readings} readings)</h3>
        <div className="feature"><span>Stress response</span><span className="num">+{(sens.stress.value / 10).toFixed(1)} mmHg per 10 stress points</span></div>
        <div className="feature"><span>Sleep debt</span><span className="num">{sens.sleep_debt.value >= 0 ? "+" : ""}{sens.sleep_debt.value.toFixed(1)} mmHg per hour</span></div>
        <div className="feature"><span>Medication effect at full adherence</span><span className="num">{(-sens.drug_level.value).toFixed(1)} mmHg lower</span></div>
        <div className="feature"><span>Salt sensitivity</span><span className="num">{sens.salt_load.value >= 0 ? "+" : ""}{sens.salt_load.value.toFixed(1)} mmHg per g</span></div>
      </div>
    </section>
  );
}
