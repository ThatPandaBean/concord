import * as THREE from 'three';
import { phaseNow, startSync, wall, type Peer } from './sync';
import { createChoir, RATIOS, ROOT_HZ } from './choir';
import { COMMON, CORE_VS, FEYN_VS, FIELD_VS, GLOW_FS, GLOW_VS, SHELL_VS, SPRITE_FS, STAR_VS, STREAM_VS } from './shaders';

const MAX = 4; // windows that get an orb
const TAU = Math.PI * 2;
// blue, red, yellow, paper: the open order picks the colour (and the note)
const COLS = [[0.25, 0.55, 1], [1, 0.28, 0.32], [1, 0.82, 0.25], [0.96, 0.93, 0.85]];
const NAMES = ['blue', 'red', 'yellow', 'paper'];
const PAIRS = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
const pairIndex = (a: number, b: number) => { // same as pid() in the shaders
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return (lo * (7 - lo)) / 2 + hi - lo - 1;
};
const SPRING = 120, DAMP = 14; // damping ratio ~0.64: a dragged window tows its orb with a little bounce
const COUPLING = 1; // rad/s of pull between fully paired orbs; two orbs lock when 2 * pull beats their rhythm difference

const sync = startSync();
const choir = createChoir();

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
  uFlow: { value: new Array<number>(PAIRS.length).fill(0) },
  uPhase: { value: new Array<number>(MAX).fill(0) },
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
const status = $('status'), openBtn = $<HTMLButtonElement>('open'), soundBtn = $<HTMLButtonElement>('sound');
const warn = $('warn'), note = $('note'), hud = $('hud');

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

soundBtn.onclick = async () => {
  soundBtn.textContent = (await choir.toggle()) ? 'Sound on' : 'Sound off';
};

// Scroll to grow or shrink this window's economy. Bigger economies trade more and sing louder.
addEventListener('wheel', (e) => {
  sync.self.m = THREE.MathUtils.clamp(sync.self.m * Math.exp(-e.deltaY * 0.0015), 0.4, 3.5);
}, { passive: true });

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  uniforms.uView.value.set(innerWidth, innerHeight);
});

// A stable 0..1 number per window id, the same in every window
const idFrac = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0) / 4294967296;
};
// Each window has its own rhythm, set by its open order: 0.4, 0.5, 0.6, 0.7 Hz. Neighbours differ by about
// 0.63 rad/s, which the coupling beats only when they are close, so distance visibly breaks the lock.
const naturalRate = (ci: number) => TAU * (0.4 + 0.1 * ci);

// Each window eases every orb itself, from the same broadcast targets.
type Orb = { x: number; y: number; r: number; vx: number; vy: number };
const orbs = new Map<string, Orb>();
let prev = performance.now();
let hudAt = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;

  const me = sync.self;
  const rect = sync.tick(); // live rect for this window; sends an update if it moved
  const nowMs = wall();
  const T = (nowMs / 1000) % 1024; // shared wall clock
  uniforms.uTime.value = T;

  const peers = sync.peers();
  const self: Peer = { id: sync.id, opened: sync.opened, rect, m: me.m, ph: me.ph, w: me.w, at: nowMs };
  const all = [self, ...peers].sort((a, b) => a.opened - b.opened || (a.id < b.id ? -1 : 1));

  // The first four windows link up. A later window shows its own solo orb, like a lone instance.
  const mine = all.findIndex((w) => w.id === sync.id);
  const wins = mine < MAX ? all.slice(0, MAX) : [self];
  const colorOf = (i: number) => (mine < MAX ? i : mine) % COLS.length;
  const slot = wins.findIndex((w) => w.id === sync.id);

  const centre = wins.map((w) => ({ x: w.rect.x + w.rect.w / 2, y: w.rect.y + w.rect.h / 2, px: Math.min(w.rect.w, w.rect.h) }));
  const paired = wins.map(() => 0); // 0..1, how close each orb is to another (drives sync, repel, pitch)
  const nearest = wins.map(() => -1);
  const pairS = new Array<number>(PAIRS.length).fill(0);
  uniforms.uFlow.value.fill(0);
  uniforms.uOv.value.forEach((v) => v.set(0, 0, 0, 0));
  for (let i = 0; i < wins.length; i++) {
    for (let j = i + 1; j < wins.length; j++) {
      const a = wins[i], b = wins[j];
      const d = Math.hypot(centre[i].x - centre[j].x, centre[i].y - centre[j].y);
      const dn = d / ((a.rect.w + b.rect.w) / 2); // distance in window widths
      const s = 1 - THREE.MathUtils.smoothstep(dn, 1.4, 2.2); // paired when about a width apart or closer
      const k = pairIndex(i, j);
      pairS[k] = s;
      // gravity model of trade: flow grows with both economy sizes and falls with distance
      uniforms.uFlow.value[k] = 1 - Math.exp(-1.2 * ((a.m * b.m) / Math.max(dn, 0.6)));
      paired[i] = Math.max(paired[i], s);
      paired[j] = Math.max(paired[j], s);
      for (const [p, q] of [[i, j], [j, i]]) {
        const o = nearest[p] < 0 ? Infinity : Math.hypot(centre[p].x - centre[nearest[p]].x, centre[p].y - centre[nearest[p]].y);
        if (d < o) nearest[p] = q;
      }
      const x0 = Math.max(a.rect.x, b.rect.x), y0 = Math.max(a.rect.y, b.rect.y);
      const x1 = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w), y1 = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h);
      if (x1 > x0 && y1 > y0) uniforms.uOv.value[k].set(x0, y0, x1 - x0, y1 - y0);
    }
  }

  // Kuramoto coupling: this window's rhythm is pulled toward its paired neighbours' rhythms.
  // Each window owns its own phase and broadcasts it, so every window shows the same pulses.
  let pull = 0;
  wins.forEach((w, j) => {
    if (j !== slot && slot >= 0) pull += pairS[pairIndex(slot, j)] * Math.sin(phaseNow(w, nowMs) - me.ph);
  });
  me.w = naturalRate(colorOf(slot)) + COUPLING * pull;
  me.ph = (((me.ph + me.w * dt) % TAU) + TAU) % TAU;
  const phases = wins.map((w) => (w.id === sync.id ? me.ph : phaseNow(w, nowMs)));
  const live = new Set<string>();
  wins.forEach((w, i) => {
    const c = centre[i];
    let tx = c.x, ty = c.y;
    if (nearest[i] < 0) {
      // alone: drift on its own (the phase comes from the window id, so every window agrees)
      const ph = idFrac(w.id) * TAU, A = c.px * 0.14;
      const t = nowMs / 1000; // unwrapped, so no jump every 1024 s
      tx += Math.sin(t * 0.37 + ph) * A;
      ty += Math.sin(t * 0.53 + ph * 1.7) * A;
    } else {
      // unpaired: pushed away from the nearest orb, but kept inside the window
      const n = centre[nearest[i]];
      const d = Math.max(Math.hypot(c.x - n.x, c.y - n.y), 1);
      const push = (1 - paired[i]) * c.px * 0.3;
      tx += ((c.x - n.x) / d) * push;
      ty += ((c.y - n.y) / d) * push;
    }
    // bigger economy, bigger orb; and it breathes with its own rhythm (the shaders pulse light the same way)
    const tr = THREE.MathUtils.clamp(c.px * 0.17 * Math.sqrt(w.m), 36, 200) * (1 + 0.07 * Math.sin(phases[i]));
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
    uniforms.uPhase.value[i] = phases[i];
  });
  for (let i = wins.length; i < MAX; i++) uniforms.uOrbs.value[i].set(0, 0, 0, 0);
  for (const id of orbs.keys()) if (!live.has(id)) orbs.delete(id);

  uniforms.uOrigin.value.set(rect.x, rect.y);

  // Choir: this window sings its own orb. Close windows are in tune; far ones drift sharp or flat.
  // The note swells with the orb's rhythm, so locked windows swell together.
  const hz = ROOT_HZ * RATIOS[colorOf(slot) % RATIOS.length];
  const cents = nearest[slot] < 0 ? 0 : (1 - paired[slot]) * (idFrac(sync.id) * 2 - 1) * 40;
  choir.update(hz, cents, (0.55 + 0.3 * Math.sin(me.ph)) * (0.5 + 0.25 * me.m));

  const text = `${all.length} window${all.length === 1 ? '' : 's'}`
    + (all.length > MAX ? ` (only ${MAX} link up${mine < MAX ? '' : ', this one is solo'})` : '');
  if (status.textContent !== text) status.textContent = text;
  warn.hidden = !peers.some((p) => Math.abs(p.rect.x - rect.x) < 1 && Math.abs(p.rect.y - rect.y) < 1);

  if (now - hudAt > 200) {
    hudAt = now;
    hud.replaceChildren(...hudLines(wins, phases, pairS, uniforms.uFlow.value, colorOf, slot));
  }

  renderer.render(scene, camera);
}

// Small readout: this window's economy size, how in step the rhythms are, and trade per pair.
function hudLines(wins: Peer[], phases: number[], pairS: number[], flow: number[], colorOf: (i: number) => number, slot: number) {
  const line = (text: string, ci?: number) => {
    const el = document.createElement('div');
    if (ci !== undefined) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = `rgb(${COLS[ci].map((v) => Math.round(v * 255)).join(',')})`;
      el.append(dot);
    }
    el.append(text);
    return el;
  };
  const out: HTMLElement[] = [line(`economy ${sync.self.m.toFixed(1)} (scroll to change)`, slot >= 0 ? colorOf(slot) : undefined)];
  if (wins.length > 1) {
    const re = phases.reduce((s, p) => s + Math.cos(p), 0), im = phases.reduce((s, p) => s + Math.sin(p), 0);
    out.push(line(`rhythm in step ${Math.round((Math.hypot(re, im) / phases.length) * 100)}%`));
    for (let i = 0; i < wins.length; i++) {
      for (let j = i + 1; j < wins.length; j++) {
        const k = pairIndex(i, j);
        out.push(line(`${NAMES[colorOf(i)]} + ${NAMES[colorOf(j)]}: trade ${Math.round(flow[k] * 100)}${pairS[k] > 0.5 ? ', paired' : ''}`));
      }
    }
  }
  return out;
}
requestAnimationFrame(frame);
