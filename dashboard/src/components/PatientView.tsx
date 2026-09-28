import { useCallback, useEffect, useState } from "react";
import { Radio, ShieldAlert } from "lucide-react";
import { api, pct, RosterRow, Scenario, SimResult, Streams, TwinView } from "../api";
import { RiskDial, TwinChart } from "./TwinChart";
import { Drivers } from "./Drivers";
import { EMPTY, Simulator } from "./Simulator";
import { CarePlan } from "./CarePlan";
import { StreamsPanel } from "./StreamsPanel";

export function PatientView({ row, at, isNow, onChanged, onOpenLive }: {
  row: RosterRow; at: number; isNow: boolean; onChanged: () => void; onOpenLive: () => void;
}) {
  const [twin, setTwin] = useState<TwinView | null>(null);
  const [streams, setStreams] = useState<Streams | null>(null);
  const [scenario, setScenario] = useState<Scenario>(EMPTY);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [showOutcomes, setShowOutcomes] = useState(false);
  const [escalated, setEscalated] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.twin(row.id, at), api.streams(row.id, at)]).then(([t, s]) => { setTwin(t); setStreams(s); });
  }, [row.id, at]);

  useEffect(() => { setTwin(null); setScenario(EMPTY); setSim(null); setEscalated(false); }, [row.id]);
  useEffect(() => { load(); }, [load]);

  if (!twin || !streams) return <div className="empty">Building {row.name}'s twin…</div>;
  const t = twin.tier;
  const snap = twin.snapshot;

  return (
    <>
      {t.tier !== "low" && (
        <div className={`banner ${t.tier}`} role="alert">
          <ShieldAlert size={18} aria-hidden />
          <span><b>{t.label}.</b> {t.action}.</span>
          {t.tier === "crisis" && (
            <button className="btn light" disabled={escalated}
                    onClick={() => api.act(row.id, { type: "mysafe", detail: "MySafe escalation: clinician call initiated" }).then(() => setEscalated(true))}>
              {escalated ? "Escalated to MySafe" : "Escalate via MySafe"}
            </button>
          )}
        </div>
      )}

      <div className="identity">
        <div>
          <h2>{row.name}</h2>
          <div className="facts">{row.age} years, {row.sex === "M" ? "male" : "female"}, {row.city}. Patient {row.id}.</div>
        </div>
        <div className="tags">
          <span className="tag pheno">{twin.phenotype.primary}</span>
          {row.conditions.filter(c => c !== "Essential hypertension").map(c => <span className="tag" key={c}>{c}</span>)}
          {row.myzenn_user && <span className="tag">Uses MyZenn</span>}
        </div>
      </div>

      <div className="hero">
        <section className="panel chart-panel" aria-labelledby="twin-h">
          <div className="panel-head" style={{ paddingLeft: 6 }}>
            <h2 id="twin-h">Blood pressure twin</h2>
            <span className="muted small">Systolic, mmHg</span>
            <label className="check aside">
              <input type="checkbox" checked={showOutcomes} onChange={e => setShowOutcomes(e.target.checked)} />
              Show actual surges (evaluation only)
            </label>
          </div>
          <TwinChart twin={twin} streams={streams} whatIf={sim?.projection_after ?? null} showOutcomes={showOutcomes} />
        </section>
        <section className="panel dial" aria-labelledby="risk-h">
          <h2 id="risk-h" style={{ alignSelf: "flex-start" }}>Next 24 hours</h2>
          <RiskDial risk={twin.risk} tier={t.tier} />
          <div className="value num">{pct(twin.risk)}</div>
          <div className="label">chance of a sustained BP surge (≥160/100)</div>
          <div className="stat-list">
            <div><span>Projected peak</span><b className="num">{twin.projection.peak_sbp} mmHg</b></div>
            <div><span>Last home BP</span><b className="num">{snap.cuff_sbp_last ?? "–"}/{snap.cuff_dbp_last ?? "–"}</b></div>
            <div><span>HRV vs baseline</span><b className="num">{snap.hrv_24h_vs_7d_pct != null ? `${snap.hrv_24h_vs_7d_pct > 0 ? "+" : ""}${snap.hrv_24h_vs_7d_pct.toFixed(0)}%` : "–"}</b></div>
            <div><span>Sleep debt</span><b className="num">{snap.sleep_debt ?? "–"} h</b></div>
            <div><span>Doses, last 7 days</span><b className="num">{snap.doses_last_7d ?? "–"} of 7</b></div>
            <div><span>Last mood</span><b className="num">{snap.mood_last ?? "–"}/10</b></div>
          </div>
        </section>
      </div>

      <div className="grid-2">
        <Drivers twin={twin} />
        <Simulator id={row.id} at={at} scenario={scenario} setScenario={setScenario} onResult={setSim} />
      </div>

      <div className="grid-2">
        <CarePlan twin={twin} onPreview={s => setScenario({ ...EMPTY, ...s })} />
        <section className="panel" aria-labelledby="livecard-h">
          <div className="panel-head">
            <h2 id="livecard-h">Real-time data</h2>
            {twin.live && <span className="aside"><span className="pulse" style={{ display: "inline-block", marginRight: 6 }} />Live readings active</span>}
          </div>
          <p className="small muted" style={{ marginBottom: 12 }}>
            {twin.live ? "Live heart-rate and HRV readings are shaping this twin right now."
              : "Stream a replayed wearable feed, measure heart rate from the webcam, or pair a Bluetooth strap. Readings update this twin within seconds."}
          </p>
          <button className="btn" onClick={onOpenLive}><Radio size={14} aria-hidden /> Open live monitor</button>
          {!isNow && <p className="small muted" style={{ marginTop: 10 }}>Live readings apply at the current clock, not during replay.</p>}
        </section>
      </div>

      <StreamsPanel s={streams} />

      <p className="footnote">
        All patients are synthetic. Actual surges come from the simulator's hidden ambulatory BP and are shown only to
        evaluate the prediction; the model never sees them. HridayTwin is a research prototype, not a medical device.
      </p>
    </>
  );
}
