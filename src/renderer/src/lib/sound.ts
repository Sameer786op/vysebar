// Alert tones synthesized on the spot: no audio files to ship.
type Tone = "glass" | "chime" | "pop" | "bell";

let ctx: AudioContext | null = null;

export function play(tone: Tone = "glass"): void {
  ctx ??= new AudioContext();
  const now = ctx.currentTime;
  const notes: Record<Tone, [number, number, number][]> = {
    glass: [
      [1318.5, 0, 0.9],
      [1975.5, 0.08, 0.8],
    ],
    chime: [
      [880, 0, 1.1],
      [1108.7, 0.12, 1.0],
      [1318.5, 0.24, 1.2],
    ],
    pop: [[660, 0, 0.18]],
    bell: [
      [523.25, 0, 1.6],
      [1046.5, 0, 1.2],
      [1568, 0.02, 0.8],
    ],
  };
  for (const [freq, at, len] of notes[tone]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone === "pop" ? "triangle" : "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.18, now + at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + at);
    osc.stop(now + at + len + 0.05);
  }
}
