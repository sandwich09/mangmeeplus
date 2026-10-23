'use client';

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

// Cues follow the approved voice track; native audio is the animation clock.
const SCENES = [
  { at: 0, title: 'ส่งรูป', caption: 'ส่งรูปใบเสร็จมาใน LINE ให้น้องมั่งมีช่วยอ่านได้เลยค่ะ' },
  { at: 4.32, title: 'น้องอ่านให้', caption: 'ชื่อร้าน วันที่ ยอดเงิน น้องเตรียมรายการให้ค่ะ' },
  { at: 7.54, title: 'ตรวจและยืนยัน', caption: 'ถ้าอ่านผิดตรงไหน คุณแก้ได้ ก่อนกดยืนยันนะคะ' },
  { at: 11.72, title: 'บันทึกเรียบร้อย', caption: 'เรียบร้อยค่ะ เก็บทั้งรายการและใบเสร็จไว้ดูย้อนหลังได้เลย' },
];
const DURATION = 16.82;
const SECONDS = Math.ceil(DURATION);

export function HomeReceiptStory() {
  const root = useRef<HTMLElement>(null), audio = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const scene = SCENES.reduce((current, item, index) => time >= item.at ? index : current, 0);
  const ended = time >= DURATION;
  const playLabel = loading ? 'กำลังโหลด…' : playing ? 'หยุดชั่วคราว' : ended ? 'เล่นอีกครั้ง' : time > 0 ? 'เล่นต่อ' : 'เล่น';
  const soundLabel = sound ? 'ปิดเสียง' : 'เปิดเสียง';
  const greeting = time === 0 && !playing;

  useEffect(() => {
    const media = audio.current;
    if (!media) return;
    const section = root.current, narrator = section?.querySelector('.receipt-narrator');
    const mascot = section?.querySelector('.receipt-character-reveal'), picture = mascot?.querySelector('img');
    let frame = 0, sectionVisible = true, playbackRequested = false;
    const sync = () => {
      setTime(Math.min(media.currentTime, DURATION));
      frame = requestAnimationFrame(sync);
    };
    const stop = () => { cancelAnimationFrame(frame); setTime(Math.min(media.currentTime, DURATION)); };
    const start = () => {
      if (document.hidden || !sectionVisible) { media.pause(); return; }
      narrator?.classList.add('is-visible', 'has-started');
      cancelAnimationFrame(frame); sync();
    };
    const requested = () => { playbackRequested = true; };
    media.addEventListener('play', requested);
    media.addEventListener('playing', start);
    const stopEvents = ['pause', 'waiting', 'ended', 'error'];
    stopEvents.forEach(event => media.addEventListener(event, stop));
    const pauseWhenHidden = () => { if (document.hidden) media.pause(); else reveal(); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    let mascotVisible = false, pictureReady = picture?.complete ?? true, introduced = false;
    const reveal = () => {
      if (!mascotVisible || !pictureReady || introduced || document.hidden) return;
      introduced = true;
      narrator?.classList.add('is-visible');
      if (mascot) observer?.unobserve(mascot);
      if (!playbackRequested) void play();
    };
    const pictureLoaded = () => { pictureReady = true; reveal(); };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target === section) {
          sectionVisible = entry.isIntersecting;
          if (!sectionVisible) { mascotVisible = false; media.pause(); }
        }
        if (entry.target === mascot) {
          mascotVisible = entry.isIntersecting && entry.intersectionRatio >= .35;
          reveal();
        }
      }
    }, { threshold: [0, .35], rootMargin: '-96px 0px -88px 0px' });
    if (section) observer?.observe(section);
    if (narrator && mascot && observer) { narrator.classList.add('is-ready'); observer.observe(mascot); }
    picture?.addEventListener('load', pictureLoaded);
    picture?.addEventListener('error', pictureLoaded);
    return () => {
      media.pause(); cancelAnimationFrame(frame); observer?.disconnect();
      media.removeEventListener('play', requested);
      media.removeEventListener('playing', start);
      stopEvents.forEach(event => media.removeEventListener(event, stop));
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      picture?.removeEventListener('load', pictureLoaded);
      picture?.removeEventListener('error', pictureLoaded);
      narrator?.classList.remove('is-ready', 'is-visible', 'has-started');
    };
  }, []);

  async function play() {
    const media = audio.current;
    if (!media) return;
    setError(false); setAutoplayBlocked(false); setLoading(true);
    if (media.currentTime >= DURATION || media.ended) { media.currentTime = 0; setTime(0); }
    try { await media.play(); }
    catch (failure) {
      if (failure instanceof Error && failure.name === 'AbortError') return;
      setLoading(false); setPlaying(false);
      if (failure instanceof Error && failure.name === 'NotAllowedError') setAutoplayBlocked(true);
      else setError(true);
    }
  }

  return <section className="receipt-story" id="receipt-story" ref={root} aria-labelledby="receipt-story-title" data-playing={playing && !loading} data-started={playing || time > 0} data-scene={scene}
    style={{ '--story-time': `${time}s` } as React.CSSProperties}>
    <div className="receipt-story-heading"><p className="ey">น้องมั่งมีเล่าให้ฟัง · {SECONDS} วินาที</p>
      <h4 id="receipt-story-title">จากใบเสร็จ เป็นรายการค่าใช้จ่าย</h4>
    </div>
    <div className="receipt-stage">
      <div className="receipt-narrator">
        <div className="receipt-caption">
          <p aria-live="polite" aria-atomic="true">{greeting ? 'มีใบเสร็จอยู่ใช่ไหม? ส่งให้น้องช่วยอ่านได้เลยค่ะ' : SCENES[scene]!.caption}</p>
          <span className="receipt-invitation" role="status">{autoplayBlocked ? 'แตะ ▶ เพื่อเริ่มเรื่องได้เลยค่ะ' : loading ? 'กำลังเตรียมเสียงให้นะคะ' : playing ? sound ? 'น้องมั่งมีกำลังเล่า' : 'เปิดเสียงเพื่อฟังน้องมั่งมีเล่าได้นะคะ' : ended ? 'กดเล่น ฟังอีกครั้งได้เลย' : time > 0 ? 'กดเล่น ฟังต่อได้เลย' : 'น้องพร้อมเล่าเรื่องส่งใบเสร็จให้ฟังค่ะ'}</span>
          <div className="receipt-controls">
            <button className="btn btn-primary" type="button" aria-label={playLabel} title={playLabel} aria-busy={loading} onClick={() => playing || loading ? audio.current?.pause() : void play()}>
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d={playing || loading ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z'} /></svg>
            </button>
            <button className="btn btn-soft" type="button" aria-label={soundLabel} title={soundLabel} onClick={() => {
              if (audio.current) audio.current.muted = sound;
              setSound(!sound);
            }}>
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor" />
                <path d={sound ? 'M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14' : 'm16 9 6 6m0-6-6 6'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="receipt-character-reveal"><div className="receipt-character">
          <span className="receipt-spark receipt-spark-a" aria-hidden="true">✦</span>
          <img className="mascot" src={scene === 1 ? '/home/mangmee-scanning.webp' : '/home/mangmee-reviewing.webp'} width="313" height="191" alt="น้องมั่งมีถือแว่นขยายช่วยอ่านใบเสร็จ" loading="eager" />
          <span className="receipt-spark receipt-spark-b" aria-hidden="true">✧</span>
        </div></div>
      </div>
      <div className="receipt-chat" aria-hidden="true">
        <div className="receipt-chat-head"><span className="receipt-avatar">ม</span><b>น้องมั่งมี</b><span>ตัวอย่างจำลอง</span></div>
        <div className="receipt-chat-scene">
          {scene === 0 ? <div className="receipt-upload">
            <span className="receipt-sent">ส่งรูปใบเสร็จแล้ว</span>
            <div className="receipt-paper"><span className="receipt-paper-icon">▤</span><b>ร้านวัตถุดิบสุขใจ</b><small>ใบเสร็จรับเงิน · 23/10/2569</small>
              <div><span>วัตถุดิบ</span><span>850.00</span></div><div><span>บรรจุภัณฑ์</span><span>150.00</span></div>
              <div className="receipt-total"><b>รวม</b><b>1,000 บาท</b></div>
            </div><span className="receipt-chat-note">ให้น้องช่วยอ่านใบนี้หน่อยค่ะ</span>
          </div> : scene < 3 ? <div className="receipt-draft">
            <p className="receipt-bubble">{scene === 1 ? 'น้องอ่านให้แล้วค่ะ' : 'ตรวจให้ถูก ก่อนบันทึกนะคะ'}</p>
            <div className="receipt-fields"><span className="receipt-state">{scene === 1 ? 'รายการรอตรวจ' : 'รอคุณยืนยัน'}</span>
              <dl><div><dt>ร้านค้า</dt><dd>ร้านวัตถุดิบสุขใจ</dd></div><div><dt>วันที่</dt><dd>23/10/2569</dd></div><div><dt>ยอดรวม</dt><dd>1,000 บาท</dd></div></dl>
              {scene === 2 && <div className="receipt-confirm"><span>แก้ไขข้อมูล</span><b>ยืนยันบันทึก</b></div>}
            </div>
            {scene === 1 && <p className="receipt-chat-note">ยังไม่บันทึก จนกว่าคุณจะยืนยัน</p>}
          </div> : <div className="receipt-success">
            <span className="receipt-check"><svg viewBox="0 0 48 48"><path d="m12 24 8 8 16-17" /></svg></span>
            <b>บันทึกเรียบร้อยค่ะ</b><p>ค่าใช้จ่ายร้านวัตถุดิบสุขใจ</p><strong>1,000 <small>บาท</small></strong><span className="receipt-kept">✓ เก็บรูปใบเสร็จไว้ด้วยแล้ว</span>
          </div>}
        </div>
        <div className="receipt-chat-foot">ส่งรูป · น้องอ่าน · คุณยืนยัน</div>
      </div>
    </div>
    <ol className="receipt-scenes" aria-label="ขั้นตอนส่งใบเสร็จ">{SCENES.map((item, index) => <li key={item.title} aria-current={scene === index ? 'step' : undefined}>
      <span>{index + 1}</span>{item.title}
    </li>)}</ol>
    <div className="receipt-playback"><progress value={time} max={DURATION} aria-label="ความคืบหน้าตัวอย่างส่งใบเสร็จ" /><span>{ended ? SECONDS : Math.floor(time)} / {SECONDS} วินาที</span></div>
    <p className="receipt-note">ข้อมูลตัวอย่าง · บันทึกจริงเมื่อคุณตรวจและกดยืนยันเท่านั้น</p>
    {error && <p className="receipt-error" role="alert">เล่นตัวอย่างไม่สำเร็จ ลองกดเล่นอีกครั้งนะคะ</p>}
    <audio ref={audio} src="/home/mangmee-receipt-story.m4a" preload="none" muted={!sound}
      onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)} onPlaying={() => { setPlaying(true); setLoading(false); }}
      onWaiting={() => setLoading(true)} onPause={() => { setPlaying(false); setLoading(false); }}
      onEnded={() => { setPlaying(false); setLoading(false); setTime(DURATION); }}
      onError={() => { setPlaying(false); setLoading(false); setError(true); }} />
  </section>;
}
