import { useEffect, useState } from "react";
import { api } from "../api";

const LAB_NAME: Record<string, string> = {
  "4548-4": "HbA1c", "2345-7": "Glucose", "18262-6": "LDL cholesterol", "2085-9": "HDL cholesterol",
  "2571-8": "Triglycerides", "2160-0": "Creatinine", "33914-3": "eGFR", "2951-2": "Sodium", "2823-3": "Potassium",
  "9318-7": "Urine albumin/creatinine", "3016-3": "TSH", "8480-6": "Clinic systolic BP", "8462-4": "Clinic diastolic BP",
  "39156-5": "BMI",
};

export function Records({ id }: { id: string }) {
  const [r, setR] = useState<any>(null);
  useEffect(() => { setR(null); api.record(id).then(setR); }, [id]);
  if (!r) return <div className="empty">Loading health record…</div>;
  const p = r.patient;
  return (
    <>
      <div className="identity">
        <div>
          <h2>{p.FIRST} {p.LAST}</h2>
          <div className="facts">Synthetic EHR in Synthea-style tables with SNOMED-CT and LOINC codes.</div>
        </div>
      </div>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2>Demographics and lifestyle</h2></div>
          <dl className="kv">
            <dt>Born</dt><dd>{p.BIRTHDATE} ({p.AGE} years)</dd>
            <dt>Sex</dt><dd>{p.GENDER === "M" ? "Male" : "Female"}</dd>
            <dt>Location</dt><dd>{p.CITY}, {p.STATE}</dd>
            <dt>Occupation</dt><dd>{p.OCCUPATION}</dd>
            <dt>Height, weight</dt><dd>{p.HEIGHT_CM} cm, {p.WEIGHT_KG} kg (BMI {p.BMI})</dd>
            <dt>Diet</dt><dd>{p.DIET}, about {p.SALT_G_DAY} g salt a day</dd>
            <dt>Tobacco, alcohol</dt><dd>{p.TOBACCO ? "Yes" : "No"}, {p.ALCOHOL ? "Yes" : "No"}</dd>
            <dt>Clinic BP</dt><dd>{p.OFFICE_SBP}/{p.OFFICE_DBP} mmHg</dd>
          </dl>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Diagnoses</h2></div>
          <table>
            <thead><tr><th>Condition</th><th>SNOMED-CT</th><th>Since</th></tr></thead>
            <tbody>{r.conditions.map((c: any) => (
              <tr key={c.CODE}><td>{c.DESCRIPTION}</td><td className="num">{c.CODE}</td><td className="num">{c.START}</td></tr>
            ))}</tbody>
          </table>
          <div className="panel-head" style={{ marginTop: 18 }}><h2>Medications</h2></div>
          <table>
            <thead><tr><th>Drug</th><th>Class</th><th>Since</th></tr></thead>
            <tbody>{r.medications.map((m: any) => (
              <tr key={m.DESCRIPTION}><td>{m.DESCRIPTION}</td><td>{m.CLASS}</td><td className="num">{m.START}</td></tr>
            ))}</tbody>
          </table>
        </section>
      </div>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2>Lab results</h2><span className="aside">24, 12 and 3 months ago</span></div>
          <table>
            <thead><tr><th>Test</th><th>LOINC</th><th>History</th><th>Latest</th></tr></thead>
            <tbody>{r.labs.map((l: any) => (
              <tr key={l.code}>
                <td title={l.name}>{LAB_NAME[l.code] ?? l.name}</td><td className="num">{l.code}</td>
                <td className="num muted">{l.history.map((h: any) => h.value).join(", ")}</td>
                <td className="num"><b>{l.latest}</b> {l.unit}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Genetic markers</h2><span className="aside">BP-associated variants</span></div>
          <table>
            <thead><tr><th>Gene</th><th>Variant</th><th>rsID</th><th>Genotype</th></tr></thead>
            <tbody>{r.genomics.map((g: any) => (
              <tr key={g.GENE}>
                <td><b>{g.GENE}</b></td><td>{g.VARIANT}</td><td className="num">{g.RSID ?? "–"}</td>
                <td className="num">{g.GENE === "PRS" ? `z = ${g.RISK_ALLELES}` : g.GENOTYPE}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      </div>
    </>
  );
}
