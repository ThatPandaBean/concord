export type Rect = { x: number; y: number; w: number; h: number };
export type Peer = { id: string; opened: number; rect: Rect };

type Msg =
  | { t: 'state'; id: string; opened: number; rect: Rect }
  | { t: 'hello'; id: string }
  | { t: 'bye'; id: string };

const BEAT_MS = 400;
const STALE_MS = 2500;

/** This window's page area on the monitor, in screen pixels. */
export function pageRect(): Rect {
  return {
    x: window.screenX + (window.outerWidth - window.innerWidth) / 2,
    y: window.screenY + (window.outerHeight - window.innerHeight), // tabs + address bar sit above the page
    w: window.innerWidth,
    h: window.innerHeight,
  };
}

export function startSync() {
  const id = Math.random().toString(36).slice(2);
  const opened = performance.timeOrigin;
  const ch = new BroadcastChannel('entangled');
  const heard = new Map<string, { peer: Peer; at: number }>();
  let last = '';

  const post = (m: Msg) => ch.postMessage(m);
  const announce = (force: boolean) => {
    const rect = pageRect();
    const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
    if (force || key !== last) {
      last = key;
      post({ t: 'state', id, opened, rect });
    }
    return rect;
  };

  ch.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data;
    if (!m || m.id === id) return;
    if (m.t === 'bye') heard.delete(m.id);
    else if (m.t === 'hello') announce(true);
    else if (m.t === 'state') heard.set(m.id, { peer: { id: m.id, opened: m.opened, rect: m.rect }, at: performance.now() });
  };

  post({ t: 'hello', id });
  announce(true);
  setInterval(() => announce(true), BEAT_MS);
  addEventListener('pagehide', () => post({ t: 'bye', id }));

  return {
    id,
    opened,
    /** Call every frame: sends an update if the window moved, returns the live rect. */
    tick: () => announce(false),
    /** Windows heard from within the last 2.5s. */
    peers(): Peer[] {
      const now = performance.now();
      for (const [k, v] of heard) if (now - v.at > STALE_MS) heard.delete(k);
      return [...heard.values()].map((v) => v.peer);
    },
  };
}
