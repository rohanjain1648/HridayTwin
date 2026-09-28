import { useEffect, useRef, useState } from "react";
import { Bluetooth, Radio, Square } from "lucide-react";
import { api, pct } from "../api";
import { useBiometricDevice } from "../hooks/useBiometricDevice"; // reused from MyZenn (MyPulse)

/** Streams a real BLE heart-rate strap/watch (or a demo stream) into the twin and shows the risk update. */
export function LiveDevice({ id, enabled, onUpdate }: { id: string; enabled: boolean; onUpdate: () => void }) {
  const dev = useBiometricDevice();
  const [demo, setDemo] = useState(false);
  const [risk, setRisk] = useState<number | null>(null);
  const [last, setLast] = useState<{ hr: number | null; hrv: number | null } | null>(null);
  const lastSent = useRef(0);

  const send = (hr: number | null, hrv: number | null, source: string) => {
    setLast({ hr, hrv });
    api.live(id, hr, hrv, source).then(r => { setRisk(r.risk); onUpdate(); });
  };

  // Real device: forward a sample every 5 s
  useEffect(() => {
    if (dev.data.source !== "bluetooth" || dev.data.heartRate == null) return;
    const now = Date.now();
    if (now - lastSent.current < 5000) return;
    lastSent.current = now;
    send(dev.data.heartRate, dev.data.hrv, "bluetooth");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dev.data]);

  // Demo stream: a patient under acute stress (HR up, HRV down)
  useEffect(() => {
    if (!demo) return;
    let k = 0;
    const tick = () => {
      k++;
      send(Math.round(92 + Math.random() * 8 + k * 0.5), Math.round(Math.max(9, 17 - k * 0.6 + Math.random() * 3)), "demo");
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, id]);

  const stop = () => {
    setDemo(false);
    dev.disconnect();
    api.liveClear(id).then(() => { setRisk(null); setLast(null); onUpdate(); });
  };
  const active = demo || dev.isConnected;

  return (
    <section className="panel" aria-labelledby="live-h">
      <div className="panel-head">
        <h2 id="live-h">Bluetooth heart-rate device</h2>
        <span className="aside">Web Bluetooth strap or watch (MyZenn MyPulse)</span>
      </div>
      {!enabled && <p className="small muted">Live streaming works on the current clock. Return the twin clock to now to connect.</p>}
      {enabled && (
        <div className="live">
          {!active && (
            <>
              <button className="btn" onClick={() => dev.connect()} disabled={!dev.supportsBluetooth || dev.isConnecting}>
                <Bluetooth size={14} aria-hidden /> {dev.isConnecting ? "Pairing…" : "Pair a heart-rate device"}
              </button>
              <button className="btn ghost" onClick={() => setDemo(true)}><Radio size={14} aria-hidden /> Play a stressed demo stream</button>
            </>
          )}
          {active && (
            <>
              <span className="pulse" aria-hidden />
              <span className="num">HR {last?.hr ?? "–"} bpm, HRV {last?.hrv ?? "–"} ms</span>
              {risk != null && <b className="num">Risk now {pct(risk)}</b>}
              <button className="btn ghost" onClick={stop}><Square size={14} aria-hidden /> Stop and restore</button>
            </>
          )}
        </div>
      )}
      {dev.error && <p className="small" style={{ color: "var(--red)", marginTop: 8 }}>{dev.error}</p>}
      {enabled && !dev.supportsBluetooth && !active &&
        <p className="small muted" style={{ marginTop: 8 }}>This browser has no Web Bluetooth. Use Chrome or Edge, or play the demo stream.</p>}
    </section>
  );
}
