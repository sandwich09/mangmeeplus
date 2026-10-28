'use client';

import * as React from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/common/components/button/Button';
import { HalloweenEscapeShare } from './HalloweenEscapeShare';
import { applyEscapePenalty, ESCAPE_COLORS, ESCAPE_RUNES, escapeAudioPressure, escapeElapsedSeconds, escapeTier, makeEscapeRound, type EscapeColor, type EscapeRound, type EscapeRune } from './home-halloween-escape';

type Phase = 'ready' | 'countdown' | 'playing' | 'finishing' | 'result';
type Room = 'portrait' | 'candles' | 'key';

const portraits = ['เหนือเตาผิง', 'ข้างหน้าต่าง', 'กลางห้อง', 'ข้างนาฬิกา', 'เหนือโต๊ะ', 'มุมบันได'];

function EscapeRuneSymbol({ rune }: { rune: EscapeRune }) {
  if (rune !== 'sun') return ESCAPE_RUNES[rune].symbol;
  return <svg className="halloween-rune-symbol" viewBox="0 0 120 120" aria-hidden="true">
    <g fill="currentColor">
      <path d="M60 5 66 25 60 30 54 25Z"/><path d="M60 115 54 95 60 90 66 95Z"/>
      <path d="m5 60 20-6 5 6-5 6Z"/><path d="m115 60-20 6-5-6 5-6Z"/>
      <path d="m21 21 19 9 1 8-8-1Z"/><path d="m99 99-19-9-1-8 8 1Z"/>
      <path d="m99 21-9 19-8 1 1-8Z"/><path d="m21 99 9-19 8-1-1 8Z"/>
      <circle cx="60" cy="60" r="23"/><circle cx="60" cy="60" r="13" fill="#1a1018"/><circle cx="60" cy="60" r="7"/>
    </g>
  </svg>;
}

export function HalloweenEscapeGame({ onBack, onEnd, onStart }: { onBack?: () => void; onEnd?: () => void; onStart?: () => void }) {
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const music = useRef<AudioBufferSourceNode | null>(null);
  const musicGain = useRef<GainNode | null>(null);
  const doorBuffer = useRef<AudioBuffer | null>(null);
  const doorLoading = useRef(false);
  const doorSound = useRef<AudioBufferSourceNode | null>(null);
  const endAt = useRef(0);
  const run = useRef(0);
  const finished = useRef(false);
  const transitionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const doorFrame = useRef<number>(undefined);
  const [phase, setPhase] = useState<Phase>('ready');
  const [countdown, setCountdown] = useState(3);
  const [room, setRoom] = useState<Room>('portrait');
  const [round, setRound] = useState<EscapeRound>(() => makeEscapeRound());
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [mistakes, setMistakes] = useState(0);
  const [message, setMessage] = useState('');
  const [locked, setLocked] = useState(false);
  const [candleMode, setCandleMode] = useState<'memorize' | 'repeat'>('memorize');
  const [candleMemoryLeft, setCandleMemoryLeft] = useState(5);
  const [candleInput, setCandleInput] = useState<EscapeColor[]>([]);
  const [hasRune, setHasRune] = useState(false);
  const [hasColor, setHasColor] = useState(false);
  const [escaped, setEscaped] = useState(false);
  const [ghostFlash, setGhostFlash] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  function showTop() {
    root.current?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  function prepareAudio() {
    try {
      const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      if (!audio.current) audio.current = new Audio();
      const context = audio.current;
      void context.resume().catch(() => {});
      if (doorBuffer.current || doorLoading.current) return;
      doorLoading.current = true;
      void fetch('/home/events/halloween/escape-closing-metal-door.mp3')
        .then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error('door audio unavailable')))
        .then(data => context.decodeAudioData(data))
        .then(buffer => { if (audio.current === context) doorBuffer.current = buffer; })
        .catch(() => {})
        .finally(() => { doorLoading.current = false; });
    } catch { stopAudio(); }
  }

  function stopMusic() {
    try { music.current?.stop(); } catch { /* already stopped */ }
    music.current?.disconnect();
    musicGain.current?.disconnect();
    music.current = null;
    musicGain.current = null;
  }

  function stopAudio() {
    stopDoorSound();
    stopMusic();
    const context = audio.current;
    audio.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  function stopDoorSound() {
    const source = doorSound.current;
    doorSound.current = null;
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* already stopped */ }
    source.disconnect();
  }

  function startMusic() {
    const context = audio.current;
    if (!context || music.current || context.state === 'closed') return;
    try {
      const duration = 8;
      const rate = 11025;
      const buffer = context.createBuffer(1, duration * rate, rate);
      const samples = buffer.getChannelData(0);
      let peak = 0;
      for (let index = 0; index < samples.length; index++) {
        const time = index / rate;
        const beat = time % 1;
        const organ = .54 * Math.sin(2 * Math.PI * 82.41 * time) + .28 * Math.sin(2 * Math.PI * 123.47 * time) + .18 * Math.sin(2 * Math.PI * 164.81 * time);
        const pulse = Math.sin(2 * Math.PI * 49 * beat) * Math.exp(-7 * beat);
        const clock = Math.sin(2 * Math.PI * 1568 * (time % .5)) * Math.exp(-30 * (time % .5));
        const edge = Math.min(1, time / .08, (duration - time) / .08);
        samples[index] = (.48 * organ + .22 * pulse + .05 * clock) * edge;
        peak = Math.max(peak, Math.abs(samples[index]));
      }
      for (let index = 0; index < samples.length; index++) samples[index] /= peak || 1;
      const gain = context.createGain();
      gain.gain.value = .045;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      gain.connect(context.destination);
      source.start();
      music.current = source;
      musicGain.current = gain;
    } catch { stopMusic(); }
  }

  function startVictoryMusic() {
    const context = audio.current;
    if (!context || music.current || context.state === 'closed') return;
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
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      gain.connect(context.destination);
      source.start();
      music.current = source;
      musicGain.current = gain;
    } catch { stopMusic(); }
  }

  function tone(frequency: number, duration = .11, volume = .05) {
    const context = audio.current;
    if (!context || context.state === 'closed') return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = frequency < 180 ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(.001, now + duration);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now); oscillator.stop(now + duration);
    } catch { /* Sound is optional. */ }
  }

  function playDoorClosingSound() {
    const context = audio.current;
    const buffer = doorBuffer.current;
    if (!context || !buffer || context.state === 'closed') return;
    try {
      stopDoorSound();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => { source.disconnect(); if (doorSound.current === source) doorSound.current = null; };
      doorSound.current = source;
      source.start();
      source.stop(context.currentTime + 2.4);
    } catch { /* Sound is optional. */ }
  }

  function clearTimers() {
    clearTimeout(transitionTimer.current);
    clearTimeout(flashTimer.current);
    if (doorFrame.current !== undefined) cancelAnimationFrame(doorFrame.current);
    doorFrame.current = undefined;
  }

  function finish(didEscape: boolean, remaining = 0) {
    if (finished.current) return;
    finished.current = true;
    run.current++;
    clearTimers();
    stopMusic();
    setEscaped(didEscape);
    setSecondsLeft(Math.max(0, remaining));
    setLocked(true);
    setGhostFlash(false);
    setMessage('');
    setPhase('finishing');
    if (!didEscape && !reducedMotion) doorFrame.current = requestAnimationFrame(() => {
      doorFrame.current = undefined;
      playDoorClosingSound();
    });
    transitionTimer.current = setTimeout(() => {
      stopDoorSound();
      setPhase('result');
      if (!didEscape) onEnd?.();
      showTop();
    }, reducedMotion ? 500 : didEscape ? 1100 : 2400);
  }

  function start() {
    run.current++;
    finished.current = false;
    clearTimers();
    stopDoorSound();
    stopMusic();
    onStart?.();
    prepareAudio();
    tone(392, .12);
    setRound(makeEscapeRound());
    setPhase('countdown');
    setCountdown(3);
    setRoom('portrait');
    setSecondsLeft(60);
    setMistakes(0);
    setMessage('');
    setLocked(false);
    setCandleMode('memorize');
    setCandleInput([]);
    setHasRune(false);
    setHasColor(false);
    setEscaped(false);
    setGhostFlash(false);
    showTop();
  }

  function penalize() {
    if (finished.current) return;
    endAt.current = applyEscapePenalty(endAt.current);
    setMistakes(value => value + 1);
    setMessage('ผิด! เวลาหาย 5 วินาที');
    setGhostFlash(true);
    tone(118, .28, .075);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setGhostFlash(false), 760);
    const remaining = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
    setSecondsLeft(remaining);
    if (remaining === 0) finish(false);
  }

  function choosePortrait(index: number) {
    if (locked || phase !== 'playing') return;
    if (index !== round.portraitIndex) return penalize();
    setLocked(true);
    setHasRune(true);
    setMessage(`พบเบาะแส ${ESCAPE_RUNES[round.rune].label}`);
    tone(740, .18);
    const currentRun = run.current;
    transitionTimer.current = setTimeout(() => {
      if (run.current !== currentRun) return;
      setRoom('candles'); setCandleMode('memorize'); setCandleInput([]); setMessage('จำลำดับเปลวเทียนให้ดี'); setLocked(false);
    }, reducedMotion ? 300 : 720);
  }

  function chooseCandle(color: EscapeColor) {
    if (locked || phase !== 'playing' || candleMode !== 'repeat') return;
    const position = candleInput.length;
    if (round.candleSequence[position] !== color) { setCandleInput([]); return penalize(); }
    const next = [...candleInput, color];
    setCandleInput(next);
    tone(500 + position * 120, .12);
    if (next.length < round.candleSequence.length) return;
    setLocked(true);
    setHasColor(true);
    setMessage(`พบเบาะแส ${ESCAPE_COLORS[round.clueColor].label}`);
    const currentRun = run.current;
    transitionTimer.current = setTimeout(() => {
      if (run.current !== currentRun) return;
      setRoom('key'); setMessage('เลือกกุญแจที่ตรงกับเบาะแสทั้งสอง'); setLocked(false);
    }, reducedMotion ? 300 : 720);
  }

  function chooseKey(id: string) {
    if (locked || phase !== 'playing') return;
    if (id !== round.correctKeyId) return penalize();
    finish(true, Math.max(1, Math.ceil((endAt.current - Date.now()) / 1000)));
  }

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const pause = root.current?.closest('.public-home')?.querySelector<HTMLInputElement>('#home-event-pause');
    const sync = () => setReducedMotion(motion.matches || Boolean(pause?.checked));
    sync(); motion.addEventListener('change', sync); pause?.addEventListener('change', sync);
    return () => { motion.removeEventListener('change', sync); pause?.removeEventListener('change', sync); };
  }, []);

  useEffect(() => {
    ['/home/events/halloween/escape-wrong-ghost.png', '/home/events/halloween/escape-closing-door.png'].forEach(src => { const image = new Image(); image.src = src; });
  }, []);

  useEffect(() => () => { run.current++; clearTimers(); stopAudio(); }, []);

  useEffect(() => {
    if (phase === 'ready' || phase === 'result') heading.current?.focus({ preventScroll: true });
  }, [phase]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    const currentRun = run.current;
    const timer = window.setTimeout(() => {
      if (run.current !== currentRun) return;
      if (countdown > 1) { setCountdown(value => value - 1); tone(440 + (3 - countdown) * 90); }
      else { endAt.current = Date.now() + 60_000; setPhase('playing'); tone(784, .18); }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [phase, countdown]);

  useEffect(() => {
    if (phase !== 'playing') return;
    startMusic();
    const currentRun = run.current;
    const sync = () => {
      if (run.current !== currentRun || finished.current) return;
      const remaining = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) finish(false);
    };
    sync();
    const interval = window.setInterval(sync, 200);
    const visibility = () => {
      const context = audio.current;
      if (context && context.state !== 'closed') void (document.hidden ? context.suspend() : context.resume()).catch(() => {});
      if (!document.hidden) sync();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visibility); stopMusic(); };
  }, [phase]);

  useEffect(() => {
    if (phase === 'finishing' && escaped) startVictoryMusic();
  }, [phase, escaped]);

  useEffect(() => {
    if (phase !== 'playing' || room !== 'candles' || candleMode !== 'memorize') return;
    const currentRun = run.current;
    setCandleMemoryLeft(5);
    const interval = window.setInterval(() => setCandleMemoryLeft(value => Math.max(1, value - 1)), 1000);
    const timer = window.setTimeout(() => {
      if (run.current !== currentRun) return;
      setCandleMode('repeat'); setMessage('กดสีตามลำดับที่เห็น');
    }, 5000);
    return () => { window.clearInterval(interval); window.clearTimeout(timer); };
  }, [phase, room, candleMode]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const pressure = escapeAudioPressure(secondsLeft);
    if (music.current) music.current.playbackRate.value = pressure.rate;
    if (musicGain.current) musicGain.current.gain.value = pressure.gain;
    if (pressure.tick) tone(1450, .055, .04);
    else if (secondsLeft <= 15 && secondsLeft % 2) tone(98, .14, .025);
  }, [phase, secondsLeft]);

  const tier = escapeTier(escaped, secondsLeft);
  const elapsedSeconds = escapeElapsedSeconds(secondsLeft);
  return <section ref={root} className="halloween-escape-game" data-halloween-escape-game={phase} data-escape-room={room} data-ghost-flash={ghostFlash} data-still={reducedMotion} aria-labelledby={titleId}>
    {phase === 'ready' ? <>
      <div className="halloween-escape-heading"><p>ประตูสีเขียวเปิดแล้ว</p><h2 ref={heading} id={titleId} tabIndex={-1}>คฤหาสน์ไร้ทางออก</h2><span>ไขปริศนา 3 ห้อง แล้วหนีออกมาให้ทันใน 60 วินาที</span></div>
      <div className="halloween-escape-ready-art" aria-hidden="true">
        <img className="halloween-escape-mansion-art" src="/home/events/halloween/haunted-mansion-v2.jpg" alt="" />
        <span className="halloween-escape-fog"><i /><i /></span>
      </div>
      <ol className="halloween-escape-rules"><li><b>1</b><span>หาภาพที่แตกต่าง</span></li><li><b>2</b><span>จำลำดับเทียน</span></li><li><b>3</b><span>เลือกกุญแจจากเบาะแส</span></li></ol>
      <p className="halloween-escape-penalty">ตอบผิด เวลาหาย 5 วินาที</p>
      <div className="halloween-escape-ready-actions"><Button className="halloween-escape-primary" onClick={start}>เข้าคฤหาสน์</Button>{onBack && <Button variant="quiet" onClick={onBack}>เลือกประตูอื่น</Button>}</div>
    </> : phase === 'countdown' ? <div className="halloween-escape-countdown" role="status" aria-live="polite"><p>ประตูกำลังปิด</p><strong key={countdown}>{countdown}</strong></div>
      : phase === 'playing' || phase === 'finishing' ? <>
        <div className="halloween-escape-status"><span><small>ห้อง</small><b>{room === 'portrait' ? '1 / 3' : room === 'candles' ? '2 / 3' : '3 / 3'}</b></span><span className={secondsLeft <= 10 ? 'is-urgent' : ''}><small>{secondsLeft <= 10 ? 'รีบหนี!' : 'เวลา'}</small><b>{secondsLeft}</b></span><span><small>พลาด</small><b>{mistakes}</b></span></div>
        <div className="halloween-escape-clues" aria-label="เบาะแสที่พบ"><span className={hasRune ? 'is-found' : ''}>{hasRune ? <><EscapeRuneSymbol rune={round.rune} /> {ESCAPE_RUNES[round.rune].label}</> : 'เบาะแสรูปภาพ'}</span><span className={hasColor ? 'is-found' : ''}>{hasColor ? `● ${ESCAPE_COLORS[round.clueColor].label}` : 'เบาะแสเปลวเทียน'}</span></div>
        <div className="halloween-escape-room">
          {phase === 'finishing' ? <div className={`halloween-escape-finale is-${escaped ? 'escaped' : 'trapped'}`} aria-hidden="true"><div className={`halloween-escape-closing-door${escaped ? ' is-opening' : ''}`}><i /><i /><b /></div></div>
            : room === 'portrait' ? <><div className="halloween-escape-room-copy"><p>ห้องภาพกระซิบ</p><h3>ภาพไหนที่แตกต่าง</h3></div><div className="halloween-portraits">{portraits.map((label, index) => <button key={label} type="button" disabled={locked} className={index === round.portraitIndex ? 'is-different' : ''} onClick={() => choosePortrait(index)} aria-label={`ภาพเหมือน${label}${index === round.portraitIndex ? ' มีเลือดไหลจากมุมปาก' : ''}`}><img src={`/home/events/halloween/escape-portrait-${index === round.portraitIndex ? 'different' : 'normal'}.jpg`} alt="" /></button>)}</div></>
              : room === 'candles' ? <><div className="halloween-escape-room-copy"><p>ห้องเทียนดับ</p><h3>{candleMode === 'memorize' ? 'จำลำดับเปลวเทียน' : 'กดสีตามลำดับ'}</h3></div>{candleMode === 'memorize' ? <div className="halloween-candle-memory-stage"><img src="/home/events/halloween/escape-candle-memory-room.jpg" alt="" /><div className="halloween-candle-memory-timer" role="timer" aria-label={`เหลือเวลา ${candleMemoryLeft} วินาที`}><span aria-hidden="true">⌛</span><b aria-hidden="true">{candleMemoryLeft}</b></div><div className="halloween-candle-memory-list" aria-label={`ลำดับ ${round.candleSequence.map(color => ESCAPE_COLORS[color].label).join(' ')}`}>{round.candleSequence.map((color, index) => <span key={`${color}-${index}`} className={`is-${color}`} aria-hidden="true" />)}</div></div> : <><div className="halloween-candle-progress" aria-label={`กดแล้ว ${candleInput.length} จาก 3`}>{round.candleSequence.map((_, index) => <i key={index} className={index < candleInput.length ? 'is-done' : ''} />)}</div><div className="halloween-candle-stage is-interactive"><img src="/home/events/halloween/escape-candle-room.jpg" alt="" /><div className="halloween-candle-buttons">{(Object.keys(ESCAPE_COLORS) as EscapeColor[]).map(color => <button key={color} type="button" disabled={locked} className={`is-${color}`} onClick={() => chooseCandle(color)} aria-label={ESCAPE_COLORS[color].label} />)}</div></div></>}</>
                : <><div className="halloween-escape-room-copy"><p>ห้องประตูต้องสาป</p><h3>กุญแจดอกไหนเปิดประตูนี้?</h3></div><div className="halloween-key-buttons">{round.keys.map(candidate => <button key={candidate.id} type="button" disabled={locked} className={`is-${candidate.color}`} onClick={() => chooseKey(candidate.id)} aria-label={`กุญแจ${ESCAPE_RUNES[candidate.rune].label} ${ESCAPE_COLORS[candidate.color].label}`}><span aria-hidden="true">🗝</span><b><EscapeRuneSymbol rune={candidate.rune} /></b></button>)}</div></>}
          {phase === 'playing' && <p className="halloween-escape-message" role="status" aria-live="polite">{message}</p>}
          {ghostFlash && <div className="halloween-escape-ghost" aria-hidden="true"><img src="/home/events/halloween/escape-wrong-ghost.png" alt="" /></div>}
        </div>
      </> : <>
        <div className="halloween-escape-heading"><p>{escaped ? 'หนีออกจากคฤหาสน์ได้แล้ว' : 'หมดเวลาแล้ว'}</p><h2 ref={heading} id={titleId} tabIndex={-1}>{tier.title}</h2>{escaped && <span>{elapsedSeconds} วินาที</span>}</div>
        <div className="halloween-escape-result">
          <div className={`halloween-escape-result-art is-${tier.id}`}><div className="halloween-escape-result-door"><img src={`/home/events/halloween/escape-result-${escaped ? 'winner' : 'loser'}.png`} alt={escaped ? 'น้องมั่งมีหนีออกจากคฤหาสน์ได้แล้ว' : 'น้องมั่งมีติดอยู่ในคฤหาสน์'} /></div><p>{tier.title}</p></div>
          <div className="halloween-escape-result-share"><HalloweenEscapeShare escaped={escaped} secondsLeft={secondsLeft} /><div className="halloween-escape-result-actions">{onBack && <Button variant="quiet" onClick={onBack}>เลือกประตูอื่น</Button>}<Button variant="secondary" onClick={start}>เล่นอีกครั้ง</Button></div></div>
        </div>
      </>}
  </section>;
}
