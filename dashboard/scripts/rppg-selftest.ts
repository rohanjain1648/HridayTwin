// Validates the rPPG pipeline on synthetic camera data with a known heart rate.
//   node --experimental-strip-types scripts/rppg-selftest.ts
import { RppgProcessor } from "../src/lib/rppg.ts";

function run(bpm: number, noise: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const p = new RppgProcessor();
  let t = 0, phase = 0;
  const ibis: number[] = [];
  let nextBeat = 0;
  for (let i = 0; i < 20 * 30; i++) {
    t += 1000 / 30 + gauss() * 3;                      // frame jitter
    const inst = bpm * (1 + 0.04 * Math.sin(t / 4000)); // respiratory sinus arrhythmia → HRV
    phase += (2 * Math.PI * inst / 60) * (1000 / 30) / 1000;
    const pulse = Math.sin(phase) + 0.3 * Math.sin(2 * phase);
    const drift = 1 + 0.02 * Math.sin(t / 7000);          // lighting drift
    // blood volume pulse is strongest in green, weaker in red/blue (skin optics)
    const r = (180 + 0.25 * pulse) * drift + gauss() * noise;
    const g = (130 + 0.5 * pulse) * drift + gauss() * noise;
    const b = (110 + 0.15 * pulse) * drift + gauss() * noise;
    p.push(t, r, g, b);
    if (t > nextBeat) { ibis.push(60000 / inst); nextBeat = t + 60000 / inst; }
  }
  const e = p.estimate()!;
  const last = ibis.slice(-18);
  let ss = 0;
  for (let i = 1; i < last.length; i++) ss += (last[i] - last[i - 1]) ** 2;
  const trueRmssd = Math.round(Math.sqrt(ss / (last.length - 1)));
  return { bpm, noise, hr: e.hr, hrv: e.hrv, true_hrv: trueRmssd, quality: +e.quality.toFixed(2), fps: +e.fps.toFixed(1), err: Math.abs(e.hr - bpm) };
}

const cases = [[62, 0.3], [72, 0.3], [88, 0.5], [110, 0.5], [72, 1.0], [95, 1.5]];
const res = cases.map(([b, n], i) => run(b, n, 12345 + i));
console.table(res);
const worst = Math.max(...res.map(r => r.err));
console.log(worst <= 3 ? `PASS: max HR error ${worst} bpm` : `FAIL: max HR error ${worst} bpm`);
console.log("Note: camera HRV inflates quickly with noise, so the console sends heart rate only; HRV comes from Bluetooth RR intervals.");
if (worst > 3) process.exit(1);
