# Entangled

Open this page in two browser windows and each shows a glowing orb of particles. The orbs are joined by streams of particles that cross the gap between the windows and follow them as you drag them around. There is no server. Windows talk over a `BroadcastChannel`, and the graphics are Three.js with everything drawn in vertex shaders.

Built from a prompt in [this post by Avi Vashishta](https://www.avivashishta.com/blog/entangled-particles-across-two-browser-windows), which was inspired by the multi-window piece [Entangled by Bjørn Staal](https://www.nonfigurativ.com/projects/entangled) (first shown in 2023, later a 2025 Lumen Prize hybrid award finalist). The alone, repel and paired states, the plasma-like motion and the Feynman diagrams follow how Staal describes his work. This is an independent re-creation, not his code.

## Run it

```bash
npm install
npm run dev
```

Open the printed address, click **Open a second window**, then drag the windows around. Up to four windows link up. Colour follows open order: blue, red, yellow, paper.

## How it works

Every window works in screen coordinates. A window's page area on the monitor is `screenX + (outerWidth - innerWidth) / 2`, `screenY + (outerHeight - innerHeight)`, `innerWidth`, `innerHeight`. Each window broadcasts its id, open time and that rectangle when it moves (checked every frame) and every 400 ms. It answers a hello, sends bye on `pagehide`, and drops windows it has not heard from in 2.5 s. Each orb eases toward its window's centre on a spring.

No particle is stored or synced. Each particle has fixed random numbers (from a seeded generator, so every window builds the same ones), and its position comes from those, the orb positions and the shared wall clock `performance.timeOrigin + performance.now()`. Every window therefore computes the same particles and draws them through its own window, which is what makes a stream leaving one window line up with where it enters the other. The vertex shader converts screen pixels to clip space by subtracting the window's corner.

The clock is wrapped at 1024 s and every rate is snapped to a multiple of 1/1024 Hz, so cycles fit the wrap and nothing jumps when it happens.

### Alone, repel, paired

Taken from the behaviour described for Staal's original, where single instances act on their own, unpaired ones repel and paired ones synchronise.

- **Alone:** the orb drifts around its window on a slow loop. A fifth window (only four link up) also behaves this way and shows its own solo orb.
- **Paired:** two windows count as paired when their centres are about one window width apart or closer. Their orbs sit at their window centres, breathe in step on the shared clock, and the streams run at full strength.
- **Unpaired:** beyond about two window widths the orbs are pushed away from each other inside their windows and the streams thin out. The pairing fades smoothly in between.

### Plasma motion and Feynman lines

The field loops and streams are bent by a divergence-free noise field (each component depends only on the other two axes, so it behaves like curl noise) that drifts slowly. It is pinned to zero at the poles and at the orbs, so streams still land where they should. The noise for streams is evaluated in screen space, so both windows agree on it.

When two windows overlap on the monitor, a Feynman diagram is drawn in the overlapping area: two fermion lines meet at a vertex, a wavy photon runs to a second vertex, and two lines leave. It is made of the same stateless particles as everything else.

Layers, all additive on a dark background:

- Orb shell: spinning, rim lit, bulges toward the nearest orb.
- Dipole field loops, `r = L sin²θ`, around an axis aimed at the nearest orb.
- A hot core.
- Streams for every pair of orbs: about 40 lanes, each a cubic Bézier that leaves one orb at an angle off the axis and lands on the other mirrored, flowing both ways with the colours mixing.
- A full-screen glow around orbs and along links, and a starfield fixed to the monitor.

## Known limits

- Brave Shields fakes `screenX` and `screenY`, so all windows report one position. The page shows a warning when two windows do. Turn Shields off for the site or use another browser.
- Only the first four windows (by open time) get an orb.
- A window that is minimised or fully hidden may be throttled by the browser and dropped by the others after 2.5 s.
- Browser chrome sizes are estimated from `outerWidth` and `innerWidth`, so a side panel or an unusual window frame can shift the match by a few pixels.

## Put it online with GitHub Pages

The workflow in `.github/workflows/pages.yml` builds and deploys on every push to `main`.

1. Create an empty repository on GitHub, for example `entangled`.
2. In this folder, run:

   ```bash
   git init
   git add .
   git commit -m "Entangled"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/entangled.git
   git push -u origin main
   ```

3. On GitHub, open the repository's **Settings**, then **Pages**, and set **Source** to **GitHub Actions**.
4. Open the **Actions** tab and wait for the run to finish. The site is at `https://YOUR-USERNAME.github.io/entangled/`.

The `./` base path in `vite.config.ts` is what lets it work under that subpath.
