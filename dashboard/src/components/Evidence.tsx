import { useEffect, useState } from "react";
import { api } from "../api";

export function Evidence() {
  const [m, setM] = useState<any>(null);
  useEffect(() => { api.metrics().then(setM); }, []);
  if (!m) return <div className="empty">Loading model evidence…</div>;
  const lt = m.lead_time_medium, tv = m.twin_validation, se = m.sentinel;
  const ab = Object.entries(m.ablation as Record<string, any>).sort((a, b) => b[1].auroc - a[1].auroc);
  return (
    <>
      <div className="identity">
        <div>
          <h2>How well does the twin work?</h2>
          <div className="facts">
            Evaluated on {m.cohort.test_patients} patients the model never saw during training
            ({m.cohort.patients} synthetic patients, {m.cohort.days} days each, {m.cohort.samples.toLocaleString("en-IN")} prediction points).
          </div>
        </div>
      </div>
      <div className="metric-row">
        <div className="panel metric"><div className="v num">{m.test.auroc.toFixed(3)}</div><div className="k">AUROC for a surge in the next 24 h</div></div>
        <div className="panel metric"><div className="v num">{Math.round(lt.event_recall * 100)}%</div><div className="k">of surges flagged in advance (risk ≥ 30%)</div></div>
        <div className="panel metric"><div className="v num">{lt.median_lead_h} h</div><div className="k">median warning before onset</div></div>
        <div className="panel metric"><div className="v num">{m.test.brier.toFixed(3)}</div><div className="k">Brier score (calibration)</div></div>
      </div>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2>Does fusing the streams help?</h2></div>
          <table>
            <thead><tr><th>Data used</th><th>AUROC</th><th>AUPRC</th></tr></thead>
            <tbody>{ab.map(([k, v]) => (
              <tr key={k} style={k.includes("fusion") ? { fontWeight: 700 } : undefined}>
                <td>{k}</td><td className="num">{v.auroc.toFixed(3)}</td><td className="num">{v.auprc.toFixed(3)}</td>
              </tr>
            ))}</tbody>
          </table>
          <img className="plot" style={{ marginTop: 14 }} src="/plots/ablation.png" alt="Bar chart of AUROC by data stream" />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Does the twin learn real physiology?</h2></div>
          <p className="small muted" style={{ marginBottom: 10 }}>
            Each simulated patient has hidden sensitivities. The twin only sees cuff readings and wearables, yet recovers them:
          </p>
          <table>
            <tbody>
              <tr><td>Stress sensitivity (Spearman ρ)</td><td className="num"><b>{tv.corr_stress_sensitivity.toFixed(2)}</b></td></tr>
              <tr><td>Medication effect</td><td className="num">{tv.corr_drug_effect.toFixed(2)}</td></tr>
              <tr><td>Salt sensitivity</td><td className="num">{tv.corr_salt_sensitivity.toFixed(2)}</td></tr>
              <tr><td>Sleep-debt sensitivity</td><td className="num">{tv.corr_sleep_sensitivity.toFixed(2)}</td></tr>
              <tr><td>Main driver in the twin's top two</td><td className="num">{Math.round(tv.phenotype_top2_accuracy * 100)}%</td></tr>
            </tbody>
          </table>
          <img className="plot" style={{ marginTop: 14 }} src="/plots/twin_validation.png" alt="Scatter of true versus estimated stress sensitivity" />
        </section>
      </div>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2>Discrimination and calibration</h2></div>
          <img className="plot" src="/plots/performance.png" alt="ROC, precision-recall and calibration curves" />
          <img className="plot" style={{ marginTop: 12 }} src="/plots/lead_time.png" alt="Histogram of warning lead time" />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Does MySentinel pick the right intervention?</h2></div>
          <p className="small muted" style={{ marginBottom: 10 }}>
            A LinUCB bandit, pre-trained on {se.train_rounds.toLocaleString("en-IN")} simulated cases, chooses among five interventions.
          </p>
          <table>
            <tbody>
              <tr><td>Average risk reduction, learned policy</td><td className="num"><b>{Math.round(se.mean_risk_reduction_bandit * 100)} pts</b></td></tr>
              <tr><td>Average risk reduction, random choice</td><td className="num">{Math.round(se.mean_risk_reduction_random * 100)} pts</td></tr>
              <tr><td>Best possible (twin oracle)</td><td className="num">{Math.round(se.mean_risk_reduction_oracle * 100)} pts</td></tr>
              <tr><td>Same first choice as the oracle</td><td className="num">{Math.round(se.top1_agreement_with_twin_oracle * 100)}%</td></tr>
            </tbody>
          </table>
          <img className="plot" style={{ marginTop: 14 }} src="/plots/drivers.png" alt="Share of model gain by data source" />
        </section>
      </div>
    </>
  );
}
