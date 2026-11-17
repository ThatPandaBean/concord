# Concord

Open this page in two browser windows. Each window is one voice in a small choir. Its orb is joined to the others by streams of particles that cross the gap between windows. The windows trade with each other like economies, their rhythms pull into step when they are close, and (if you press **Sound**) they sing. There is no server: windows talk over a `BroadcastChannel`, the graphics are Three.js with everything drawn in vertex shaders, and the sound is Web Audio.

It started as a re-creation of the multi-window idea in [Avi Vashishta's post](https://www.avivashishta.com/blog/entangled-particles-across-two-browser-windows), which is his version of [Entangled by Bjørn Staal](https://www.nonfigurativ.com/projects/entangled) (first shown in 2023, later a 2025 Lumen Prize hybrid award finalist). The multi-window screen-space trick and the visual language come from them. The alone, repel and paired states, the plasma-like motion and the Feynman diagrams follow how Staal describes his work. This is an independent project, not their code.

## What is different here

Three ideas that are not in either source:

- **Choir.** Each window sings its own orb with a synthesised "ah" voice. Notes come from a just-intonation chord by open order (root, major third, fifth, octave). Paired windows are in tune. As windows drift apart their voices go sharp or flat. Each voice swells with its orb's rhythm.
- **Trade flows.** Scroll in a window to grow or shrink its economy. The streams between two windows follow the gravity model of trade: flow grows with both sizes and falls with distance. A bigger economy has a bigger orb and a louder voice. A small readout shows each pair's trade.
- **Synced rhythms.** Each orb has its own pulse (0.4, 0.5, 0.6 or 0.7 Hz by open order). Close windows pull each other into step with Kuramoto coupling, and the readout shows the percentage in step. Far apart, they drift in and out of step.

## Run it

```bash
npm install
npm run dev
```

Open the printed address, click **Open a second window**, then drag the windows around. Click **Sound** in each window you want to hear (browsers only allow audio after a click). Up to four windows link up. Colour follows open order: blue, red, yellow, paper.

## How it works

Every window works in screen coordinates. A window's page area on the monitor is `screenX + (outerWidth - innerWidth) / 2`, `screenY + (outerHeight - innerHeight)`, `innerWidth`, `innerHeight`. Each window broadcasts its id, open time, rectangle, economy size and rhythm phase when it moves (checked every frame) and every 400 ms. It answers a hello, sends bye on `pagehide`, and drops windows it has not heard from in 2.5 s. Messages are checked for finite numbers before use.

No particle is stored or synced. Each particle has fixed random numbers (from a seeded generator, so every window builds the same ones), and its position comes from those, the orb positions and the shared wall clock `performance.timeOrigin + performance.now()`. Every window computes the same particles and draws them through its own window, so a stream leaving one window lines up with where it enters the other. The vertex shader converts screen pixels to clip space by subtracting the window's corner. The clock wraps at 1024 s and every rate is snapped to a multiple of 1/1024 Hz, so nothing jumps at the wrap.

The rhythm is the one piece of real shared state. Each window owns its own phase, integrates it with the pull from its paired neighbours, and broadcasts it with its speed. The other windows extrapolate it, so every window shows the same pulses.

### States

- **Alone:** the orb drifts around its window. A fifth window (only four link up) behaves this way and shows its own solo orb.
- **Paired:** windows whose centres are about one window width apart or closer. Orbs sit at their window centres, rhythms lock, voices are in tune.
- **Unpaired:** beyond about two window widths the orbs are pushed apart inside their windows and the rhythms drift. Pairing fades smoothly in between.

### Drawing

Additive particles on a dark background:

- Orb shell: spinning, rim lit, bulges toward the nearest orb.
- Dipole field loops, `r = L sin²θ`, around an axis aimed at the nearest orb, bent by a slowly drifting divergence-free noise field.
- A hot core.
- Streams for every pair: about 40 lanes, each a cubic Bézier that leaves one orb at an angle off the axis and lands on the other mirrored, flowing both ways with the colours mixing. Trade sets how many particles flow.
- A Feynman diagram (two lines meeting at a vertex, a wavy photon, two lines leaving) in the area where two windows overlap.
- A full-screen glow around orbs and along links, and a starfield fixed to the monitor.

## Known limits

- Brave Shields fakes `screenX` and `screenY`, so all windows report one position. The page shows a warning when two windows do. Turn Shields off for the site or use another browser.
- Only the first four windows (by open time) link up.
- A minimised or fully hidden window may be throttled by the browser and dropped by the others after 2.5 s.
- Browser chrome sizes are estimated from `outerWidth` and `innerWidth`, so a side panel or an unusual window frame can shift the match by a few pixels.
- The choir has only been checked by reading its nodes and clicking the button, not by ear. The pitch, balance and loudness are untested.

## Put it online with GitHub Pages

The workflow in `.github/workflows/pages.yml` builds and deploys on every push to `main`.

1. Create an empty repository on GitHub, for example `concord`.
2. In this folder, run:

   ```bash
   git init
   git add .
   git commit -m "Concord"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/concord.git
   git push -u origin main
   ```

3. On GitHub, open the repository's **Settings**, then **Pages**, and set **Source** to **GitHub Actions**.
4. If the first run says `main` is not allowed to deploy, open **Settings**, then **Environments**, then **github-pages**, and add `main` to the allowed branches.
5. Wait for the run in the **Actions** tab. The site is at `https://YOUR-USERNAME.github.io/concord/`.

The `./` base path in `vite.config.ts` is what lets it work under that subpath.
