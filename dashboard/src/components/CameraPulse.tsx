import { useEffect, useRef, useState } from "react";
import { Camera, Square } from "lucide-react";
import { api, pct } from "../api";
import { RppgEstimate, RppgProcessor } from "../lib/rppg";

const SEND_EVERY_MS = 5000;
const MIN_QUALITY = 0.3;
// Skin reflects more red than green, and more green than blue, across skin tones. A box on a wall,
// a screen or a moving object fails this, so it can't produce a fake pulse.
const looksLikeSkin = (r: number, g: number, b: number) => r > 60 && r > g * 1.05 && g > b * 0.85 && r - b > 15;
// Forehead region inside the face guide (fractions of the video frame)
const ROI = { x: 0.4, y: 0.2, w: 0.2, h: 0.1 };

type Status = "idle" | "starting" | "warming" | "measuring" | "error";

export function CameraPulse({ id, enabled, onUpdate }: { id: string; enabled: boolean; onUpdate: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const procRef = useRef(new RppgProcessor());
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastSend = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [status, setStatus] = useState<Status>("idle");
  const [est, setEst] = useState<RppgEstimate | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [skin, setSkin] = useState(true);
  const skinRef = useRef(true);
  const [risk, setRisk] = useState<number | null>(null);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stop = (restore = true) => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    procRef.current.reset();
    setStatus("idle");
    setEst(null);
    if (restore) api.liveClear(id).then(() => { setRisk(null); setSent(0); onUpdate(); });
  };

  useEffect(() => () => stop(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (status !== "idle") stop(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setError(null);
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30, facingMode: "user" } });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setStatus("warming");
      loop();
    } catch (e: any) {
      setStatus("error");
      setError(e?.name === "NotAllowedError" ? "Camera access was blocked. Allow the camera in the address bar and try again."
        : "No camera found, or it is in use by another app.");
    }
  };

  const loop = () => {
    const v = videoRef.current;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    let lastEstimate = 0;
    const frame = () => {
      if (!v || !streamRef.current) return;
      if (v.readyState >= 2) {
        const w = v.videoWidth, h = v.videoHeight;
        const rw = Math.round(w * ROI.w), rh = Math.round(h * ROI.h);
        canvas.width = rw; canvas.height = rh;
        ctx.drawImage(v, Math.round(w * ROI.x), Math.round(h * ROI.y), rw, rh, 0, 0, rw, rh);
        const px = ctx.getImageData(0, 0, rw, rh).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
        const n = px.length / 4;
        r /= n; g /= n; b /= n;
        procRef.current.push(performance.now(), r, g, b);
        const bright = (r + g + b) / 3;
        const isSkin = looksLikeSkin(r, g, b);
        if (isSkin !== skinRef.current) { skinRef.current = isSkin; setSkin(isSkin); }
        setHint(!isSkin ? "No face in the teal box: centre your forehead in it"
          : bright < 45 ? "More light on your face, please" : bright > 235 ? "Too bright: move away from the light" : null);

        const now = performance.now();
        if (now - lastEstimate > 1000) {
          lastEstimate = now;
          const e = procRef.current.estimate();
          if (e) {
            setEst(e);
            setStatus("measuring");
            drawWave(e.wave);
            if (enabledRef.current && skinRef.current && e.quality >= MIN_QUALITY && now - lastSend.current > SEND_EVERY_MS) {
              lastSend.current = now;
              // Heart rate only: webcam RMSSD is too sensitive to beat-timing noise to drive the twin
              api.live(id, e.hr, null, "camera", e.quality).then(res => {
                setRisk(res.risk);
                setSent(s => s + 1);
                onUpdate();
              });
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
  };

  const drawWave = (wave: number[]) => {
    const c = waveRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const { width: W, height: H } = c;
    ctx.clearRect(0, 0, W, H);
    const max = Math.max(...wave.map(Math.abs), 1e-9);
    ctx.strokeStyle = "#c8412f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    wave.forEach((v, i) => {
      const x = (i / (wave.length - 1)) * W, y = H / 2 - (v / max) * (H / 2 - 4);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  };

  const good = !!est && est.quality >= MIN_QUALITY && skin;
  const active = status === "warming" || status === "measuring";

  return (
    <section className="panel" aria-labelledby="cam-h">
      <div className="panel-head">
        <h2 id="cam-h">Camera heart rate</h2>
        <span className="aside">No wearable needed: rPPG from the webcam</span>
      </div>
      <div className="cam">
        <div className="cam-view">
          <video ref={videoRef} muted playsInline aria-label="Camera preview" />
          {active && (
            <svg className="cam-guide" viewBox="0 0 100 75" preserveAspectRatio="none" aria-hidden>
              <ellipse cx="50" cy="36" rx="17" ry="25" fill="none" stroke="#fff" strokeWidth="0.6" strokeDasharray="2 1.5" />
              <rect x={ROI.x * 100} y={ROI.y * 75} width={ROI.w * 100} height={ROI.h * 75} fill="none" stroke="#009e9a" strokeWidth="0.7" />
            </svg>
          )}
          {!active && <div className="cam-placeholder"><Camera size={28} aria-hidden /></div>}
        </div>
        <div className="cam-side">
          {!active && (
            <>
              <p className="small muted">Sit still in good light, fit your face in the oval and keep the teal box on your forehead.
                About 10 seconds to lock on.</p>
              <button className="btn" onClick={start} disabled={status === "starting"}>
                <Camera size={14} aria-hidden /> Start camera
              </button>
              {!enabled && <p className="small muted" style={{ marginTop: 8 }}>Readings are shown but only sent to the twin when the twin clock is at now.</p>}
            </>
          )}
          {active && (
            <>
              <div className="cam-readout">
                <div><span className="v num">{est && skin ? est.hr : "–"}</span><span className="k">bpm</span></div>
                <div><span className="v num muted">{est && skin && est.quality >= 0.85 && est.hrv != null ? est.hrv : "–"}</span>
                  <span className="k">HRV ms (experimental)</span></div>
              </div>
              <canvas ref={waveRef} width={300} height={56} className="cam-wave" aria-label="Pulse waveform" />
              <div className="quality" aria-label={`Signal quality ${Math.round((est?.quality ?? 0) * 100)}%`}>
                <div style={{ width: `${Math.round((est?.quality ?? 0) * 100)}%`, background: good ? "var(--teal)" : "var(--amber)" }} />
              </div>
              <p className="small muted">
                {status === "warming" ? `Locking on… ${Math.round(procRef.current.seconds())} s` :
                  good ? `Good signal. ${sent} reading${sent === 1 ? "" : "s"} sent to the twin.` : "Weak signal: hold still, improve lighting."}
                {hint && <b style={{ color: "var(--amber)" }}> {hint}.</b>}
              </p>
              {risk != null && <p className="small"><b>Twin risk now {pct(risk)}</b></p>}
              <button className="btn ghost" onClick={() => stop()}><Square size={14} aria-hidden /> Stop and restore</button>
            </>
          )}
          {error && <p className="small" style={{ color: "var(--red)", marginTop: 8 }}>{error}</p>}
        </div>
      </div>
      <p className="footnote" style={{ marginTop: 10 }}>Video never leaves this browser; only the heart rate is sent to the twin.
        Camera HRV is shown for interest but not used: it is too sensitive to noise. For HRV, pair a Bluetooth strap.</p>
    </section>
  );
}
