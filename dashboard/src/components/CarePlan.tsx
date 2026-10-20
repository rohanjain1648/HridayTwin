import { useEffect, useState } from "react";
import { Send, Stethoscope, Pill, ExternalLink } from "lucide-react";
import { api, pct, Scenario, TwinView } from "../api";
import { MYZENN, myzennUrl } from "../myzenn";

const SCEN: Record<string, Partial<Scenario>> = {
  breath: { breathing_min: 20 }, sleep: { sleep_extra_h: 1, breathing_min: 5 }, adherence: { adherence: true },
  salt: { low_salt: true }, move: { steps_extra: 3000, breathing_min: 5 },
};

export function CarePlan({ twin, onPreview }: { twin: TwinView; onPreview: (s: Partial<Scenario>) => void }) {
  const [log, setLog] = useState<any[]>([]);
  useEffect(() => { api.actions(twin.patient_id).then(setLog); }, [twin.patient_id]);
  const act = (type: string, detail: string, intervention_id?: string) =>
    api.act(twin.patient_id, { type, detail, intervention_id }).then(setLog);
  const best = twin.recommendations[0];
  const learned = twin.recommendations.find(r => r.id === twin.sentinel_policy.learned_pick);

  return (
    <section className="panel" aria-labelledby="care-h">
      <div className="panel-head">
        <h2 id="care-h">Care plan</h2>
        <span className="aside">Ranked by simulated risk reduction on this twin</span>
      </div>
      {twin.recommendations.map(r => {
        const link = myzennUrl(r.myzenn_tool);
        return (
        <div key={r.id} className={`rec ${r.id === best.id && r.risk_reduction > 0.01 ? "best" : ""}`}>
          <div>
            <div className="rec-name">{r.name}</div>
            <div className="rec-tool">
              {link ? (
                <a href={link} target="_blank" rel="noreferrer" title={`Open ${r.myzenn_tool} in MyZenn`}>
                  {r.myzenn_tool} <ExternalLink size={11} aria-hidden />
                </a>
              ) : r.myzenn_tool}
            </div>
            <div className="rec-desc">{r.description}</div>
          </div>
          <div className="rec-effect">
            <b className="num">{r.risk_reduction > 0.005 ? `−${Math.round(r.risk_reduction * 100)} pts` : "No benefit predicted"}</b>
            <span className="muted num">risk {pct(r.risk_after)}, peak {r.peak_sbp_after}</span>
            <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => onPreview(SCEN[r.id])}>Preview</button>
              <button className="btn" onClick={() => act("prescribe", `${r.name} (${r.myzenn_tool})`, r.id)}>
                <Send size={14} aria-hidden /> Prescribe
              </button>
            </div>
          </div>
        </div>
        );
      })}
      <p className="small muted" style={{ marginTop: 10 }}>
        MySentinel's learned policy would choose <b>{learned?.name ?? twin.sentinel_policy.learned_pick}</b> for this context.
        Prescribing sends the protocol to the patient's <a className="text-link" href={MYZENN} target="_blank" rel="noreferrer">MyZenn app</a> with
        a reminder schedule.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn ghost" onClick={() => act("teleconsult", "Tele-consult booked within 24 h")}>
          <Stethoscope size={14} aria-hidden /> Book tele-consult
        </button>
        <button className="btn ghost" onClick={() => act("medication_review", "Medication review flagged for titration")}>
          <Pill size={14} aria-hidden /> Flag medication review
        </button>
      </div>
      {log.length > 0 && (
        <ul className="actions-log">
          {log.slice(0, 5).map((a, i) => (
            <li key={i}>
              {new Date(a.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}: {a.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
