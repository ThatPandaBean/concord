// One voice per window, made with Web Audio only (no files, no keys): three slightly detuned
// sawtooth oscillators through three "ah" formant filters, a little vibrato, and a reverb tail.
// Windows take notes from a just-intonation chord, so paired windows sound consonant.

export const ROOT_HZ = 220;
export const RATIOS = [1, 5 / 4, 3 / 2, 2]; // root, major third, fifth, octave

const FORMANTS: [hz: number, q: number, gain: number][] = [[800, 8, 1], [1150, 10, 0.5], [2900, 12, 0.2]];
const SPREAD = [-9, 0, 9]; // cents

export function createChoir() {
  let ctx: AudioContext | null = null;
  let oscs: OscillatorNode[] = [];
  let level: GainNode | null = null;
  let on = false;

  const build = () => {
    const c = new AudioContext();
    const master = c.createGain();
    master.gain.value = 0.14;
    const bus = c.createGain();
    level = c.createGain();
    level.gain.value = 0;

    oscs = SPREAD.map(() => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.connect(bus);
      o.start();
      return o;
    });

    const lfo = c.createOscillator(); // vibrato
    lfo.frequency.value = 5.5;
    const depth = c.createGain();
    depth.gain.value = 7; // cents
    lfo.connect(depth);
    oscs.forEach((o) => depth.connect(o.detune));
    lfo.start();

    for (const [hz, q, g] of FORMANTS) {
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = hz;
      f.Q.value = q;
      const fg = c.createGain();
      fg.gain.value = g;
      bus.connect(f).connect(fg).connect(level);
    }
    level.connect(master);
    master.connect(c.destination);

    const reverb = c.createConvolver(); // 2.5 s of decaying noise
    const len = Math.floor(c.sampleRate * 2.5);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    reverb.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.6;
    master.connect(reverb).connect(wet).connect(c.destination);
    ctx = c;
  };

  return {
    /** Must run from a click: browsers only allow audio after a user gesture. */
    async toggle(): Promise<boolean> {
      if (!ctx) build();
      on = !on;
      if (on) await ctx!.resume();
      else await ctx!.suspend();
      return on;
    },
    /** Call every frame: pitch (Hz), detune (cents, 0 = in tune), loudness (0..1). */
    update(hz: number, cents: number, loud: number) {
      if (!on || !ctx || !level) return;
      const t = ctx.currentTime;
      oscs.forEach((o, i) => {
        o.frequency.setTargetAtTime(hz, t, 0.08);
        o.detune.setTargetAtTime(SPREAD[i] + cents, t, 0.1);
      });
      level.gain.setTargetAtTime(Math.min(Math.max(loud, 0), 1), t, 0.05);
    },
  };
}
