/**
 * Remote photoplethysmography (rPPG): heart rate from a webcam.
 *
 * Each heartbeat changes skin colour very slightly. We average the RGB of a forehead region every frame,
 * then apply the POS projection (Wang et al., "Algorithmic principles of remote PPG", IEEE TBME 2017),
 * band-limit to 45–180 bpm, and read heart rate from the spectral peak. Beat-to-beat intervals from the
 * cleaned pulse wave give an approximate HRV (RMSSD).
 *
 * All processing happens in the browser. Only the numbers are sent to the twin.
 */

const FS = 30;             // resampling rate (Hz)
const WINDOW_S = 16;       // analysis window
const MIN_S = 8;           // minimum data before estimating
const BAND: [number, number] = [0.75, 3.0]; // 45–180 bpm

export interface RppgEstimate {
  hr: number;              // bpm
  hrv: number | null;      // RMSSD (ms), approximate
  quality: number;         // 0–1, share of in-band power at the pulse peak and its harmonic
  fps: number;
  wave: number[];          // last ~6 s of the cleaned pulse wave, for display
  beats: number;
}

// ── FFT (iterative radix-2, in place) ─────────────────────────────────
function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const mean = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
const std = (a: ArrayLike<number>) => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2; return Math.sqrt(s / a.length); };
const nextPow2 = (n: number) => 1 << Math.ceil(Math.log2(n));

export class RppgProcessor {
  private t: number[] = [];
  private rgb: [number, number, number][] = [];

  reset() { this.t = []; this.rgb = []; }

  /** Add one frame's mean ROI colour. `ts` in milliseconds. */
  push(ts: number, r: number, g: number, b: number) {
    this.t.push(ts);
    this.rgb.push([r, g, b]);
    const cutoff = ts - (WINDOW_S + 2) * 1000;
    while (this.t.length && this.t[0] < cutoff) { this.t.shift(); this.rgb.shift(); }
  }

  seconds() { return this.t.length > 1 ? (this.t[this.t.length - 1] - this.t[0]) / 1000 : 0; }

  estimate(): RppgEstimate | null {
    const dur = this.seconds();
    if (dur < MIN_S) return null;
    const fps = (this.t.length - 1) / dur;

    // 1. Resample to a uniform 30 Hz grid
    const t0 = this.t[this.t.length - 1] - Math.min(dur, WINDOW_S) * 1000;
    const N = Math.floor(Math.min(dur, WINDOW_S) * FS);
    const R = new Float64Array(N), G = new Float64Array(N), B = new Float64Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const ts = t0 + (i * 1000) / FS;
      while (j < this.t.length - 2 && this.t[j + 1] < ts) j++;
      const span = this.t[j + 1] - this.t[j] || 1;
      const w = Math.min(1, Math.max(0, (ts - this.t[j]) / span));
      R[i] = this.rgb[j][0] * (1 - w) + this.rgb[j + 1][0] * w;
      G[i] = this.rgb[j][1] * (1 - w) + this.rgb[j + 1][1] * w;
      B[i] = this.rgb[j][2] * (1 - w) + this.rgb[j + 1][2] * w;
    }

    // 2. POS projection with overlap-add over 1.6 s windows
    const L = Math.round(1.6 * FS);
    const H = new Float64Array(N);
    for (let n = 0; n + L <= N; n++) {
      const mr = mean(R.subarray(n, n + L)), mg = mean(G.subarray(n, n + L)), mb = mean(B.subarray(n, n + L));
      if (!mr || !mg || !mb) continue;
      const s1 = new Float64Array(L), s2 = new Float64Array(L);
      for (let k = 0; k < L; k++) {
        const cr = R[n + k] / mr, cg = G[n + k] / mg, cb = B[n + k] / mb;
        s1[k] = cg - cb;
        s2[k] = cg + cb - 2 * cr;
      }
      const alpha = std(s1) / (std(s2) || 1);
      const h = new Float64Array(L);
      for (let k = 0; k < L; k++) h[k] = s1[k] + alpha * s2[k];
      const mh = mean(h);
      for (let k = 0; k < L; k++) H[n + k] += h[k] - mh;
    }

    // 3. Spectrum → heart rate and signal quality
    const M = Math.max(2048, nextPow2(N));
    const re = new Float64Array(M), im = new Float64Array(M);
    for (let i = 0; i < N; i++) re[i] = H[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fft(re, im);
    const df = FS / M;
    const lo = Math.ceil(BAND[0] / df), hi = Math.floor(BAND[1] / df);
    let peak = lo, total = 0;
    const pow = (k: number) => re[k] * re[k] + im[k] * im[k];
    for (let k = lo; k <= hi; k++) { total += pow(k); if (pow(k) > pow(peak)) peak = k; }
    const f = peak * df;
    const bw = Math.round(0.1 / df);
    let sig = 0;
    for (let k = peak - bw; k <= peak + bw; k++) sig += pow(k);
    const h2 = Math.round(2 * peak);
    for (let k = h2 - bw; k <= h2 + bw && k < M / 2; k++) sig += pow(k);
    const quality = Math.min(1, sig / (total || 1));
    const hr = f * 60;

    // 4. Clean pulse wave: band-pass around the detected rate, then inverse FFT
    const re2 = new Float64Array(M), im2 = new Float64Array(M);
    for (let i = 0; i < N; i++) re2[i] = H[i];
    fft(re2, im2);
    // Fundamental ±0.4 Hz: keeps respiratory (HRV) modulation, rejects the harmonic and broadband noise
    const pass0 = Math.max(0.5, f - 0.4) / df, pass1 = (f + 0.4) / df;
    for (let k = 0; k < M; k++) {
      const kk = k <= M / 2 ? k : M - k;
      if (kk < pass0 || kk > pass1) { re2[k] = 0; im2[k] = 0; }
    }
    fft(re2, im2, true);
    const wave = Array.from(re2.subarray(0, N));

    // 5. Beat detection → inter-beat intervals → RMSSD
    const minGap = Math.round((0.6 * 60 / hr) * FS);
    const peaks: number[] = [];
    for (let i = 1; i < N - 1; i++) {
      if (wave[i] > 0 && wave[i] >= wave[i - 1] && wave[i] > wave[i + 1]) {
        if (peaks.length && i - peaks[peaks.length - 1] < minGap) {
          if (wave[i] > wave[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
        } else peaks.push(i);
      }
    }
    // Sub-sample peak position (parabolic interpolation): at 30 fps raw peaks are quantised to 33 ms,
    // which would swamp the real beat-to-beat variation.
    const refined = peaks.map(i => {
      const y0 = wave[i - 1], y1 = wave[i], y2 = wave[i + 1];
      const den = y0 - 2 * y1 + y2;
      return den === 0 ? i : i + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
    });
    const expected = 60000 / hr;
    const ibis = [];
    for (let i = 1; i < refined.length; i++) {
      const ibi = ((refined[i] - refined[i - 1]) * 1000) / FS;
      if (Math.abs(ibi - expected) < 0.25 * expected) ibis.push(ibi);
    }
    let hrv: number | null = null;
    if (ibis.length >= 6) {
      let s = 0;
      for (let i = 1; i < ibis.length; i++) s += (ibis[i] - ibis[i - 1]) ** 2;
      hrv = Math.min(150, Math.max(5, Math.sqrt(s / (ibis.length - 1))));
    }

    return { hr: Math.round(hr), hrv: hrv == null ? null : Math.round(hrv), quality, fps, wave: wave.slice(-6 * FS), beats: peaks.length };
  }
}
