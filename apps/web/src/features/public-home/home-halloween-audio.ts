// Original ambience: one quiet buffer loop, with no timers or external audio.
export function startHalloweenAudio(): (() => void) & { pause: () => void; resume: () => void } {
  let context: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let stopped = false;
  let paused = false;
  const syncVisibility = () => {
    if (!context || stopped || context.state === 'closed') return;
    void (document.hidden || paused ? context.suspend() : context.resume()).catch(() => {});
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('visibilitychange', syncVisibility);
    source?.disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  };
  const pause = () => { paused = true; syncVisibility(); };
  const resume = () => { paused = false; syncVisibility(); };
  const controller = Object.assign(stop, { pause, resume });

  try {
    const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return controller;
    context = new Audio();
    document.addEventListener('visibilitychange', syncVisibility);
    const resumed = document.hidden ? context.suspend() : context.resume();
    void resumed.catch(stop);
    const duration = 20;
    const rate = 22050;
    const buffer = context.createBuffer(1, duration * rate, rate);
    const samples = buffer.getChannelData(0);
    const melody = [659.25, 783.99, 739.99, 493.88, 659.25, 587.33, 783.99, 739.99];
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate;
      const phase = 2 * Math.PI * t;
      let sample = (.12 * Math.sin(82.41 * phase) + .08 * Math.sin(123.47 * phase) + .06 * Math.sin(164.81 * phase)) * (.7 + .3 * Math.sin(Math.PI * t / 10));
      for (let note = 0; note < melody.length; note++) {
        const age = t - (1 + note * 2.5);
        if (age < 0 || age > 5.5) continue;
        const bell = 2 * Math.PI * melody[note] * age;
        sample += .36 * Math.min(1, age / .08) * Math.exp(-1.2 * age) * (.72 * Math.sin(bell) + .2 * Math.sin(bell * 2) + .08 * Math.sin(bell * 3.01));
      }
      const edge = Math.sin(Math.PI / 2 * Math.min(1, t / 1.5, (duration - t) / 1.5));
      samples[i] = sample * edge * edge;
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    for (let i = 0; i < samples.length; i++) samples[i] /= peak || 1;
    const gain = context.createGain();
    gain.gain.value = .06;
    source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(context.destination);
    void resumed.then(() => { if (!stopped) source?.start(); }).catch(stop);
  } catch {
    stop();
  }
  return controller;
}
