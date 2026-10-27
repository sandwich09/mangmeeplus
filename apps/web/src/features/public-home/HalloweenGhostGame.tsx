'use client';

import * as React from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/common/components/button/Button';
import { HalloweenCardShare } from './HalloweenCardShare';
import { getGhostCard, SECRET_CARD_BACK, STANDARD_CARD_BACK, type GhostCard, type GhostRegion } from './home-halloween-cards';
import { prepareHalloweenRevealAudio } from './home-halloween-reveal-audio';
import { requestHalloweenDraw } from './home-halloween-draw';

const worlds: Record<GhostRegion, { name: string; whisper: string; marks: string[] }> = {
  thai: { name: 'โลกวิญญาณ', whisper: 'ม่านหมอกสีทองกำลังเปิดทาง', marks: ['❧', '✧', '❧', '✧', '❧', '✧', '❧', '✧'] },
  western: { name: 'โลกวิญญาณ', whisper: 'กุหลาบใต้แสงจันทร์กำลังผลิบาน', marks: ['bat', 'rose', 'bat', 'rose', 'bat', 'rose', 'bat', 'rose'] },
  japanese: { name: 'โลกวิญญาณ', whisper: 'กลีบซากุระพาร่างของคุณกลับมา', marks: ['petal', '✧', 'petal', '✧', 'petal', '✧', 'petal', '✧'] },
  chinese: { name: 'โลกวิญญาณ', whisper: 'แสงโคมกำลังนำทางร่างของคุณ', marks: ['lantern', '☁', 'lantern', '☁', 'lantern', '☁', 'lantern', '☁'] },
  korean: { name: 'โลกวิญญาณ', whisper: 'แสงจันทร์กำลังกระซิบชื่อของคุณ', marks: ['petal', '✦', 'petal', '✦', 'petal', '✦', 'petal', '✦'] },
  secret: { name: 'SECRET ที่ซ่อนอยู่', whisper: 'มีแสงพิเศษลอดออกมาจากกระจก…', marks: ['✦', 'candy', '✧', '✦', 'candy', '✧', '✦', 'candy'] },
};

function RevealMarks({ region }: { region: GhostRegion }) {
  return <div className="halloween-reveal-marks" aria-hidden="true">
    <i className="halloween-reveal-ring" /><i className="halloween-reveal-ring halloween-reveal-ring-two" />
    {worlds[region].marks.map((mark, index) => <span key={index} className={`halloween-reveal-mark halloween-mark-${mark}`} style={{ '--mark-index': index } as React.CSSProperties}>
      {mark === 'bat' ? <svg viewBox="0 0 44 26"><path d="M20 10C13 2 6 3 1 1l3 16q6-4 8 5 4-5 9 1h2q5-6 9-1 2-9 8-5l3-16c-5 2-12 1-19 9l-1-6-3 4Z" /></svg>
        : mark === 'rose' ? <svg viewBox="0 0 40 40"><path d="M20 5c9-8 16 3 11 8 13 3 8 18 0 17-2 12-18 10-18 2C0 34-3 19 8 15 2 4 15-2 20 5Z" /><path d="M14 14q12-7 14 6-2 11-12 6-9-8 5-10" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
          : mark === 'lantern' ? <svg viewBox="0 0 40 52"><path d="M14 4h12v5H14zM10 12Q20 6 30 12q12 15 0 28-10 6-20 0Q-2 27 10 12Z" /><path d="M19 10v33M12 12q-8 14 0 27M27 12q8 14 0 27M20 44v7" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            : mark === 'candy' ? <svg viewBox="0 0 50 30"><path d="m4 2 10 7a14 14 0 0 1 22 0l10-7-3 13 3 13-10-7a14 14 0 0 1-22 0L4 28l3-13Z" /><path d="m20 5-4 19M30 5l-4 20" stroke="currentColor" strokeWidth="3" /></svg>
              : mark === 'petal' ? <svg viewBox="0 0 30 38"><path d="M15 0C-9 12 3 35 15 38 28 33 39 12 15 0Z" /></svg> : mark}
    </span>)}
  </div>;
}

export function HalloweenGhostGame({ initialCardId, onBack }: { initialCardId?: string; onBack?: () => void }) {
  const initial = initialCardId ? getGhostCard(initialCardId) : undefined;
  const [card, setCard] = useState<GhostCard | undefined>(initial);
  const [phase, setPhase] = useState<'ready' | 'loading' | 'drawing' | 'revealed'>(initial ? 'revealed' : 'ready');
  const [sharedPreview, setSharedPreview] = useState(Boolean(initial));
  const [imageStatus, setImageStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [imageAttempt, setImageAttempt] = useState(0);
  const [error, setError] = useState('');
  const [still, setStill] = useState(false);
  const root = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const cardImage = useRef<HTMLImageElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopSound = useRef<(() => void) | undefined>(undefined);
  const drawing = useRef(false);
  const request = useRef<AbortController | undefined>(undefined);
  const reducedMotion = useRef(false);
  const activeCard = useRef(initial?.id);
  const titleId = useId();

  function clearReveal() {
    clearTimeout(timer.current);
    stopSound.current?.();
    stopSound.current = undefined;
  }

  function showGameTop() {
    const element = root.current;
    const dialog = element?.closest('dialog');
    if (dialog) dialog.scrollTop = 0;
    else if (element && element.getBoundingClientRect().top < 0) element.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  function reveal() {
    clearReveal();
    drawing.current = false;
    setPhase('revealed');
    showGameTop();
  }

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const pause = root.current?.closest('.public-home')?.querySelector<HTMLInputElement>('#home-event-pause');
    const sync = () => {
      const disabled = motion.matches || Boolean(pause?.checked);
      reducedMotion.current = disabled;
      setStill(disabled);
      if (disabled && drawing.current && !request.current) reveal();
    };
    sync();
    motion.addEventListener('change', sync);
    pause?.addEventListener('change', sync);
    return () => {
      motion.removeEventListener('change', sync);
      pause?.removeEventListener('change', sync);
      request.current?.abort();
      request.current = undefined;
      clearReveal();
      drawing.current = false;
    };
  }, []);

  useEffect(() => { if (phase !== 'drawing') title.current?.focus({ preventScroll: true }); }, [phase]);

  useEffect(() => {
    const image = cardImage.current;
    // A shared card can finish loading before hydration attaches onLoad.
    if (card && activeCard.current === card.id && image?.complete && image.naturalWidth > 0) setImageStatus('loaded');
  }, [card, phase, imageAttempt]);

  async function draw() {
    if (drawing.current) return;
    drawing.current = true;
    clearReveal();
    activeCard.current = undefined;
    setCard(undefined);
    setSharedPreview(false);
    setError('');
    setPhase('loading');
    showGameTop();
    const audio = reducedMotion.current ? undefined : prepareHalloweenRevealAudio();
    stopSound.current = audio?.stop;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const result = await requestHalloweenDraw(controller.signal, window.location.search);
      if (request.current !== controller) return;
      if (controller.signal.aborted) throw new Error('Draw aborted');
      request.current = undefined;
      const selected = getGhostCard(result.cardId)!;
      const preload = new Image();
      preload.src = selected.image;
      activeCard.current = selected.id;
      setCard(selected);
      setImageStatus('loading');
      setImageAttempt(current => current + 1);
      setPhase('drawing');
      if (!reducedMotion.current) audio?.play(selected.region);
      else audio?.stop();
      timer.current = setTimeout(reveal, reducedMotion.current ? 80 : selected.region === 'secret' ? 7500 : 4500);
    } catch {
      if (request.current !== controller) return;
      request.current = undefined;
      clearReveal();
      drawing.current = false;
      setPhase('ready');
      setError(controller.signal.aborted ? 'เรียกวิญญาณนานเกินไป ลองอีกครั้ง' : 'เรียกวิญญาณไม่ได้ ลองอีกครั้ง');
    } finally {
      clearTimeout(timeout);
    }
  }

  const region = card?.region ?? 'thai';
  const theme = worlds[region];
  const back = card?.region === 'secret' ? SECRET_CARD_BACK : STANDARD_CARD_BACK;
  return <section ref={root} className="halloween-ghost-game" data-halloween-game={phase} data-region={region} data-card-id={card?.id} data-still={still} data-shared-preview={sharedPreview} aria-labelledby={titleId}>
    {phase === 'ready' || phase === 'loading' ? <>
      <div className="halloween-game-heading"><p className="halloween-game-kicker">คืนที่กระจกมองเห็นอีกด้านของคุณ</p><h2 ref={title} id={titleId} tabIndex={-1}>กระจกเผยร่างผี</h2><p>โลกวิญญาณ กับหนึ่ง SECRET ที่ซ่อนอยู่<br />คืนนี้… กระจกจะพบใครในตัวคุณ?</p></div>
      <div className="halloween-mirror-scene" aria-hidden="true"><span className="halloween-mirror-spark halloween-mirror-spark-one">✦</span><div className="halloween-mirror"><div className="halloween-mirror-glass"><img src={STANDARD_CARD_BACK} alt="" draggable={false} /><span className="halloween-mirror-shine" /></div><span className="halloween-mirror-crown">✧</span><span className="halloween-mirror-foot" /></div><span className="halloween-mirror-spark halloween-mirror-spark-two">✧</span><span className="halloween-mirror-mist" /></div>
      <div className="halloween-game-ready-actions"><Button className="halloween-game-primary" onClick={draw} loading={phase === 'loading'} aria-live="polite">{phase === 'loading' ? 'กำลังเรียกวิญญาณ…' : 'เผยร่างของฉัน'}</Button>{onBack && <Button variant="quiet" onClick={onBack}>เลือกประตูอื่น</Button>}</div>
      {error && <p className="halloween-game-error" role="alert">{error}</p>}
    </> : phase === 'drawing' && card ? <>
      <div className="halloween-game-heading" aria-live="polite"><p className="halloween-game-kicker">{region === 'secret' ? 'กระจกกำลังเปลี่ยนไป' : 'ได้ยินเสียงกระซิบจากอีกฝั่ง…'}</p><h2 id={titleId}>{theme.name}</h2><p>{theme.whisper}</p></div>
      <div className="halloween-reveal-scene" aria-hidden="true">
        <RevealMarks region={region} /><div className="halloween-reveal-halo" /><span className="halloween-reveal-bloom" />
        {region === 'secret' && <><span className="halloween-secret-orbit" /><span className="halloween-secret-crown">✦<span>SECRET</span>✦</span><span className="halloween-secret-stardust">✧ · ✦ · ✧</span></>}
        <div className="halloween-reveal-card"><div className="halloween-reveal-flipper">
          <span className="halloween-reveal-face halloween-reveal-back"><img src={back} alt="" draggable={false} /></span>
          <span className="halloween-reveal-face halloween-reveal-front"><img src={back} alt="" draggable={false} /></span>
        </div></div>
        <div className="halloween-reveal-mist" /><div className="halloween-reveal-smoke"><i /><i /><i /></div>
      </div>
      <p className="halloween-game-reveal-status" role="status">{region === 'secret' ? 'แสงสีทองกำลังเผย SECRET' : 'ร่างของคุณกำลังปรากฏในกระจก'}</p>
    </> : card ? <>
      <div className="halloween-game-heading"><p className="halloween-game-kicker">{sharedPreview ? 'เพื่อนส่งร่างนี้มาให้คุณ' : region === 'secret' ? 'คุณพบ SECRET ของคืนนี้!' : 'กระจกเผยร่างของคุณแล้ว'}</p><h2 ref={title} id={titleId} tabIndex={-1}>{card.name}</h2><p>{card.tag}</p></div>
      <div className="halloween-game-result">
        <div className="halloween-game-art"><div className="halloween-game-card" aria-busy={imageStatus === 'loading'}>
          <img ref={cardImage} key={`${card.id}-${imageAttempt}`} src={card.image} alt={`การ์ด${card.name} ${card.tag}`} draggable={false} onLoad={() => { if (activeCard.current === card.id) setImageStatus('loaded'); }} onError={() => { if (activeCard.current === card.id) setImageStatus('error'); }} hidden={imageStatus === 'error'} />
          {imageStatus === 'loading' && <span className="halloween-game-image-status" role="status">กำลังโหลดการ์ด…</span>}
          {imageStatus === 'error' && <div className="halloween-game-image-error" role="alert"><p>ภาพการ์ดยังโหลดไม่ได้<br />ร่างเดิมของคุณยังอยู่</p><Button variant="secondary" onClick={() => { setImageStatus('loading'); setImageAttempt(current => current + 1); }}>โหลดภาพอีกครั้ง</Button></div>}
        </div><p className="halloween-game-quote">{card.quote.map((line, index) => <React.Fragment key={line}>{index > 0 && <br />}{line}</React.Fragment>)}</p></div>
        <div className="halloween-game-sharing"><HalloweenCardShare card={card} /><div className="halloween-game-result-actions" data-halloween-result-actions="">{onBack ? <Button variant="quiet" onClick={onBack}>เลือกประตูอื่น</Button> : <Button variant="quiet" onClick={() => { clearReveal(); setCard(undefined); activeCard.current = undefined; setPhase('ready'); showGameTop(); }}>กลับไปหน้ากระจก</Button>}<Button variant="secondary" onClick={draw}>{sharedPreview ? 'เผยร่างของฉัน' : 'เผยร่างอีกครั้ง'}</Button></div>{error && <p className="halloween-game-error" role="alert">{error}</p>}</div>
      </div>
    </> : null}
  </section>;
}
