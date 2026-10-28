'use client';

import * as React from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/common/components/button/Button';
import { HalloweenCandyShare } from './HalloweenCandyShare';
import { candyMusicRate, candyScore, candySpawnDelay, candyTier, type CandyKind } from './home-halloween-candy';

type Phase = 'ready' | 'countdown' | 'playing' | 'finishing' | 'result';
type Target = { id: number; kind: CandyKind; x: number; y: number; duration: number; turn: number };
type Burst = { id: number; kind: 'bat' | 'candy'; x: number; y: number };

const targetCopy: Record<CandyKind, { icon: string; label: string; hit: string }> = {
  ordinary: { icon: '🍬', label: 'ลูกอม เพิ่ม 1 คะแนน', hit: '+1' },
  gold: { icon: '🎃', label: 'ฟักทองทอง เพิ่ม 5 คะแนน', hit: '+5' },
  cursed: { icon: '☠️', label: 'ลูกอมต้องสาป ลบ 3 คะแนน', hit: '−3' },
  thief: { icon: '👻', label: 'ผีขโมยลูกอม กดเพื่อไล่ผี', hit: 'ไล่ผีทัน!' },
};

function randomKind(): CandyKind {
  const roll = Math.random();
  return roll < .64 ? 'ordinary' : roll < .77 ? 'gold' : roll < .91 ? 'cursed' : 'thief';
}

export function HalloweenCandyGame({ onBack, onStart }: { onBack?: () => void; onStart?: () => void }) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [countdown, setCountdown] = useState(3);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [targets, setTargets] = useState<Target[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [message, setMessage] = useState('');
  const [shaking, setShaking] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const run = useRef(0);
  const nextTarget = useRef(0);
  const nextBurst = useRef(0);
  const resolvedTargets = useRef(new Set<number>());
  const endAt = useRef(0);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sound = useRef<AudioContext | undefined>(undefined);
  const music = useRef<AudioBufferSourceNode | undefined>(undefined);
  const titleId = useId();

  function showTop() {
    const dialog = root.current?.closest('dialog');
    if (dialog) dialog.scrollTop = 0;
  }

  function stopSound() {
    stopMusic();
    if (sound.current && sound.current.state !== 'closed') void sound.current.close().catch(() => {});
    sound.current = undefined;
  }

  function stopMusic() {
    if (!music.current) return;
    try { music.current.stop(); } catch { /* It may already have stopped. */ }
    music.current.disconnect();
    music.current = undefined;
  }

  function startMusic() {
    const context = sound.current;
    if (!context || context.state === 'closed' || music.current) return;
    try {
      const duration = 3;
      const rate = 22050;
      const buffer = context.createBuffer(1, duration * rate, rate);
      const samples = buffer.getChannelData(0);
      const notes = [293.66, 311.13, 349.23, 415.3, 349.23, 311.13, 277.18, 233.08];
      let peak = 0;
      for (let i = 0; i < samples.length; i++) {
        const t = i / rate;
        const stepAge = t % .375;
        const noteAge = t % .1875;
        const note = notes[Math.floor(t / .375) % notes.length];
        const bass = Math.sin(2 * Math.PI * note / 2 * t) * Math.exp(-5 * stepAge);
        const phase = 2 * Math.PI * note * noteAge;
        const organ = (.58 * Math.sin(phase) + .27 * Math.sin(phase * 2) + .15 * Math.sin(phase * 3)) * Math.exp(-5 * noteAge);
        const bell = Math.sin(phase * 4.01) * Math.exp(-18 * noteAge);
        const kick = Math.sin(2 * Math.PI * (72 - 32 * Math.min(1, stepAge / .18)) * stepAge) * Math.exp(-18 * stepAge);
        const hatAge = t % .09375;
        const hat = Math.sin(2 * Math.PI * 3200 * hatAge) * Math.exp(-75 * hatAge);
        const edge = Math.min(1, t / .01, (duration - t) / .01);
        samples[i] = (.3 * bass + .31 * organ + .08 * bell + .24 * kick + .07 * hat) * edge;
        peak = Math.max(peak, Math.abs(samples[i]));
      }
      for (let i = 0; i < samples.length; i++) samples[i] /= peak || 1;
      const gain = context.createGain();
      gain.gain.value = .055;
      music.current = context.createBufferSource();
      music.current.buffer = buffer;
      music.current.loop = true;
      music.current.connect(gain);
      gain.connect(context.destination);
      music.current.start();
    } catch { stopMusic(); }
  }

  function startVictoryMusic() {
    const context = sound.current;
    if (!context || context.state === 'closed' || music.current) return;
    try {
      const duration = 3.2;
      const rate = 11025;
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 987.77, 1046.5, 659.25];
      const buffer = context.createBuffer(1, duration * rate, rate);
      const samples = buffer.getChannelData(0);
      let peak = 0;
      for (let index = 0; index < samples.length; index++) {
        const time = index / rate;
        const beat = time % .4;
        const frequency = notes[Math.floor(time / .4) % notes.length];
        const melody = Math.sin(2 * Math.PI * frequency * time) * Math.exp(-5 * beat);
        const sparkle = Math.sin(2 * Math.PI * frequency * 2 * time) * Math.exp(-8 * beat);
        const bassBeat = time % .8;
        const bass = Math.sin(2 * Math.PI * (time < 1.6 ? 130.81 : 196) * time) * Math.exp(-7 * bassBeat);
        const edge = Math.min(1, time / .04, (duration - time) / .04);
        samples[index] = (.56 * melody + .18 * sparkle + .2 * bass) * edge;
        peak = Math.max(peak, Math.abs(samples[index]));
      }
      for (let index = 0; index < samples.length; index++) samples[index] /= peak || 1;
      const gain = context.createGain();
      gain.gain.value = .06;
      music.current = context.createBufferSource();
      music.current.buffer = buffer;
      music.current.loop = true;
      music.current.connect(gain);
      gain.connect(context.destination);
      music.current.start();
    } catch { stopMusic(); }
  }

  function startCelebrationMusic() {
    const context = sound.current;
    if (!context || context.state === 'closed' || music.current) return;
    try {
      const duration = 2.4;
      const rate = 22050;
      const notes = [659.25, 783.99, 880, 1046.5, 1174.66, 1046.5, 1318.51, 1567.98, 1318.51, 1174.66, 1046.5, 1318.51];
      const bassNotes = [261.63, 349.23, 220, 392, 261.63, 392];
      const buffer = context.createBuffer(1, duration * rate, rate);
      const samples = buffer.getChannelData(0);
      let peak = 0;
      for (let index = 0; index < samples.length; index++) {
        const time = index / rate;
        const noteAge = time % .2;
        const frequency = notes[Math.floor(time / .2) % notes.length];
        const melodyPhase = 2 * Math.PI * frequency * noteAge;
        const melody = (.72 * Math.sin(melodyPhase) + .28 * Math.sin(melodyPhase * 2)) * Math.exp(-7 * noteAge);
        const bassAge = time % .4;
        const bassFrequency = bassNotes[Math.floor(time / .4) % bassNotes.length];
        const bass = Math.sin(2 * Math.PI * bassFrequency * bassAge) * Math.exp(-8 * bassAge);
        const kick = Math.sin(2 * Math.PI * (95 - 55 * Math.min(1, bassAge / .12)) * bassAge) * Math.exp(-22 * bassAge);
        const hatAge = time % .1;
        const hat = Math.sin(2 * Math.PI * 4200 * hatAge) * Math.exp(-85 * hatAge);
        const edge = Math.min(1, time / .03, (duration - time) / .03);
        samples[index] = (.48 * melody + .22 * bass + .22 * kick + .05 * hat) * edge;
        peak = Math.max(peak, Math.abs(samples[index]));
      }
      for (let index = 0; index < samples.length; index++) samples[index] /= peak || 1;
      const gain = context.createGain();
      gain.gain.value = .06;
      music.current = context.createBufferSource();
      music.current.buffer = buffer;
      music.current.loop = true;
      music.current.connect(gain);
      gain.connect(context.destination);
      music.current.start();
    } catch { stopMusic(); }
  }

  function prepareSound() {
    try {
      const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio || sound.current) return;
      sound.current = new Audio();
      void sound.current.resume().catch(() => {});
    } catch { stopSound(); }
  }

  function tone(frequency: number, duration = .08) {
    const context = sound.current;
    if (!context || context.state === 'closed') return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      gain.gain.setValueAtTime(.045, now);
      gain.gain.exponentialRampToValueAtTime(.001, now + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch { /* Sound is optional; gameplay stays available. */ }
  }

  function shake() {
    clearTimeout(shakeTimer.current);
    setShaking(true);
    shakeTimer.current = setTimeout(() => setShaking(false), 360);
  }

  function finish(currentRun: number) {
    if (run.current !== currentRun) return;
    const finalRun = ++run.current;
    stopMusic();
    setSecondsLeft(0);
    setPhase('finishing');
    setMessage('');
    clearTimeout(finishTimer.current);
    finishTimer.current = setTimeout(() => {
      if (run.current !== finalRun) return;
      resolvedTargets.current.clear();
      setTargets([]);
      setBursts([]);
      setPhase('result');
      showTop();
    }, reducedMotion ? 700 : 1500);
  }

  function start() {
    run.current++;
    clearTimeout(finishTimer.current);
    stopMusic();
    resolvedTargets.current.clear();
    onStart?.();
    prepareSound();
    tone(392, .1);
    setScore(0);
    setCombo(0);
    setTargets([]);
    setBursts([]);
    setMessage('');
    setSecondsLeft(30);
    setCountdown(3);
    setPhase('countdown');
    showTop();
  }

  function hit(target: Target, element?: HTMLButtonElement) {
    if (phase !== 'playing' || resolvedTargets.current.has(target.id)) return;
    const field = element?.closest('.halloween-candy-field')?.getBoundingClientRect();
    const box = element?.getBoundingClientRect();
    setBursts(current => [...current, {
      id: ++nextBurst.current,
      kind: target.kind === 'ordinary' || target.kind === 'gold' ? 'candy' : 'bat',
      x: field && box ? (box.left + box.width / 2 - field.left) / field.width * 100 : target.x,
      y: field && box ? (box.top + box.height / 2 - field.top) / field.height * 100 : target.y,
    }]);
    resolvedTargets.current.add(target.id);
    setTargets(current => current.filter(item => item.id !== target.id));
    setMessage(targetCopy[target.kind].hit);
    if (target.kind === 'thief') { tone(330); return; }
    setScore(current => candyScore(current, target.kind));
    if (target.kind === 'cursed') {
      setCombo(0);
      shake();
      tone(145, .18);
    } else {
      setCombo(current => current + 1);
      tone(target.kind === 'gold' ? 880 : 620, target.kind === 'gold' ? .15 : .07);
    }
  }

  function expire(target: Target) {
    if (phase !== 'playing' || resolvedTargets.current.has(target.id)) return;
    resolvedTargets.current.add(target.id);
    setTargets(current => current.filter(item => item.id !== target.id));
    if (target.kind !== 'thief') return;
    setScore(current => candyScore(current, 'thief', true));
    setCombo(0);
    setMessage('ผีขโมยไป 2 คะแนน');
    shake();
    tone(130, .2);
  }

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const pause = root.current?.closest('.public-home')?.querySelector<HTMLInputElement>('#home-event-pause');
    const sync = () => setReducedMotion(motion.matches || Boolean(pause?.checked));
    sync();
    motion.addEventListener('change', sync);
    pause?.addEventListener('change', sync);
    return () => { motion.removeEventListener('change', sync); pause?.removeEventListener('change', sync); };
  }, []);

  useEffect(() => () => {
    run.current++;
    clearTimeout(shakeTimer.current);
    clearTimeout(finishTimer.current);
    stopSound();
  }, []);

  useEffect(() => {
    if (phase === 'ready' || phase === 'result') heading.current?.focus({ preventScroll: true });
  }, [phase]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    const currentRun = run.current;
    const timer = window.setTimeout(() => {
      if (run.current !== currentRun) return;
      if (countdown > 1) { setCountdown(value => value - 1); tone(440 + (3 - countdown) * 80); }
      else {
        endAt.current = Date.now() + 30_000;
        setPhase('playing');
        tone(784, .16);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [phase, countdown]);

  useEffect(() => {
    if (phase !== 'playing') return;
    startMusic();
    const currentRun = run.current;
    const sync = () => {
      if (run.current !== currentRun) return;
      const left = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) finish(currentRun);
    };
    sync();
    const interval = window.setInterval(sync, 200);
    const visibility = () => {
      const context = sound.current;
      if (context && context.state !== 'closed') void (document.hidden ? context.suspend() : context.resume()).catch(() => {});
      if (!document.hidden) sync();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visibility); stopMusic(); };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'finishing') return;
    if (candyTier(score).id === 'sad') startVictoryMusic();
    else startCelebrationMusic();
  }, [phase, score]);

  useEffect(() => {
    const context = sound.current;
    const rate = music.current?.playbackRate;
    if (phase !== 'playing' || !context || !rate) return;
    try {
      rate.cancelScheduledValues(context.currentTime);
      rate.setTargetAtTime(candyMusicRate(secondsLeft), context.currentTime, .08);
    } catch { rate.value = candyMusicRate(secondsLeft); }
  }, [phase, secondsLeft]);

  useEffect(() => {
    if (phase !== 'playing' || document.hidden) return;
    const currentRun = run.current;
    const timer = window.setTimeout(() => {
      if (run.current !== currentRun || document.hidden) return;
      const kind = randomKind();
      setTargets(current => [...current, {
        id: ++nextTarget.current,
        kind,
        x: 6 + Math.random() * 82,
        y: 14 + Math.random() * 64,
        duration: Math.max(1.8, 3.25 - combo * .035),
        turn: -18 + Math.random() * 36,
      }]);
    }, candySpawnDelay(combo, secondsLeft));
    return () => window.clearTimeout(timer);
  }, [phase, combo, secondsLeft, targets.length]);

  const tier = candyTier(score);
  return <section ref={root} className="halloween-candy-game" data-halloween-candy-game={phase} data-candy-pace={phase === 'playing' ? secondsLeft <= 5 ? 'storm' : secondsLeft <= 20 ? 'rush' : 'normal' : undefined} data-shaking={shaking} data-still={reducedMotion} aria-labelledby={titleId}>
    {phase === 'ready' ? <>
      <div className="halloween-candy-heading"><p>ประตูสีส้มเปิดแล้ว</p><h2 ref={heading} id={titleId} tabIndex={-1}>คืนล่าลูกอมต้องสาป</h2><span>กดเก็บลูกอมกับฟักทอง กดไล่ผี และอย่ากดหัวกะโหลก</span></div>
      <div className="halloween-candy-ready-art" aria-hidden="true"><img src="/home/events/halloween/friendly-pumpkin.png" alt="" /><i>🍬</i><i>🍭</i><i>🎃</i></div>
      <ul className="halloween-candy-rules"><li><b>🍬 +1 pt</b><span>ลูกอมปกติ</span></li><li><b>🎃 +5 pt</b><span>ฟักทองทอง</span></li><li><b>☠️ −3 pt</b><span>ลูกอมต้องสาป</span></li><li><b>👻 กดไล่ผี</b><span>ถ้าปล่อยผี <strong>−2 pt</strong></span></li></ul>
      <div className="halloween-candy-ready-actions"><Button className="halloween-candy-primary" onClick={start}>เริ่มล่าลูกอม</Button>{onBack && <Button variant="quiet" onClick={onBack}>เลือกประตูอื่น</Button>}</div>
    </> : phase === 'countdown' ? <div className="halloween-candy-countdown" role="status" aria-live="polite"><p>เตรียมตะกร้าให้พร้อม</p><strong key={countdown}>{countdown}</strong></div>
      : phase === 'playing' || phase === 'finishing' ? <>
        <div className="halloween-candy-scorebar"><span><small>คะแนน</small><b>{score}</b></span><span className={secondsLeft <= 5 ? 'is-storm' : ''}><small>{phase === 'finishing' ? 'หมดเวลา!' : secondsLeft <= 5 ? 'ลูกอมถล่ม!' : 'เวลา'}</small><b>{secondsLeft}</b></span><span><small>คอมโบ</small><b>×{combo}</b></span></div>
        <div className="halloween-candy-stage">
          <div className="halloween-candy-field" aria-label="พื้นที่เก็บลูกอม">
            <div className="halloween-candy-sky" aria-hidden="true"><i /><i /><i /></div>
            {targets.map(target => <button key={target.id} type="button" disabled={phase !== 'playing'} className={`halloween-candy-target is-${target.kind}`} style={{ '--candy-x': `${target.x}%`, '--candy-y': `${target.y}%`, '--candy-duration': `${target.duration}s`, '--candy-turn': `${target.turn}deg` } as React.CSSProperties} aria-label={targetCopy[target.kind].label} onClick={event => hit(target, event?.currentTarget)} onAnimationEnd={() => expire(target)}><span aria-hidden="true">{targetCopy[target.kind].icon}</span></button>)}
            {bursts.map(burst => <span key={burst.id} className={`halloween-candy-burst is-${burst.kind}`} data-candy-burst={burst.kind} style={{ '--burst-x': `${burst.x}%`, '--burst-y': `${burst.y}%` } as React.CSSProperties} aria-hidden="true" onAnimationEnd={event => { if (event.target === event.currentTarget) setBursts(current => current.filter(item => item.id !== burst.id)); }}>{[0, 1, 2, 3, 4, 5].map(piece => <i key={piece}>{burst.kind === 'bat' ? '🦇' : piece % 2 ? '✦' : '🍬'}</i>)}</span>)}
            <p className="halloween-candy-hit" aria-hidden="true">{message}</p>
          </div>
          {phase === 'finishing' && <div className="halloween-candy-finale" aria-hidden="true"><img src={tier.image} alt="" /></div>}
        </div>
        {phase === 'finishing' && <span className="sr-only" role="status">กำลังเผยภาพผลลัพธ์</span>}
      </> : <>
        <div className="halloween-candy-heading"><p>จบคืนล่าลูกอมแล้ว</p><h2 ref={heading} id={titleId} tabIndex={-1}>{tier.title}</h2><span>เก็บได้ <b>{score} คะแนน</b></span></div>
        <div className="halloween-candy-result">
          <div className="halloween-candy-result-art"><img src={tier.image} alt={`น้องมั่งมีระดับ ${tier.title}`} /></div>
          <div className="halloween-candy-result-share"><HalloweenCandyShare score={score} /><div className="halloween-candy-result-actions">{onBack && <Button variant="quiet" onClick={onBack}>เลือกประตูอื่น</Button>}<Button variant="secondary" onClick={start}>เล่นอีกครั้ง</Button></div></div>
        </div>
      </>}
  </section>;
}
