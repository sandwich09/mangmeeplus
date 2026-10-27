import type { GhostRegion } from './home-halloween-cards';

// Original phrases, spin whooshes and one final temple bell in a finite buffer, without extra sources or timers.
export function prepareHalloweenRevealAudio(): { play: (region: GhostRegion) => void; stop: () => void } {
  let context: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let stopped = false;
  const syncVisibility = () => {
    if (!context || stopped || context.state === 'closed') return;
    void (document.hidden ? context.suspend() : context.resume()).catch(() => {});
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('visibilitychange', syncVisibility);
    source?.disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  };
  try {
    const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return { play: () => {}, stop };
    context = new Audio();
    document.addEventListener('visibilitychange', syncVisibility);
    void context.resume().catch(() => {});
  } catch { stop(); }
  const play = (region: GhostRegion) => {
    if (!context || stopped) return;
    try {
      const voices: Record<GhostRegion, { notes: number[]; overtone: number; decay: number }> = {
        thai: { notes: [293.66, 440, 523.25, 587.33], overtone: 2.02, decay: 2.1 },
        western: { notes: [261.63, 311.13, 392, 523.25], overtone: 3, decay: 1.1 },
        japanese: { notes: [329.63, 440, 493.88, 659.25], overtone: 2, decay: 3.2 },
        chinese: { notes: [293.66, 369.99, 440, 587.33], overtone: 4.01, decay: 2.7 },
        korean: { notes: [392, 440, 587.33, 783.99], overtone: 1.5, decay: 1.6 },
        secret: { notes: [261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5], overtone: 2.5, decay: 1.6 },
      };
      const voice = voices[region];
      const duration = region === 'secret' ? 7.5 : 4.5;
      const rate = 22050;
      const buffer = context.createBuffer(1, duration * rate, rate);
      const samples = buffer.getChannelData(0);
      const spins = region === 'secret' ? [2.15, 2.55, 2.95, 3.35, 3.75, 4.15, 4.575] : [1.08, 1.44, 1.8, 2.16];
      const templeBellOnset = region === 'secret' ? 6.45 : 3.51;
      let noiseSeed = 0x6d616e67;
      let lowNoise = 0;
      for (let i = 0; i < samples.length; i++) {
        const t = i / rate;
        let sample = 0;
        for (let note = 0; note < voice.notes.length; note++) {
          const age = t - note * (region === 'secret' ? .72 : .65);
          if (age < 0) continue;
          const phase = 2 * Math.PI * voice.notes[note] * age;
          sample += Math.min(1, age / .07) * Math.exp(-age * voice.decay)
            * (.7 * Math.sin(phase) + .2 * Math.sin(phase * voice.overtone) + .1 * Math.sin(phase * 3.01));
        }
        noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
        const noise = noiseSeed / 0x80000000 - 1;
        lowNoise += .12 * (noise - lowNoise);
        let whoosh = 0;
        for (const center of spins) {
          const age = t - center;
          if (Math.abs(age) >= .13) continue;
          const envelope = Math.cos(Math.PI * age / .26) ** 2;
          whoosh += envelope * (.85 * (noise - lowNoise) + .15 * Math.sin(2 * Math.PI * (700 * age + 1200 * age * age)));
        }
        const bellAge = t - templeBellOnset;
        let templeBell = 0;
        if (bellAge >= 0) {
          const phase = 2 * Math.PI * 174.61 * bellAge;
          const strike = Math.min(1, bellAge / .012) * Math.exp(-2.4 * bellAge);
          templeBell = strike * (.6 * Math.sin(phase) + .22 * Math.sin(phase * 2.71)
            + .12 * Math.sin(phase * 4.07) + .06 * Math.sin(phase * 5.43));
        }
        samples[i] = (sample * .075 + whoosh * .018 + templeBell * .095) * Math.min(1, (duration - t) / .3);
      }
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = stop;
      void (document.hidden ? context.suspend() : context.resume()).then(() => { if (!stopped) source?.start(); }).catch(stop);
    } catch { stop(); }
  };
  return { play, stop };
}
