export type Tier = "crisis" | "high" | "medium" | "low";

export interface RosterRow {
  id: string; name: string; age: number; sex: string; city: string; risk: number; tier: Tier;
  phenotype: string; last_sbp: number | null; last_dbp: number | null; hrv_change_pct: number | null;
  sleep_debt: number | null; missed_doses: number | null; myzenn_user: boolean; conditions: string[]; spark: number[];
}

export interface CurvePoint { hour: number; sbp: number; lo: number; hi: number; asleep: boolean }
export interface Projection { curve: CurvePoint[]; peak_sbp: number }

export interface Recommendation {
  id: string; name: string; myzenn_tool: string; description: string;
  risk_after: number; risk_reduction: number; peak_sbp_after: number;
}

export interface TwinView {
  patient_id: string; at: string; now_hour: number; risk: number;
  tier: { tier: Tier; label: string; action: string };
  explanation: {
    groups: { group: string; impact: number }[];
    top_features: { feature: string; label: string; group: string; value: number | null; impact: number }[];
  };
  sensitivities: Record<string, { value: number; sd: number }>;
  n_cuff_readings: number;
  phenotype: { primary: string; driver: string; shares: Record<string, number> };
  driver_contributions_mmHg: Record<string, number>;
  projection: Projection;
  recommendations: Recommendation[];
  sentinel_policy: { learned_pick: string; scores: Record<string, number> };
  risk_history: { t: string; hour: number; prob: number }[];
  live: boolean;
  snapshot: Record<string, number | null>;
}

export interface Streams {
  from: string; to: string; now_hour: number;
  hourly: { t: string; hour: number; hr: number | null; hrv: number | null; steps: number | null; stress: number | null;
            asleep: number; session: number | null; salt: number | null; mood: number | null }[];
  sleep: { date: string; total: number; deep: number; rem: number; light: number; awake_min: number; efficiency: number }[];
  cuff: { t: string; hour: number; sbp: number; dbp: number }[];
  doses: { date: string; taken: number; visible: boolean }[];
  ground_truth_events: { t: string; hour: number; duration_h: number; peak_sbp: number; future: boolean; driver: string }[];
}

export interface Scenario {
  sleep_extra_h: number; breathing_min: number; adherence: boolean; low_salt: boolean; steps_extra: number;
}

export interface SimResult {
  risk_before: number; risk_after: number; risk_reduction: number;
  projection_before: Projection; projection_after: Projection;
}

const SIM_START = new Date("2026-07-01T00:00:00");
const SIM_END_DAY = new Date("2026-08-29T00:00:00"); // demo clock's day in the synthetic timeline
// Show the synthetic timeline ending today, shifted by whole weeks so weekdays stay true
// (mirrors _set_display_shift in twin_engine/service.py).
const today = new Date(); today.setHours(0, 0, 0, 0);
const shiftWeeks = Math.max(0, Math.floor(Math.round((today.getTime() - SIM_END_DAY.getTime()) / 86400_000) / 7));
export const START = new Date(SIM_START.getTime() + shiftWeeks * 7 * 86400_000);
export const hourToDate = (h: number) => new Date(START.getTime() + h * 3600_000);
export const fmtHour = (h: number) =>
  hourToDate(h).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const pct = (p: number) => `${Math.round(p * 100)}%`;

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${await r.text()}`);
  return r.json();
}
const q = (at?: number | null) => (at != null ? `?at=${at}` : "");

export const api = {
  health: () => fetch("/api/health").then(j<{ now_hour: number; test_patients: number }>),
  roster: (at?: number | null) => fetch(`/api/patients${q(at)}`).then(j<RosterRow[]>),
  record: (id: string) => fetch(`/api/patients/${id}`).then(j<any>),
  streams: (id: string, at?: number | null) => fetch(`/api/patients/${id}/streams${q(at)}`).then(j<Streams>),
  twin: (id: string, at?: number | null) => fetch(`/api/patients/${id}/twin${q(at)}`).then(j<TwinView>),
  simulate: (id: string, scenario: Scenario, at?: number | null) =>
    fetch(`/api/patients/${id}/simulate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario, at }),
    }).then(j<SimResult>),
  actions: (id: string) => fetch(`/api/patients/${id}/actions`).then(j<any[]>),
  act: (id: string, body: { type: string; detail: string; intervention_id?: string }) =>
    fetch(`/api/patients/${id}/actions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(j<any[]>),
  live: (id: string, hr: number | null, hrv: number | null, source = "bluetooth", quality?: number) =>
    fetch(`/api/live/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hr, hrv, source, quality }),
    }).then(j<{ risk: number; samples: number; tier: Tier }>),
  liveHistory: (id: string) => fetch(`/api/live/${id}/history`).then(j<any>),
  presets: () => fetch("/api/stream/presets").then(j<any[]>),
  liveClear: (id: string) => fetch(`/api/live/${id}`, { method: "DELETE" }).then(j<any>),
  metrics: () => fetch("/api/model/metrics").then(j<any>),
};
