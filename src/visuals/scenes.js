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
  { id: 'golden', name: 'Golden' },
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

// Two quality profiles. Light keeps the same look with fewer elements, a
// lower shader resolution and a cheap fake blur, for phones and slow machines.
export const QUALITY = {
  full: { gl: 1, swarm: 1, flow: 1, lineLayers: 5, linePts: 1100, blur: true, seeds: 1100 },
  light: { gl: 0.62, swarm: 0.45, flow: 0.45, lineLayers: 3, linePts: 560, blur: false, seeds: 520 },
};

export function createScenes(p) {
  let Q = QUALITY.full;
  let pg = null, shM = null, shT = null;
  let glOK = true;
  const sw = {};

  function makeGL() {
    if (!glOK) return;
    try {
      const q = (p.width * p.height > 2.0e6 ? 0.45 : 0.6) * Q.gl;
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
    const n = Math.round((p.width * p.height > 1.2e6 ? 2200 : 1400) * Q.swarm);
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
  const ln = { fy: 7, mx: 2, phi: 0 };
  // Orbit: yaw/pitch you can drag, with inertia and a slow drift of its own.
  const view = { yaw: 0, pitch: 0.35, vyaw: 0, vpitch: 0, zoom: 1 };
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
    // Inertia from a flick, then the figure keeps drifting slowly on its own.
    view.yaw += (view.vyaw + 0.06) * f.dt;
    view.pitch += view.vpitch * f.dt;
    view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch));
    const damp = Math.pow(0.15, f.dt);
    view.vyaw *= damp; view.vpitch *= damp;
    const R = md * 0.34 * (0.8 + 0.2 * f.b) * view.zoom;
    const layers = Q.lineLayers, N = Q.linePts;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    const cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const fov = md * 1.8;
    for (let L = 0; L < layers; L++) {
      const off = (L - (layers - 1) / 2) * (0.004 + 0.06 * chaos);
      const hue = (f.hue * 360 + L * (6 + 20 * chaos)) % 360;
      const col = `hsla(${hue.toFixed(0)},${(35 + 55 * coh).toFixed(0)}%,${(58 + 14 * coh).toFixed(0)}%,${(0.14 + 0.3 * coh).toFixed(3)})`;
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = Q.blur ? 2 + 16 * chaos : 0;
      ctx.lineWidth = 0.8 + 1.4 * coh;
      const path = new Path2D();
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU;
        const x = Math.sin(a * ln.fy + ln.phi + off) * Math.cos(a + off * 3);
        const y = Math.sin(a * (ln.fy - 1) + off * 2) * Math.cos(a * ln.mx);
        const z = Math.cos(a * ln.mx + off) * Math.sin(a * 2 + ln.phi * 0.5);
        const jx = chaos * md * 0.012 * (p.noise(i * 0.03, L * 3.1, f.T * 0.25) - 0.5);
        const jy = chaos * md * 0.012 * (p.noise(i * 0.03 + 40, L * 3.1, f.T * 0.25) - 0.5);
        const X = x * R * 1.2 + jx, Y = y * R + jy, Z = z * R * 0.9;
        const x1 = X * cyw + Z * syw, z1 = -X * syw + Z * cyw;
        const y2 = Y * cp - z1 * sp, z2 = Y * sp + z1 * cp;
        const s = fov / (fov + z2);
        const px = W / 2 + x1 * s, py = H / 2 + y2 * s;
        i ? path.lineTo(px, py) : path.moveTo(px, py);
      }
      if (!Q.blur && chaos > 0.15) {
        // Cheap stand-in for the blur: a wide, faint copy underneath.
        ctx.save();
        ctx.lineWidth = 2 + 14 * chaos;
        ctx.globalAlpha = 0.12 * chaos;
        ctx.stroke(path);
        ctx.restore();
      }
      ctx.stroke(path);
    }
    ctx.shadowBlur = 0;
  }

  // Flow: thousands of drifting threads in a noise field. Scattered, the
  // field is turbulent and the threads tangle; coherent, they fall into one
  // slow vortex around the centre. Breath sets the speed.
  const fl = { n: 0 };
  function initFlow() {
    const n = Math.round((p.width * p.height > 1.2e6 ? 2600 : 1600) * Q.flow);
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

  // Golden: the golden "snail". A golden rectangle cut into squares, a quarter
  // circle in each, spiralling inward forever. The figure is self-similar:
  // scale it by φ and turn it a quarter turn and it lands on itself, so the
  // zoom runs on without end. Several arms and their mirror images make a
  // vortex. Coherent: crisp, aligned, with smaller spirals nested in the
  // squares like a fractal. Scattered: the lines wobble, the arms drift out of
  // line and the colours split apart. Breathing in pulls you deeper.
  const PHI = (1 + Math.sqrt(5)) / 2;
  const GS = (() => {
    // Build squares from a large golden rectangle inward; each entry: square
    // corners and its arc (centre, radius, start and end angle).
    let x = 0, y = 0, w = PHI, h = 1;
    const sq = [];
    for (let k = 0; k < 40; k++) {
      const d = k % 4;
      if (d === 0) { const s = h; sq.push({ x, y, s, cx: x + s, cy: y + s, a0: Math.PI, a1: 1.5 * Math.PI }); x += s; w -= s; }
      else if (d === 1) { const s = w; sq.push({ x, y, s, cx: x, cy: y + s, a0: 1.5 * Math.PI, a1: 2 * Math.PI }); y += s; h -= s; }
      else if (d === 2) { const s = h; sq.push({ x: x + w - s, y, s, cx: x + w - s, cy: y, a0: 0, a1: 0.5 * Math.PI }); w -= s; }
      else { const s = w; sq.push({ x, y: y + h - s, s, cx: x + s, cy: y + h - s, a0: 0.5 * Math.PI, a1: Math.PI }); h -= s; }
    }
    const ex = x + w / 2, ey = y + h / 2; // where everything converges
    const v0 = [sq[0].x + sq[0].s / 2 - ex, sq[0].y + sq[0].s / 2 - ey];
    const v1 = [sq[1].x + sq[1].s / 2 - ex, sq[1].y + sq[1].s / 2 - ey];
    const turn = Math.atan2(v1[1], v1[0]) - Math.atan2(v0[1], v0[0]); // one step inward turns by this
    return { sq, ex, ey, turn };
  })();
  const gs = { T: 0, jit: 0 };
  function golden(f) {
    const ctx = p.drawingContext, W = p.width, H = p.height, cx = W / 2, cy = H / 2;
    const md = Math.min(W, H), coh = f.coh, chaos = 1 - coh;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(6,5,10,${0.22 + 0.18 * coh})`;
    ctx.fillRect(0, 0, W, H);
    // Breathing in carries you deeper; the zoom never stops.
    gs.T += f.dt * (0.05 + 0.22 * f.b);
    const fr = gs.T % 1, layer = Math.floor(gs.T);
    const unit = md * 0.55 * Math.pow(PHI, fr) * Math.pow(PHI, 6); // start ~6 squares outside the screen
    const rotZoom = -GS.turn * fr + f.T * 0.02;
    const arms = 3;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    // Colour split when scattered: three passes nudged apart.
    const split = chaos * chaos * md * 0.012;
    const passes = split > 0.6 ? [[split, 0, '255,90,90'], [-split, 0, '90,200,255'], [0, split, '140,255,160']] : [[0, 0, null]];
    for (const [ox, oy, tintRGB] of passes) {
      for (let arm = 0; arm < arms * 2; arm++) {
        const mirror = arm >= arms ? -1 : 1;
        const armAng = ((arm % arms) / arms) * TAU + chaos * 0.6 * (p.noise(arm * 7.1, f.T * 0.1) - 0.5);
        const ca = Math.cos(rotZoom + armAng), sa = Math.sin(rotZoom + armAng);
        const P = (u, v) => {
          const X = (u - GS.ex) * unit, Y = (v - GS.ey) * unit * mirror;
          return [cx + ox + X * ca - Y * sa, cy + oy + X * sa + Y * ca];
        };
        for (let k = 0; k < GS.sq.length; k++) {
          const q = GS.sq[k];
          const size = q.s * unit;
          if (size < 1.2) break;
          if (size > md * 4) continue;
          const depth = k + layer;
          const hue = ((f.hue + depth * 0.045 + (arm % arms) * 0.09) % 1) * 360;
          const alphaBase = (mirror < 0 ? 0.3 : 1) * (0.35 + 0.6 * coh) * Math.min(1, size / 30);
          ctx.strokeStyle = tintRGB ? `rgba(${tintRGB},${(alphaBase * 0.5).toFixed(3)})` : `hsla(${hue.toFixed(0)},${(45 + 50 * coh).toFixed(0)}%,${(60 + 12 * coh).toFixed(0)}%,${alphaBase.toFixed(3)})`;
          ctx.lineWidth = Math.max(0.7, Math.min(4.5, size * 0.009)) * (0.8 + 0.5 * f.b);
          // The arc, as a polyline so it can wobble when scattered.
          ctx.beginPath();
          const n = 26;
          for (let i = 0; i <= n; i++) {
            const a = q.a0 + ((q.a1 - q.a0) * i) / n;
            const wob = chaos * 0.12 * (p.noise(depth * 0.7 + i * 0.15, arm, f.T * 0.4) - 0.5);
            const [px, py] = P(q.cx + Math.cos(a) * q.s * (1 + wob), q.cy + Math.sin(a) * q.s * (1 + wob));
            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          }
          ctx.stroke();
          // The squares themselves, faint, only for the first arm.
          if (arm === 0 && !tintRGB) {
            ctx.strokeStyle = `hsla(${hue.toFixed(0)},50%,72%,${(alphaBase * 0.3).toFixed(3)})`;
            ctx.lineWidth = 0.8;
            const c1 = P(q.x, q.y), c2 = P(q.x + q.s, q.y), c3 = P(q.x + q.s, q.y + q.s), c4 = P(q.x, q.y + q.s);
            ctx.beginPath(); ctx.moveTo(...c1); ctx.lineTo(...c2); ctx.lineTo(...c3); ctx.lineTo(...c4); ctx.closePath(); ctx.stroke();
            // Fractal echo: a small golden spiral nested inside mid-sized squares.
            if (coh > 0.4 && size > 60 && size < md * 0.9 && Q.blur) {
              ctx.strokeStyle = `hsla(${((hue + 140) % 360).toFixed(0)},75%,75%,${((coh - 0.4) * 0.55).toFixed(3)})`;
              ctx.beginPath();
              for (let j = 0; j < 9; j++) {
                const r = GS.sq[j];
                const sc = q.s / PHI; // the nested spiral fills the square
                for (let i = 0; i <= 10; i++) {
                  const a = r.a0 + ((r.a1 - r.a0) * i) / 10;
                  const u = q.x + (r.cx + Math.cos(a) * r.s) * sc * 0.98 + q.s * 0.01;
                  const v = q.y + (r.cy + Math.sin(a) * r.s) * sc * 0.98 + q.s * 0.2;
                  const [px, py] = P(u, v);
                  (i || j) ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
                }
              }
              ctx.stroke();
            }
          }
        }
      }
    }
    // The eye: a glow where every spiral converges.
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, md * (0.05 + 0.05 * f.b));
    g.addColorStop(0, `hsla(${((f.hue + layer * 0.045) % 1 * 360).toFixed(0)},80%,85%,${(0.3 + 0.4 * coh).toFixed(3)})`);
    g.addColorStop(1, 'hsla(0,0%,0%,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - md * 0.1, cy - md * 0.1, md * 0.2, md * 0.2);
  }

  return {
    get glOK() { return glOK; },
    orbitBy(dx, dy) { view.yaw += dx * 0.008; view.pitch += dy * 0.008; view.vyaw = 0; view.vpitch = 0; },
    orbitRelease(vx, vy) { view.vyaw = Math.max(-6, Math.min(6, vx * 0.008)); view.vpitch = Math.max(-6, Math.min(6, vy * 0.008)); },
    zoomBy(dy) { view.zoom = Math.max(0.5, Math.min(2.2, view.zoom * Math.exp(-dy * 0.0012))); },
    resetView() { Object.assign(view, { yaw: 0, pitch: 0.35, vyaw: 0, vpitch: 0, zoom: 1 }); },
    resize() { makeGL(); initSwarm(); initFlow(); },
    setQuality(name) { Q = QUALITY[name] || QUALITY.full; },
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
      else if (s === 5) flow(f);
      else golden(f);
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
