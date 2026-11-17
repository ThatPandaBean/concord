// Everything is drawn from per-particle random attributes + uniforms. No particle state.
// All positions are in SCREEN pixels; toClip() subtracts this window's corner at the end.
//
// Time: uTime is the shared wall clock in seconds, wrapped at 1024 s. Every rate goes through
// q() which snaps it to a multiple of 1/1024 Hz, so each cycle fits the wrap exactly and
// nothing jumps when the clock wraps. All windows get the same time, so the same particles.

export const COMMON = /* glsl */ `
uniform vec4 uOrbs[4];   // x, y, radius, on  (screen px)
uniform vec3 uCols[4];
uniform vec2 uOrigin;    // this window's page corner on the screen
uniform vec2 uView;      // this window's page size
uniform vec2 uScreen;    // monitor size, for the starfield
uniform float uTime;
uniform float uDpr;
uniform float uFlow[6];  // 0..1: trade between each window pair (gravity model: size * size / distance)
uniform float uPhase[4]; // each orb's rhythm phase (rad); coupled orbs end up in step
uniform vec4 uOv[6];     // screen rect where two windows overlap (w = 0 when they do not)
attribute vec4 aR;       // per-particle randoms
attribute vec3 aIdx;     // x: orb (or pair start), y: pair end, z: extra random
varying vec4 vC;

const float TAU = 6.2831853;
float q(float r) { return floor(r * 1024. + .5) / 1024.; }
float cyc(float rate, float ph) { return fract(uTime * q(rate) + ph); }
float ang(float rate) { return TAU * fract(uTime * q(rate)); }
float hash(float n) { return fract(sin(n * 127.1 + 31.7) * 43758.5453); }

vec4 toClip(vec2 s) {
  vec2 p = (s - uOrigin) / uView;
  return vec4(p.x * 2. - 1., 1. - p.y * 2., 0., 1.);
}
// simple perspective divide: F is the eye distance, z comes toward the viewer
float persp(float F, float z) { return 1. / max(1. - z / F, .35); }

// Divergence-free noise (each component depends only on the other two axes), slowly drifting.
// Gives the clouds a plasma-like, ever-shifting flow. Periodic in time, so it survives the clock wrap.
vec3 turb(vec3 p) {
  float a = ang(.021), b = ang(.034);
  return vec3(
    sin(p.y * 1.7 + a) + sin(p.z * 2.3 + b) + .5 * sin(p.y * 3.9 - b),
    sin(p.z * 1.9 + b) + sin(p.x * 2.1 + a) + .5 * sin(p.z * 4.3 + a),
    sin(p.x * 1.3 + a) + sin(p.y * 2.7 + b) + .5 * sin(p.x * 3.7 - a));
}

// index of the pair (a, b), a < b, matching PAIRS in main.ts
int pid(int a, int b) { return a * (7 - a) / 2 + b - a - 1; }

void hide() { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; vC = vec4(0.); }
void emit(vec2 s, float size, vec3 col, float a) {
  gl_Position = toClip(s);
  gl_PointSize = size * uDpr;
  vC = vec4(col, a);
}

// nearest other orb: xy = unit direction, z = distance (1e5 when alone)
vec3 nearest(int i) {
  vec3 best = vec3(0., -1., 1e5);
  for (int j = 0; j < 4; j++) {
    if (j == i || uOrbs[j].w < .5) continue;
    vec2 dv = uOrbs[j].xy - uOrbs[i].xy;
    float d = length(dv);
    if (d < best.z) best = vec3(dv / max(d, 1e-3), d);
  }
  return best;
}
// magnet frame: axis aimed at the nearest orb, two perpendiculars (one is the view axis)
void basis(int i, out vec3 ax, out vec3 e2, out vec3 e3, out float prox) {
  vec3 n = nearest(i);
  ax = vec3(n.xy, 0.);
  e2 = vec3(0., 0., 1.);
  e3 = cross(ax, e2);
  float R = uOrbs[i].z;
  prox = exp(-max(n.z - R * 2., 0.) / (R * 4.)); // 1 when touching, 0 when far or alone
}
`;

export const SHELL_VS = /* glsl */ `
void main() {
  int i = int(aIdx.x + .5);
  vec4 o = uOrbs[i];
  if (o.w < .5) { hide(); return; }
  vec3 ax, e2, e3; float prox;
  basis(i, ax, e2, e3, prox);
  float cz = aR.x * 2. - 1.;
  float sr = sqrt(1. - cz * cz);
  float ph = TAU * aR.y + ang(.07) + float(i);              // spins about the magnet axis
  vec3 n = ax * cz + (e2 * cos(ph) + e3 * sin(ph)) * sr;
  float bulge = .38 * prox * pow(max(cz, 0.), 3.);           // swells toward the nearest orb
  vec3 p = n * o.z * (1. + bulge);
  float s = persp(o.z * 5., p.z);
  float rim = pow(1. - abs(n.z), 2.2);                       // bright at the edge, so it reads as round
  float lit = .55 + .45 * (n.z * .5 + .5);
  float pulse = 1. + .25 * sin(uPhase[i]);                    // own rhythm; locked orbs breathe in step
  emit(o.xy + p.xy * s, (1.4 + aR.z * 1.4) * s, uCols[i], (.10 + 1.1 * rim) * lit * pulse);
}
`;

export const FIELD_VS = /* glsl */ `
void main() {
  int i = int(aIdx.x + .5);
  vec4 o = uOrbs[i];
  if (o.w < .5) { hide(); return; }
  vec3 ax, e2, e3; float prox;
  basis(i, ax, e2, e3, prox);
  float loop = floor(aR.x * 30.);                            // 30 loops around the axis
  float phi = TAU * loop / 30. + ang(.05) + float(i) * 1.3;
  float L = o.z * (.9 + .8 * hash(loop + float(i) * 37.));
  float th = 3.14159265 * cyc(.12 + .28 * aR.z, aR.y);       // flows pole to pole
  float r = L * pow(sin(th), 2.);                            // dipole field line r = L sin^2(theta)
  vec3 p = ax * (r * cos(th)) + (e2 * cos(phi) + e3 * sin(phi)) * (r * sin(th));
  p += (vec3(aR.w, fract(aR.w * 17.), fract(aR.w * 91.)) - .5) * o.z * .03;
  p += turb(p / (o.z * .9) + float(i) * 7.) * o.z * .09 * sin(th); // plasma drift, pinned at the poles
  float s = persp(o.z * 5., p.z);
  float depth = .7 + .3 * (clamp(p.z / L, -1., 1.) * .5 + .5);
  emit(o.xy + p.xy * s, (1.2 + aR.w * 1.2) * s, uCols[i] * (1. + .4 * prox), .55 * pow(sin(th), .6) * depth);
}
`;

export const CORE_VS = /* glsl */ `
void main() {
  int i = int(aIdx.x + .5);
  vec4 o = uOrbs[i];
  if (o.w < .5) { hide(); return; }
  vec3 ax, e2, e3; float prox;
  basis(i, ax, e2, e3, prox);
  float cz = aR.x * 2. - 1.;
  float sr = sqrt(1. - cz * cz);
  float rr = .3 * pow(aR.z, .7);
  float ph = TAU * aR.y + ang(.45 + .6 * aR.w);              // fast swirl, each particle its own rate
  vec3 p = (ax * cz + (e2 * cos(ph) + e3 * sin(ph)) * sr) * rr * o.z;
  float s = persp(o.z * 5., p.z);
  vec3 hot = mix(uCols[i], vec3(1., .96, .88), .7);
  float pulse = 1. + .25 * sin(uPhase[i]);
  emit(o.xy + p.xy * s, (1.6 + aR.w * 2.) * s, hot, .35 * (1. + .5 * prox) * pulse);
}
`;

export const STREAM_VS = /* glsl */ `
vec3 bez(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
  float k = 1. - t;
  return k * k * k * a + 3. * k * k * t * b + 3. * k * t * t * c + t * t * t * d;
}
void main() {
  int ia = int(aIdx.x + .5), ib = int(aIdx.y + .5);
  vec4 A = uOrbs[ia], B = uOrbs[ib];
  if (A.w < .5 || B.w < .5) { hide(); return; }
  float pr = uFlow[pid(ia, ib)];
  if (fract(aIdx.z * 41.) > max(pr, .04)) { hide(); return; }     // weak trade: the stream thins out
  vec2 dv = B.xy - A.xy;
  float len = max(length(dv), 1.);
  vec2 dir = dv / len, perp = vec2(-dir.y, dir.x);

  // ~40 lanes. Lane 0 is the straight beam, wide lanes are the loops. Low lanes get more particles.
  float lane = floor(pow(aR.x, 1.7) * 40.);
  float th = pow(lane / 39., 1.4) * 1.35;                    // angle off the axis
  float az = TAU * hash(lane + 7.);                          // which way round the axis the lane bows
  vec3 side = (vec3(perp, 0.) * cos(az) + vec3(0., 0., 1.) * sin(az)) * sin(th);
  vec3 e0 = vec3( dir * cos(th), 0.) + side;                 // leaves A
  vec3 e1 = vec3(-dir * cos(th), 0.) + side;                 // lands on B, mirrored
  vec3 p0 = vec3(A.xy, 0.) + e0 * A.z * .85;
  vec3 p3 = vec3(B.xy, 0.) + e1 * B.z * .85;
  float reach = len * (.25 + .55 * sin(th));

  float rev = step(.5, fract(aIdx.z * 3.7));                 // half the particles flow B to A
  float u = cyc(.15 + .3 * aR.z, aR.y);
  float t = mix(u, 1. - u, rev);
  vec3 p = bez(p0, p0 + e0 * reach, p3 + e1 * reach, p3, t);
  p += (vec3(fract(aR.w * 13.), fract(aR.w * 57.), fract(aR.w * 131.)) - .5) * (A.z + B.z) * .03;
  // plasma drift in screen space, so both windows agree; zero at both orbs so streams still land
  p += turb(p / 150.) * (A.z + B.z) * .06 * sin(3.14159265 * t) * (.4 + sin(th));

  vec2 c = mix(A.xy, B.xy, t);                               // perspective centre slides from orb to orb
  float s = persp(mix(A.z, B.z, t) * 5., p.z);

  vec3 co = mix(uCols[ia], uCols[ib], rev);
  vec3 cd = mix(uCols[ib], uCols[ia], rev);
  vec3 col = mix(co, cd, smoothstep(.15, .85, u));           // colour mixes on the way across
  float fade = smoothstep(0., .08, u) * smoothstep(1., .92, u);
  float head = step(fract(aIdx.z * 29.), .05);               // 1 in 20 is a brighter comet head
  emit(c + (p.xy - c) * s, (1.3 + aR.w + head * 3.) * s, col * (1. + head * 1.5), .45 * fade * mix(.6, 1., pr));
}
`;

// Feynman diagram drawn in the area where two windows overlap: two fermion lines meet at a vertex,
// a wavy photon runs to a second vertex, two fermion lines leave. Same pair layout as the streams.
export const FEYN_VS = /* glsl */ `
void main() {
  int ia = int(aIdx.x + .5), ib = int(aIdx.y + .5);
  vec4 ov = uOv[pid(ia, ib)];
  if (ov.z < 24. || ov.w < 24. || uOrbs[ia].w < .5 || uOrbs[ib].w < .5) { hide(); return; }
  vec2 box = ov.zw * .84, org = ov.xy + ov.zw * .08;
  vec2 V1 = vec2(.32, .5), V2 = vec2(.68, .5);
  vec3 ca = uCols[ia], cb = uCols[ib];

  float k = floor(aR.x * 5.);
  vec2 P0 = vec2(.04, .08), P1 = V1;
  vec3 col = ca;
  if (k > 3.5)      { P0 = V2; P1 = vec2(.96, .92); col = cb; }
  else if (k > 2.5) { P0 = V2; P1 = vec2(.96, .08); col = ca; }
  else if (k > 1.5) { P0 = V1; P1 = V2; col = mix(ca, cb, .5) + .25; }
  else if (k > .5)  { P0 = vec2(.04, .92); P1 = V1; col = cb; }

  float u = cyc(.2 + .3 * aR.z, aR.y);
  vec2 pos = mix(P0, P1, u);
  if (k > 1.5 && k < 2.5) pos.y += .07 * sin(u * TAU * 5. - ang(.5)); // the wavy photon
  pos = mix(pos, aIdx.z < .5 ? V1 : V2, step(aR.w, .08));              // 8% pile up on the two vertices
  float vtx = step(aR.w, .08);

  vec2 s = org + pos * box + (vec2(fract(aR.w * 13.), fract(aR.w * 57.)) - .5) * 3.;
  float fade = smoothstep(0., .06, u) * smoothstep(1., .94, u);
  emit(s, 1.5 + aR.w * 1.2 + vtx * 2., mix(col, vec3(1.), vtx * .6), (.55 + vtx * .5) * mix(fade, 1., vtx));
}
`;

export const STAR_VS = /* glsl */ `
void main() {
  // fixed to the monitor, so every window looks out onto the same sky
  vec2 s = vec2(mix(-uScreen.x, 2. * uScreen.x, aR.x), mix(-.5 * uScreen.y, 1.5 * uScreen.y, aR.y));
  float tw = .65 + .35 * sin(ang(.08 + .25 * aR.w) + aR.x * 50.);
  emit(s, .8 + aR.z * 1.5, vec3(.75, .85, 1.), (.2 + .6 * aR.z * aR.z) * tw);
}
`;

export const SPRITE_FS = /* glsl */ `
varying vec4 vC;
void main() {
  vec2 q = gl_PointCoord - .5;
  float d = dot(q, q) * 4.;
  if (d > 1.) discard;
  float f = 1. - d;
  gl_FragColor = vec4(vC.rgb * vC.a * f * f, 1.);
}
`;

export const GLOW_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
`;

// full-screen additive glow: round each orb and along each link, in screen space
export const GLOW_FS = /* glsl */ `
uniform vec4 uOrbs[4];
uniform vec3 uCols[4];
uniform vec2 uOrigin;
uniform vec2 uView;
uniform float uFlow[6];
varying vec2 vUv;
void main() {
  vec2 px = uOrigin + vec2(vUv.x, 1. - vUv.y) * uView;
  vec3 c = vec3(0.);
  for (int i = 0; i < 4; i++) {
    if (uOrbs[i].w < .5) continue;
    float d = length(px - uOrbs[i].xy) / uOrbs[i].z;
    c += uCols[i] * (.30 / (1. + d * d * 1.5) + .14 * exp(-d * .5));
    for (int j = i + 1; j < 4; j++) {
      if (uOrbs[j].w < .5) continue;
      vec2 a = uOrbs[i].xy, b = uOrbs[j].xy, ab = b - a;
      float t = clamp(dot(px - a, ab) / max(dot(ab, ab), 1.), 0., 1.);
      float w = .55 * min(uOrbs[i].z, uOrbs[j].z);
      float dd = length(px - (a + ab * t)) / w;
      float far = 1. / (1. + length(ab) / (6. * (uOrbs[i].z + uOrbs[j].z)));
      float pr = mix(.2, 1., uFlow[i * (7 - i) / 2 + j - i - 1]);
      c += mix(uCols[i], uCols[j], t) * exp(-dd * dd) * .18 * far * pr * (.5 + .5 * sin(t * 3.14159));
    }
  }
  c += (fract(sin(dot(px, vec2(12.9898, 78.233))) * 43758.5453) - .5) / 255.; // dither
  gl_FragColor = vec4(c, 1.);
}
`;
