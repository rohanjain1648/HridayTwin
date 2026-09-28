import { useState } from "react";
import { RosterRow, Tier, pct } from "../api";

const TIER_LABEL: Record<Tier, string> = { crisis: "Crisis", high: "High", medium: "Elevated", low: "Stable" };

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 64, h = 18;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - v * h}`).join(" ");
  return (
    <svg width={w} height={h} aria-hidden style={{ display: "block", marginLeft: "auto" }}>
      <polyline points={pts} fill="none" stroke="var(--teal)" strokeWidth="1.5" />
    </svg>
  );
}

export function Roster(props: {
  rows: RosterRow[]; counts: Record<string, number>; filter: Tier | "all"; onFilter: (t: Tier | "all") => void;
  selected: string | null; onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = props.rows.filter(r =>
    (props.filter === "all" || r.tier === props.filter) &&
    (query === "" || `${r.name} ${r.id} ${r.city} ${r.phenotype}`.toLowerCase().includes(query.toLowerCase())));

  return (
    <>
      <div className="tier-counts" role="group" aria-label="Filter by risk tier">
        <button className="chip" aria-pressed={props.filter === "all"} onClick={() => props.onFilter("all")}>
          All {props.rows.length}
        </button>
        {(["crisis", "high", "medium", "low"] as Tier[]).map(t => (
          <button key={t} className="chip" aria-pressed={props.filter === t} onClick={() => props.onFilter(t)}>
            <span className={`dot t-${t}`} />{TIER_LABEL[t]} {props.counts[t] ?? 0}
          </button>
        ))}
      </div>
      <div className="search">
        <input placeholder="Search name, city or phenotype" value={query} onChange={e => setQuery(e.target.value)}
               aria-label="Search patients" />
      </div>
      <div className="roster">
        {rows.map(r => (
          <button key={r.id} className="pt" aria-current={props.selected === r.id} onClick={() => props.onSelect(r.id)}>
            <div>
              <div className="pt-name"><span className={`dot t-${r.tier}`} style={{ marginRight: 7 }} />{r.name}</div>
              <div className="pt-meta">{r.age}{r.sex}, {r.city}, home BP {r.last_sbp ?? "–"}/{r.last_dbp ?? "–"}</div>
              <div className="pt-meta">{r.phenotype}</div>
            </div>
            <div className="pt-risk">
              {pct(r.risk)}
              <small>24 h risk</small>
              <Spark values={r.spark} />
            </div>
          </button>
        ))}
        {rows.length === 0 && <p className="empty small">No patients match this filter.</p>}
      </div>
    </>
  );
}
