import { useEffect, useMemo, useState } from "react";
import { HeartPulse } from "lucide-react";
import { api, fmtHour, RosterRow, Tier } from "./api";
import { Roster } from "./components/Roster";
import { PatientView } from "./components/PatientView";
import { Records } from "./components/Records";
import { Evidence } from "./components/Evidence";
import { LiveMonitor } from "./components/LiveMonitor";

type View = "twin" | "live" | "records" | "evidence";

export default function App() {
  const [nowHour, setNowHour] = useState<number | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const params = new URLSearchParams(window.location.search);
  const [selected, setSelected] = useState<string | null>(params.get("patient"));
  const [view, setView] = useState<View>((params.get("view") as View) || "twin");
  const [filter, setFilter] = useState<Tier | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [fontPreset, setFontPreset] = useState<"modern" | "clinical" | "tech">(() => {
    return (localStorage.getItem("ht_font_preset") as any) || "modern";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-font", fontPreset);
    localStorage.setItem("ht_font_preset", fontPreset);
  }, [fontPreset]);

  useEffect(() => {
    api.health().then(h => { setNowHour(h.now_hour); setAt(h.now_hour); })
      .catch(() => setError("Can't reach the twin API. Start it with: uvicorn api.main:app --port 8000"));
  }, []);

  // Clock snaps to the model's 6-hourly query grid when replaying
  useEffect(() => {
    if (at == null) return;
    const id = setTimeout(() => {
      api.roster(at).then(r => {
        setRoster(r);
        setSelected(s => s ?? r[0]?.id ?? null);
      }).catch(e => setError(String(e)));
    }, 250);
    return () => clearTimeout(id);
  }, [at, refresh]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { crisis: 0, high: 0, medium: 0, low: 0 };
    roster.forEach(r => c[r.tier]++);
    return c;
  }, [roster]);

  const current = roster.find(r => r.id === selected) ?? null;
  const minHour = nowHour != null ? nowHour - 14 * 24 : 0;

  return (
    <div className="shell">
      <aside className="rail" aria-label="Patient panel">
        <div className="brand">
          <a className="brand-row" href="/" title="Back to the HridayTwin home page" style={{ color: "inherit", textDecoration: "none" }}>
            <div className="mark"><HeartPulse size={20} aria-hidden /></div>
            <div>
              <h1>HridayTwin</h1>
              <p>Hypertension digital twin, by MyZenn</p>
            </div>
          </a>
        </div>
        <Roster rows={roster} counts={counts} filter={filter} onFilter={setFilter}
                selected={selected} onSelect={id => { setSelected(id); setView(v => (v === "live" ? "live" : "twin")); }} />
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="tabs" role="tablist" aria-label="Views">
            {([["twin", "Virtual patient"], ["live", "Live monitor"], ["records", "Health record"], ["evidence", "Model evidence"]] as const).map(([k, label]) => (
              <button key={k} role="tab" className="tab" aria-selected={view === k} onClick={() => setView(k)}>{label}</button>
            ))}
          </div>
          <div className="font-picker" title="Typography styling" role="radiogroup" aria-label="Font styling preset">
            <button className="font-btn" aria-pressed={fontPreset === "modern"} onClick={() => setFontPreset("modern")} title="Modern Health (Outfit + Plus Jakarta Sans + JetBrains Mono)">Modern</button>
            <button className="font-btn" aria-pressed={fontPreset === "clinical"} onClick={() => setFontPreset("clinical")} title="Clinical Sans (Plus Jakarta Sans + JetBrains Mono)">Clinical</button>
            <button className="font-btn" aria-pressed={fontPreset === "tech"} onClick={() => setFontPreset("tech")} title="Neo-Tech (Space Grotesk + Plus Jakarta Sans)">Tech</button>
          </div>
          {nowHour != null && at != null && (
            <div className="clock">
              <label htmlFor="clock" className="muted">Twin clock</label>
              <input id="clock" type="range" min={minHour} max={nowHour} step={6} value={at}
                     onChange={e => setAt(Number(e.target.value))} aria-valuetext={fmtHour(at)} />
              <b className="num">{fmtHour(at)}</b>
              {at !== nowHour && <button className="btn ghost" onClick={() => setAt(nowHour)}>Back to now</button>}
            </div>
          )}
        </div>

        <div className="content">
          {error && <div className="banner high">{error}</div>}
          {!error && !current && view !== "evidence" && <div className="empty">Loading the patient panel…</div>}
          {current && view === "twin" && at != null && (
            <PatientView row={current} at={at} isNow={at === nowHour} onChanged={() => setRefresh(x => x + 1)}
                         onOpenLive={() => setView("live")} />
          )}
          {current && view === "live" && nowHour != null && (
            <LiveMonitor row={current} nowHour={nowHour} isNow={at === nowHour}
                         onSelect={id => setSelected(id)} onChanged={() => setRefresh(x => x + 1)} />
          )}
          {current && view === "records" && <Records id={current.id} />}
          {view === "evidence" && <Evidence />}
        </div>
      </main>
    </div>
  );
}
