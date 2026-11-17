export type Rect = { x: number; y: number; w: number; h: number };
/** m: economy size, ph: rhythm phase (rad) at wall time `at` (ms), w: rhythm speed (rad/s). */
export type Peer = { id: string; opened: number; rect: Rect; m: number; ph: number; w: number; at: number };
export type Self = { m: number; ph: number; w: number };

type Msg =
  | { k: 'state'; id: string; opened: number; rect: Rect; m: number; ph: number; w: number; at: number }
  | { k: 'hello'; id: string }
  | { k: 'bye'; id: string };

const BEAT_MS = 400;
const STALE_MS = 2500;

export const wall = () => performance.timeOrigin + performance.now();
/** A window's rhythm phase right now, extrapolated from its last message. */
export const phaseNow = (p: Peer, nowMs: number) => p.ph + (p.w * (nowMs - p.at)) / 1000;

/** This window's page area on the monitor, in screen pixels. */
export function pageRect(): Rect {
  return {
    x: window.screenX + (window.outerWidth - window.innerWidth) / 2,
    y: window.screenY + (window.outerHeight - window.innerHeight), // tabs + address bar sit above the page
    w: window.innerWidth,
    h: window.innerHeight,
  };
}

const finite = (...n: unknown[]) => n.every((v) => typeof v === 'number' && Number.isFinite(v));

export function startSync() {
  const id = Math.random().toString(36).slice(2);
  const opened = performance.timeOrigin;
  const self: Self = { m: 1, ph: 0, w: 0 }; // main.ts updates this every frame
  const ch = new BroadcastChannel('concord');
  const heard = new Map<string, { peer: Peer; seen: number }>();
  let last = '';

  const post = (m: Msg) => ch.postMessage(m);
  const announce = (force: boolean) => {
    const rect = pageRect();
    const key = `${rect.x},${rect.y},${rect.w},${rect.h},${self.m}`;
    if (force || key !== last) {
      last = key;
      post({ k: 'state', id, opened, rect, m: self.m, ph: self.ph, w: self.w, at: wall() });
    }
    return rect;
  };

  ch.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data;
    if (!m || m.id === id) return;
    if (m.k === 'bye') heard.delete(m.id);
    else if (m.k === 'hello') announce(true);
    else if (m.k === 'state' && m.rect && finite(m.opened, m.m, m.ph, m.w, m.at, m.rect.x, m.rect.y, m.rect.w, m.rect.h)) {
      const peer: Peer = { id: m.id, opened: m.opened, rect: m.rect, m: Math.min(Math.max(m.m, 0.25), 4), ph: m.ph, w: m.w, at: m.at };
      heard.set(m.id, { peer, seen: performance.now() });
    }
  };

  post({ k: 'hello', id });
  announce(true);
  setInterval(() => announce(true), BEAT_MS);
  addEventListener('pagehide', () => post({ k: 'bye', id }));

  return {
    id,
    opened,
    self,
    /** Call every frame: sends an update if the window moved, returns the live rect. */
    tick: () => announce(false),
    /** Windows heard from within the last 2.5s. */
    peers(): Peer[] {
      const now = performance.now();
      for (const [k, v] of heard) if (now - v.seen > STALE_MS) heard.delete(k);
      return [...heard.values()].map((v) => v.peer);
    },
  };
}
