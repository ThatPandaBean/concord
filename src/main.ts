import * as THREE from 'three';
import { startSync } from './sync';
import { COMMON, CORE_VS, FEYN_VS, FIELD_VS, GLOW_FS, GLOW_VS, SHELL_VS, SPRITE_FS, STAR_VS, STREAM_VS } from './shaders';

const MAX = 4; // windows that get an orb
// blue, red, yellow, paper: the open order picks the colour
const COLS = [[0.25, 0.55, 1], [1, 0.28, 0.32], [1, 0.82, 0.25], [0.96, 0.93, 0.85]];
const PAIRS = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
const SPRING = 120, DAMP = 14; // damping ratio ~0.64: a dragged window tows its orb with a little bounce

const sync = startSync();

const renderer = new THREE.WebGLRenderer({ antialias: false });
const dpr = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x03040a);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.Camera(); // unused: the shaders write clip space themselves

const uniforms = {
  uOrbs: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
  uCols: { value: COLS.map((c) => new THREE.Vector3(...c)) },
  uOrigin: { value: new THREE.Vector2() },
  uView: { value: new THREE.Vector2(innerWidth, innerHeight) },
  uScreen: { value: new THREE.Vector2(screen.width, screen.height) },
  uPair: { value: new Array<number>(PAIRS.length).fill(0) },
  uOv: { value: PAIRS.map(() => new THREE.Vector4()) },
  uTime: { value: 0 },
  uDpr: { value: dpr },
};

// Fixed seed: every window must generate the same random attributes, or the particles would not line up.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20231109);

function layer(vs: string, n: number, idx: (i: number) => [number, number]) {
  const r = new Float32Array(n * 4);
  const k = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 4; j++) r[i * 4 + j] = rnd();
    const [a, b] = idx(i);
    k.set([a, b, rnd()], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // dummy, sets the point count
  g.setAttribute('aR', new THREE.BufferAttribute(r, 4));
  g.setAttribute('aIdx', new THREE.BufferAttribute(k, 3));
  const m = new THREE.ShaderMaterial({
    uniforms, vertexShader: COMMON + vs, fragmentShader: SPRITE_FS,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  scene.add(p);
}

const glow = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms, vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }),
);
glow.frustumCulled = false;
scene.add(glow);

const perOrb = (i: number): [number, number] => [i % MAX, 0];
layer(STAR_VS, 12000, () => [0, 0]);
layer(SHELL_VS, 5000 * MAX, perOrb);
layer(FIELD_VS, 6000 * MAX, perOrb);
layer(CORE_VS, 1500 * MAX, perOrb);
const perPair = (i: number): [number, number] => [PAIRS[i % PAIRS.length][0], PAIRS[i % PAIRS.length][1]];
layer(STREAM_VS, 3000 * PAIRS.length, perPair);
layer(FEYN_VS, 4000 * PAIRS.length, perPair);

// UI
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status'), openBtn = $<HTMLButtonElement>('open'), warn = $('warn'), note = $('note');

if (matchMedia('(pointer: coarse)').matches) {
  openBtn.hidden = true;
  note.hidden = false;
  note.textContent = 'Phones only have one window, so there is nothing to link here. Open this page on a computer.';
}

openBtn.onclick = () => {
  const w = innerWidth, h = innerHeight;
  const aLeft = (screen as Screen & { availLeft?: number }).availLeft ?? 0;
  const aRight = aLeft + screen.availWidth;
  let left = screenX + outerWidth + 4; // right beside this window
  if (left + outerWidth > aRight) left = Math.max(aLeft, screenX - outerWidth - 4); // else on its left
  const win = window.open(location.href, '_blank', `popup=yes,width=${w},height=${h},left=${left},top=${screenY}`);
  if (!win) {
    note.hidden = false;
    note.textContent = 'The browser blocked the new window. Allow pop-ups for this site and try again.';
  }
};

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  uniforms.uView.value.set(innerWidth, innerHeight);
});

// Each window eases every orb itself, from the same broadcast targets.
const idPhase = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
};
type Orb = { x: number; y: number; r: number; vx: number; vy: number };
const orbs = new Map<string, Orb>();
let prev = performance.now();

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;

  const rect = sync.tick(); // live rect for this window; sends an update if it moved
  const peers = sync.peers();
  const all = [{ id: sync.id, opened: sync.opened, rect }, ...peers]
    .sort((a, b) => a.opened - b.opened || (a.id < b.id ? -1 : 1));
  const T = ((performance.timeOrigin + performance.now()) / 1000) % 1024; // shared wall clock
  uniforms.uTime.value = T;

  // The first four windows link up. A later window shows its own solo orb, like a lone instance.
  const mine = all.findIndex((w) => w.id === sync.id);
  const wins = mine < MAX ? all.slice(0, MAX) : [all[mine]];
  const colorOf = (i: number) => (mine < MAX ? i : mine) % COLS.length;

  const centre = wins.map((w) => ({ x: w.rect.x + w.rect.w / 2, y: w.rect.y + w.rect.h / 2, m: Math.min(w.rect.w, w.rect.h) }));
  const paired = wins.map(() => 0);
  const nearest = wins.map(() => -1);
  uniforms.uPair.value.fill(0);
  uniforms.uOv.value.forEach((v) => v.set(0, 0, 0, 0));
  for (let i = 0; i < wins.length; i++) {
    for (let j = i + 1; j < wins.length; j++) {
      const a = wins[i].rect, b = wins[j].rect;
      const d = Math.hypot(centre[i].x - centre[j].x, centre[i].y - centre[j].y);
      // paired when about a window width apart or closer, unpaired beyond about two
      const s = 1 - THREE.MathUtils.smoothstep(d / ((a.w + b.w) / 2), 1.4, 2.2);
      const k = i * (7 - i) / 2 + j - i - 1; // same index as pid() in the shaders
      uniforms.uPair.value[k] = s;
      paired[i] = Math.max(paired[i], s);
      paired[j] = Math.max(paired[j], s);
      for (const [p, q] of [[i, j], [j, i]]) {
        const o = nearest[p] < 0 ? Infinity : Math.hypot(centre[p].x - centre[nearest[p]].x, centre[p].y - centre[nearest[p]].y);
        if (d < o) nearest[p] = q;
      }
      const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
      const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
      if (x1 > x0 && y1 > y0) uniforms.uOv.value[k].set(x0, y0, x1 - x0, y1 - y0);
    }
  }

  const live = new Set<string>();
  wins.forEach((w, i) => {
    const c = centre[i];
    let tx = c.x, ty = c.y;
    if (nearest[i] < 0) {
      // alone: drift on its own (the phase comes from the window id, so every window agrees)
      const ph = idPhase(w.id), A = c.m * 0.14;
      const wall = (performance.timeOrigin + performance.now()) / 1000; // unwrapped, so no jump every 1024 s
      tx += Math.sin(wall * 0.37 + ph) * A;
      ty += Math.sin(wall * 0.53 + ph * 1.7) * A;
    } else {
      // unpaired: pushed away from the nearest orb, but kept inside the window
      const n = centre[nearest[i]];
      const d = Math.max(Math.hypot(c.x - n.x, c.y - n.y), 1);
      const push = (1 - paired[i]) * c.m * 0.3;
      tx += ((c.x - n.x) / d) * push;
      ty += ((c.y - n.y) / d) * push;
    }
    // paired orbs breathe in step (the shaders pulse brightness with the same clock)
    const tr = THREE.MathUtils.clamp(c.m * 0.17, 40, 160) * (1 + 0.07 * paired[i] * Math.sin(Math.PI * T));
    let o = orbs.get(w.id);
    if (!o) orbs.set(w.id, (o = { x: tx, y: ty, r: tr, vx: 0, vy: 0 }));
    live.add(w.id);
    o.vx += ((tx - o.x) * SPRING - o.vx * DAMP) * dt;
    o.vy += ((ty - o.y) * SPRING - o.vy * DAMP) * dt;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    o.r += (tr - o.r) * (1 - Math.exp(-dt * 8));
    uniforms.uOrbs.value[i].set(o.x, o.y, o.r, 1);
    uniforms.uCols.value[i].set(...(COLS[colorOf(i)] as [number, number, number]));
  });
  for (let i = wins.length; i < MAX; i++) uniforms.uOrbs.value[i].set(0, 0, 0, 0);
  for (const id of orbs.keys()) if (!live.has(id)) orbs.delete(id);

  uniforms.uOrigin.value.set(rect.x, rect.y);

  const text = `${all.length} window${all.length === 1 ? '' : 's'}`
    + (all.length > MAX ? ` (only ${MAX} link up${mine < MAX ? '' : ', this one is solo'})` : '');
  if (status.textContent !== text) status.textContent = text;
  warn.hidden = !peers.some((p) => Math.abs(p.rect.x - rect.x) < 1 && Math.abs(p.rect.y - rect.y) < 1);

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
