// The rooms. Each scene draws one frame from:
//   b    breath 0 (empty) … 1 (full) from the pacer
//   coh  coherence 0 (scattered) … 1 (ordered), already smoothed
//   hr   heart rate (bpm, smoothed), hrv beat-to-beat variability (RMSSD, ms)
// Nothing fires on single heartbeats: the scenes follow breath and the slow
// state of the heart, which is calmer to watch and kinder to sensitive eyes.
// Low coherence looks restless and greyed, high coherence symmetric and lit.

export const SCENES = [
  { id: 'mandala', name: 'Mandala' },
  { id: 'tunnel', name: 'Tunnel' },
  { id: 'swarm', name: 'Swarm' },
  { id: 'moire', name: 'Moiré' },
  { id: 'lines', name: 'Lines' },
  { id: 'flow', name: 'Flow' },
];

const TAU = Math.PI * 2;

const VERT = `
attribute vec3 aPosition; attribute vec2 aTexCoord; varying vec2 vUv;
void main(){ vUv = aTexCoord; vec4 p = vec4(aPosition, 1.0); p.xy = p.xy * 2.0 - 1.0; gl_Position = p; }`;

const COMMON = `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes; uniform float uTime, uBreath, uCoh, uHue, uTravel;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++){ v += a*noise(p); p = m*p; a *= 0.5; } return v; }
vec3 pal(float t){ return 0.5 + 0.5*cos(6.28318*(t + vec3(0.0, 0.33, 0.67) + uHue)); }
vec2 coords(){ return (vUv - 0.5) * uRes / min(uRes.x, uRes.y) * 2.0; }
`;

const FRAG_MANDALA = COMMON + `
void main(){
  vec2 p = coords();
  float chaos = 1.0 - uCoh;
  p += chaos * 0.22 * vec2(fbm(p*1.5 + uTime*0.3) - 0.5, fbm(p*1.5 - uTime*0.27 + 7.0) - 0.5);
  float r = length(p);
  float a = atan(p.y, p.x) + uTime*0.04;
  float seg = 6.28318 / 10.0;
  a = mod(a, seg); a = abs(a - seg*0.5);
  float zoom = mix(1.35, 0.72, uBreath);
  vec2 q = vec2(cos(a), sin(a)) * r * zoom;
  float t = uTime * 0.12;
  vec2 w = vec2(fbm(q*2.0 + t), fbm(q*2.0 - t + 3.1));
  float f = fbm(q*3.0 + w*2.2 + vec2(0.0, -t*2.0));
  float rings = sin(log(r + 0.02)*9.0 - uTime*0.6 + f*4.0)*0.5 + 0.5;
  float v = f*0.75 + rings*0.35;
  vec3 col = pal(v*1.3 + r*0.25 - uTime*0.02);
  float g = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(g), col, 0.4 + 0.6*uCoh);
  col *= 0.3 + 1.15*pow(rings, 3.0)*(0.6 + 0.6*uBreath) + 0.5*smoothstep(0.55, 0.9, f);
  col += vec3(1.0, 0.92, 0.97) * exp(-r*mix(9.0, 3.2, uBreath)) * 0.6;
  col *= smoothstep(1.9, 0.35, r);
  gl_FragColor = vec4(col, 1.0);
}`;

const FRAG_TUNNEL = COMMON + `
void main(){
  vec2 p = coords();
  float chaos = 1.0 - uCoh;
  p += chaos * 0.22 * vec2(sin(uTime*0.41), cos(uTime*0.33));
  p *= mix(1.3, 0.78, uBreath);
  float r = length(p);
  float a = atan(p.y, p.x);
  float z = 0.35 / (r + 0.001) + uTravel;
  float twist = chaos * 2.4 * sin(uTime*0.2);
  float ang = a + z*(0.25 + twist)*0.5;
  float bands = sin(z*6.28318)*0.5 + 0.5;
  float spokes = sin(ang*9.0)*0.5 + 0.5;
  float n = fbm(vec2(cos(a), sin(a))*1.5 + vec2(z*0.6, uTime*0.05));
  float v = mix(bands*spokes, n, 0.2 + 0.45*chaos);
  vec3 col = pal(z*0.07 + v*0.3);
  float g = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(g), col, 0.45 + 0.55*uCoh);
  col *= 0.2 + 1.25*pow(v, 1.5);
  col *= smoothstep(0.015, 0.45, r);
  col += pal(uTime*0.03 + 0.5) * exp(-r*8.0) * (0.35 + 0.9*uBreath);
  col *= smoothstep(2.1, 0.6, r);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createScenes(p) {
  let pg = null, shM = null, shT = null;
  let glOK = true;
  const sw = {};

  function makeGL() {
    if (!glOK) return;
    try {
      const q = p.width * p.height > 2.0e6 ? 0.45 : 0.6;
      if (pg) pg.remove();
      pg = p.createGraphics(Math.max(2, Math.floor(p.width * q)), Math.max(2, Math.floor(p.height * q)), p.WEBGL);
      pg.pixelDensity(1);
      pg.noStroke();
      shM = pg.createShader(VERT, FRAG_MANDALA);
      shT = pg.createShader(VERT, FRAG_TUNNEL);
    } catch (e) {
      glOK = false; pg = null;
    }
  }

  function initSwarm() {
    const n = p.width * p.height > 1.2e6 ? 2200 : 1400;
    sw.n = n;
    sw.a = new Float32Array(n); sw.r = new Float32Array(n); sw.k = new Float32Array(n);
    sw.s = new Float32Array(n); sw.x = new Float32Array(n); sw.y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      sw.a[i] = Math.random() * TAU;
      sw.k[i] = 0.25 + Math.pow(Math.random(), 0.7) * 0.95;
      sw.r[i] = sw.k[i] * Math.min(p.width, p.height) * 0.2;
      sw.s[i] = (0.4 + Math.random()) * (Math.random() < 0.5 ? 1 : 0.85);
    }
  }

  function shader(sh, f) {
    pg.shader(sh);
    sh.setUniform('uRes', [pg.width, pg.height]);
    sh.setUniform('uTime', f.T);
    sh.setUniform('uBreath', f.b);
    sh.setUniform('uCoh', f.coh);
    sh.setUniform('uHue', f.hue);
    sh.setUniform('uTravel', f.travel);
    pg.rect(0, 0, pg.width, pg.height);
    p.drawingContext.globalCompositeOperation = 'source-over';
    p.image(pg, 0, 0, p.width, p.height);
  }

  function swarm(f) {
    const ctx = p.drawingContext, W = p.width, H = p.height, cx = W / 2, cy = H / 2, md = Math.min(W, H);
    const chaos = 1 - f.coh, b = f.b, T = f.T, dt = f.dt;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(6,5,10,${0.12 + 0.1 * chaos})`;
    ctx.fillRect(0, 0, W, H);
    const R = md * 0.42 * (0.38 + 0.62 * b);
    for (let i = 0; i < sw.n; i++) {
      sw.r[i] += (R * sw.k[i] - sw.r[i]) * Math.min(1, dt * (1.2 + sw.k[i]));
      const nz = p.noise(Math.cos(sw.a[i]) * 0.8 + 3, sw.k[i] * 3, T * 0.15) - 0.5;
      sw.a[i] += dt * (sw.s[i] * (0.12 + 0.35 * (1 - b)) + nz * chaos * 2.4);
      const rose = 1 + 0.32 * f.coh * Math.cos(6 * sw.a[i] + T * 0.25);
      const rr = sw.r[i] * rose + chaos * md * 0.24 * nz;
      sw.x[i] = cx + Math.cos(sw.a[i]) * rr;
      sw.y[i] = cy + Math.sin(sw.a[i]) * rr;
    }
    ctx.globalCompositeOperation = 'lighter';
    const base = (f.hue * 360) % 360, buckets = 7, sat = 40 + 55 * f.coh;
    for (let j = 0; j < buckets; j++) {
      ctx.fillStyle = `hsla(${base + j * (18 + 30 * chaos)},${sat}%,62%,0.55)`;
      for (let i = j; i < sw.n; i += buckets) ctx.fillRect(sw.x[i], sw.y[i], 1.8, 1.8);
    }
  }

  function moire(f) {
    const ctx = p.drawingContext, W = p.width, H = p.height, cx = W / 2, cy = H / 2, md = Math.min(W, H);
    const chaos = 1 - f.coh, T = f.T;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(6,5,10,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const sp = md * 0.028, sep = md * (0.008 + 0.15 * chaos);
    const off = f.b * sp * 5 + T * sp * 0.15;
    const maxR = Math.hypot(W, H) * 0.6;
    const base = (f.hue * 360) % 360;
    ctx.lineWidth = sp * 0.42;
    for (let k = 0; k < 3; k++) {
      const ang = T * 0.11 + k * 2.0944;
      const ox = cx + Math.cos(ang) * sep, oy = cy + Math.sin(ang * 1.3) * sep;
      ctx.strokeStyle = `hsla(${base + k * 120},${55 + 40 * f.coh}%,52%,0.75)`;
      ctx.beginPath();
      for (let r = (off % sp) + sp * 0.5; r < maxR; r += sp) { ctx.moveTo(ox + r, oy); ctx.arc(ox, oy, r, 0, TAU); }
      ctx.stroke();
    }
  }

  // Lines: a harmonograph. Its frequencies come from your heart rate (72 bpm
  // gives 7.2) and its modulation from your variability. Coherence pulls the
  // frequencies onto whole numbers, so the figure closes into a clean,
  // symmetric knot; when scattered they drift between whole numbers, the curve
  // stays open and the strands smear apart into a soft blur.
  const ln = { fy: 7, mx: 2, phi: 0, rot: 0 };
  function lines(f) {
    const ctx = p.drawingContext, W = p.width, H = p.height, md = Math.min(W, H);
    const coh = f.coh, chaos = 1 - coh;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(6,5,10,${0.1 + 0.3 * coh})`;
    ctx.fillRect(0, 0, W, H);
    const k = Math.min(1, f.dt * 0.35);
    const rawY = Math.max(4, Math.min(13, (f.hr || 66) / 10));
    const rawM = 1 + Math.max(0, Math.min(4, (f.hrv || 30) / 15));
    const snap = (v) => v + (Math.round(v) - v) * Math.min(1, coh * 1.15);
    ln.fy += (snap(rawY) - ln.fy) * k;
    ln.mx += (snap(rawM) - ln.mx) * k;
    ln.phi += f.dt * (0.04 + 0.1 * chaos);
    ln.rot += f.dt * 0.01;
    const R = md * 0.34 * (0.8 + 0.2 * f.b);
    const layers = 5, N = 1100;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    const cr = Math.cos(ln.rot), sr = Math.sin(ln.rot);
    for (let L = 0; L < layers; L++) {
      const off = (L - (layers - 1) / 2) * (0.004 + 0.06 * chaos);
      const hue = (f.hue * 360 + L * (6 + 20 * chaos)) % 360;
      const col = `hsla(${hue.toFixed(0)},${(35 + 55 * coh).toFixed(0)}%,${(58 + 14 * coh).toFixed(0)}%,${(0.14 + 0.3 * coh).toFixed(3)})`;
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 2 + 16 * chaos;
      ctx.lineWidth = 0.8 + 1.4 * coh;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU;
        const x = Math.sin(a * ln.fy + ln.phi + off) * Math.cos(a + off * 3);
        const y = Math.sin(a * (ln.fy - 1) + off * 2) * Math.cos(a * ln.mx);
        const jx = chaos * md * 0.012 * (p.noise(i * 0.03, L * 3.1, f.T * 0.25) - 0.5);
        const jy = chaos * md * 0.012 * (p.noise(i * 0.03 + 40, L * 3.1, f.T * 0.25) - 0.5);
        const X = x * R * 1.25 + jx, Y = y * R + jy;
        const px = W / 2 + X * cr - Y * sr, py = H / 2 + X * sr + Y * cr;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  // Flow: thousands of drifting threads in a noise field. Scattered, the
  // field is turbulent and the threads tangle; coherent, they fall into one
  // slow vortex around the centre. Breath sets the speed.
  const fl = { n: 0 };
  function initFlow() {
    const n = p.width * p.height > 1.2e6 ? 2600 : 1600;
    fl.n = n;
    fl.x = new Float32Array(n); fl.y = new Float32Array(n); fl.s = new Float32Array(n);
    for (let i = 0; i < n; i++) { fl.x[i] = Math.random() * p.width; fl.y[i] = Math.random() * p.height; fl.s[i] = 0.5 + Math.random(); }
  }
  function flow(f) {
    const ctx = p.drawingContext, W = p.width, H = p.height, cx = W / 2, cy = H / 2, md = Math.min(W, H);
    const coh = f.coh, chaos = 1 - coh;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(6,5,10,${0.035 + 0.04 * chaos})`;
    ctx.fillRect(0, 0, W, H);
    const scale = md * (0.22 + 0.25 * coh);
    const speed = (0.5 + 1.6 * f.b) * (60 * f.dt);
    const buckets = 5;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 0.6 + 0.6 * coh;
    const paths = Array.from({ length: buckets }, () => new Path2D());
    for (let i = 0; i < fl.n; i++) {
      const x = fl.x[i], y = fl.y[i];
      const na = p.noise(x / scale, y / scale, f.T * 0.04) * TAU * (1.5 + 2 * chaos);
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) + 1;
      const ta = Math.atan2(dy, dx) + Math.PI / 2 + 0.25 * (r / md - 0.35);
      const w = coh * coh;
      const vx = Math.cos(na) * (1 - w) + Math.cos(ta) * w, vy = Math.sin(na) * (1 - w) + Math.sin(ta) * w;
      const nx = x + vx * speed * fl.s[i], ny = y + vy * speed * fl.s[i];
      const path = paths[i % buckets];
      path.moveTo(x, y); path.lineTo(nx, ny);
      if (nx < 0 || nx > W || ny < 0 || ny > H || Math.random() < 0.002) { fl.x[i] = Math.random() * W; fl.y[i] = Math.random() * H; }
      else { fl.x[i] = nx; fl.y[i] = ny; }
    }
    for (let j = 0; j < buckets; j++) {
      ctx.strokeStyle = `hsla(${((f.hue * 360 + j * (10 + 26 * chaos)) % 360).toFixed(0)},${(40 + 50 * coh).toFixed(0)}%,62%,${(0.22 + 0.25 * f.b).toFixed(3)})`;
      ctx.stroke(paths[j]);
    }
  }

  return {
    get glOK() { return glOK; },
    resize() { makeGL(); initSwarm(); initFlow(); },
    clear() { p.background(6, 5, 10); },
    /** f: {scene, b, coh, T, dt, hue, travel} */
    draw(f) {
      let s = f.scene;
      if ((s === 0 || s === 1) && !pg) s = 2;
      if (s === 0) shader(shM, f);
      else if (s === 1) shader(shT, f);
      else if (s === 2) swarm(f);
      else if (s === 3) moire(f);
      else if (s === 4) lines(f);
      else flow(f);
    },
  };
}

/**
 * The pacer as a wave across the screen. The breath ahead of you scrolls in
 * from the right, a ball rides the wave at the centre: up while you breathe
 * in, along the top while you hold, down while you breathe out. Both ends
 * fade into the dark.
 * bAt(t): breath depth 0..1 at pacer time t; now: current pacer time;
 * cycle: seconds per breath.
 */
export function drawWaveGuide(p, bAt, now, cycle, active) {
  const ctx = p.drawingContext, W = p.width, H = p.height, md = Math.min(W, H);
  const cy = H / 2, amp = md * 0.13, span = cycle * 2.2;
  const yAt = (t) => cy + amp * (1 - 2 * bAt(t));
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'round';
  const seg = 90;
  for (let k = 0; k < seg; k++) {
    const x0 = (k / seg) * W, x1 = ((k + 1) / seg) * W;
    const mid = (x0 + x1) / 2 / W - 0.5;
    const e = Math.max(0, 1 - Math.abs(mid) * 2);
    const fade = e * e * (3 - 2 * e);
    if (fade <= 0.01) continue;
    ctx.strokeStyle = `rgba(239,234,255,${(0.42 * fade).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let j = 0; j <= 6; j++) {
      const x = x0 + ((x1 - x0) * j) / 6;
      const y = yAt(now + ((x - W / 2) / W) * span);
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  const by = yAt(now);
  const g = ctx.createRadialGradient(W / 2, by, 0, W / 2, by, 22);
  g.addColorStop(0, 'rgba(239,234,255,0.55)');
  g.addColorStop(1, 'rgba(239,234,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(W / 2, by, 22, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(239,234,255,0.95)';
  ctx.beginPath(); ctx.arc(W / 2, by, active ? 7 : 5.5, 0, TAU); ctx.fill();
  ctx.restore();
}

/** The pacer ring drawn over any scene. */
export function drawGuide(p, br, active) {
  const ctx = p.drawingContext, md = Math.min(p.width, p.height), cx = p.width / 2, cy = p.height / 2;
  ctx.globalCompositeOperation = 'source-over';
  const outer = md * 0.32;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(239,234,255,0.12)';
  ctx.beginPath(); ctx.arc(cx, cy, outer, 0, TAU); ctx.stroke();
  ctx.lineWidth = active ? 2.5 : 1.5;
  ctx.strokeStyle = `rgba(239,234,255,${active ? 0.75 : 0.4})`;
  ctx.beginPath(); ctx.arc(cx, cy, md * (0.07 + 0.25 * br.b), 0, TAU); ctx.stroke();
  const a = -Math.PI / 2 + TAU * br.cyc;
  ctx.fillStyle = 'rgba(239,234,255,0.8)';
  ctx.beginPath(); ctx.arc(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer, 2.5, 0, TAU); ctx.fill();
}
