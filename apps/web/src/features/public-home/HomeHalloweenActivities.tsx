'use client';

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { startHalloweenAudio } from './home-halloween-audio';
import { HalloweenGhostGame } from './HalloweenGhostGame';
import { countdownParts, formatCountdown, HALLOWEEN_GAME_DEADLINES } from './home-halloween-countdown';

const activities = [
  { id: 'ghost', color: 'ม่วง', title: 'กระจกเผยร่างผี', description: 'ฮาโลวีนนี้ คุณจะเป็นผีอะไร?', intro: 'โลกวิญญาณ กับหนึ่ง SECRET ที่ซ่อนอยู่', image: 'friendly-ghost', width: 1236, height: 1273 },
  { id: 'candy', color: 'ส้ม', title: 'คืนล่าลูกอมต้องสาป', description: 'เก็บลูกอมใน 30 วินาที', intro: 'เตรียมตะกร้าให้พร้อม แล้วมาเก็บลูกอมให้ทันก่อนผีจะมาใน 30 วินาที', image: 'friendly-pumpkin', width: 1236, height: 1273 },
  { id: 'escape', color: 'เขียว', title: 'คฤหาสน์ไร้ทางออก', description: 'ไขปริศนา 3 ข้อเพื่อหาทางออก', intro: 'ไขปริศนา 3 ข้อ แล้วหาทางออกจากคฤหาสน์ก่อนค่ำคืนนี้จะจบลง', image: 'mangmee-peeking', width: 1312, height: 1199 },
] as const;

type Activity = typeof activities[number];
const openingDateFormatter = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });

function HalloweenCountdown({ activity, now }: { activity: 'candy' | 'escape'; now: number }) {
  const countdown = countdownParts(HALLOWEEN_GAME_DEADLINES[activity], now);
  const openingDate = openingDateFormatter.format(HALLOWEEN_GAME_DEADLINES[activity]);
  return <span className="home-halloween-countdown" id={`home-halloween-${activity}-countdown`} data-halloween-countdown={activity} aria-live="off">
    {countdown ? <>
      <span className="home-halloween-countdown-value" role="timer" aria-live="off" aria-label={`เหลือเวลา ${formatCountdown(countdown)}`}>{formatCountdown(countdown)}</span>
      <span className="home-halloween-countdown-date">เปิด {openingDate} เวลา 00:00 น. กรุงเทพฯ</span>
    </> : <span className="home-halloween-countdown-status">กำลังเตรียมเกม</span>}
  </span>;
}

function DoorIllustration({ activity }: { activity: Activity }) {
  return <span className={`home-halloween-scene home-halloween-${activity.id}`} data-event-art="" aria-hidden="true">
    <span className="home-halloween-doorframe">
      <span className="home-halloween-doorpanel" />
      <svg className="home-halloween-doorstar" viewBox="0 0 24 24"><path d="m12 0 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" /></svg>
      <img src={`/home/events/halloween/${activity.image}.png`} width={activity.width} height={activity.height} alt="" draggable={false} />
      <span className="home-halloween-doorknob" />
    </span>
    <span className="home-halloween-threshold" />
  </span>;
}

export function HomeHalloweenActivities({ autoOpen = false }: { autoOpen?: boolean }) {
  const [selected, setSelected] = useState<Activity | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [countdownNow, setCountdownNow] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const entrance = useRef<HTMLButtonElement>(null);
  const introTitle = useRef<HTMLHeadingElement>(null);
  const firstDoor = useRef<HTMLButtonElement>(null);
  const stopAudio = useRef<(() => void) | null>(null);
  const introIsUpcoming = selected && selected.id !== 'ghost' && countdownParts(HALLOWEEN_GAME_DEADLINES[selected.id], countdownNow);

  useEffect(() => () => { stopAudio.current?.(); }, []);

  useEffect(() => {
    if (autoOpen) open(false);
  }, [autoOpen]);

  useEffect(() => {
    if (!dialogOpen) return;
    const sync = () => setCountdownNow(Date.now());
    sync();
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 1000);
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [dialogOpen]);

  useEffect(() => {
    if (!dialog.current?.open) return;
    if (selected && selected.id !== 'ghost') introTitle.current?.focus();
    else firstDoor.current?.focus();
    dialog.current.scrollTop = 0;
  }, [selected]);

  function startAudio() {
    if (!stopAudio.current) stopAudio.current = startHalloweenAudio();
  }

  function stop() {
    stopAudio.current?.();
    stopAudio.current = null;
  }

  function open(withAudio = true) {
    if (withAudio) startAudio();
    setSelected(null);
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    if (dialog.current?.open) {
      setCountdownNow(Date.now());
      setDialogOpen(true);
    }
    if (dialog.current) dialog.current.scrollTop = 0;
  }

  function close() {
    stop();
    setDialogOpen(false);
    dialog.current?.close();
  }

  return <div className="home-halloween-activity" data-halloween-activity="">
    <div className="home-halloween-entry">
      <span className="home-halloween-entry-ghost" data-event-art="" aria-hidden="true"><img src="/home/events/halloween/friendly-ghost.png" width="1236" height="1273" alt="" draggable={false} /></span>
      <div className="home-halloween-entry-copy"><p>ก๊อก ก๊อก… เปิดประตูมาสนุกกัน!</p><span>3 ประตู 3 ความสนุกจากน้องมั่งมี</span></div>
      <button ref={entrance} type="button" className="home-halloween-entry-button" aria-haspopup="dialog" onClick={() => open()}>ร่วมกิจกรรม</button>
    </div>
    <dialog ref={dialog} className="home-halloween-dialog" data-playing-ghost={selected?.id === 'ghost'} aria-labelledby="home-halloween-title"
      onCancel={() => { stop(); setDialogOpen(false); }}
      onClose={event => {
        if (event.currentTarget.open) return;
        stop();
        setDialogOpen(false);
        setSelected(null);
        entrance.current?.focus({ preventScroll: true });
      }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')]
          .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}>
      <div className="home-halloween-dialog-content">
        <button type="button" className="home-halloween-close" aria-label="ปิดกิจกรรม" autoFocus onClick={close}><span aria-hidden="true">×</span></button>
        <header className="home-halloween-dialog-header" hidden={selected?.id === 'ghost'}>
          <p className="home-halloween-eyebrow"><span aria-hidden="true">✦</span> กิจกรรมฮาโลวีนจากมั่งมีพลัส <span aria-hidden="true">✦</span></p>
          <h2 id="home-halloween-title">{selected?.id === 'ghost' ? 'กระจกเผยร่างผี' : selected ? 'อีกไม่นาน… ได้สนุกด้วยกัน' : 'ก๊อก ก๊อก… กล้าเปิดไหม?'}</h2>
          <p>{selected ? 'น้องมั่งมีกำลังเตรียมความสนุกไว้ให้' : 'หลังประตูนี้มีเรื่องหลอนรออยู่ เลือกบานที่อยากลองได้เลย'}</p>
        </header>
        {selected?.id === 'ghost' ? <HalloweenGhostGame onBack={() => setSelected(null)} /> : selected ? <section className={`home-halloween-intro home-halloween-${selected.id}`} data-halloween-intro={selected.id}>
          <DoorIllustration activity={selected} />
          <div className="home-halloween-intro-copy">
            {introIsUpcoming && <span className="home-halloween-soon">เร็ว ๆ นี้</span>}
            <h3 ref={introTitle} tabIndex={-1} aria-describedby={`home-halloween-${selected.id}-intro home-halloween-${selected.id}-countdown`}>{selected.title}</h3>
            <p id={`home-halloween-${selected.id}-intro`}>{selected.intro}</p>
            <HalloweenCountdown activity={selected.id} now={countdownNow} />
            <button type="button" className="home-halloween-back" onClick={() => setSelected(null)}>เลือกประตูอื่น</button>
          </div>
        </section> : <div className="home-halloween-doors">
          {activities.map((activity, index) => {
            const locked = activity.id !== 'ghost' && !!countdownParts(HALLOWEEN_GAME_DEADLINES[activity.id], countdownNow);
            return <button key={activity.id} ref={index === 0 ? firstDoor : undefined} type="button" disabled={locked}
              className={`home-halloween-choice home-halloween-${activity.id}`} data-halloween-door={activity.id}
              aria-labelledby={`home-halloween-${activity.id}-title`} aria-describedby={activity.id === 'ghost' ? undefined : `home-halloween-${activity.id}-description home-halloween-${activity.id}-countdown`} onClick={() => { startAudio(); setSelected(activity); }}>
              <DoorIllustration activity={activity} />
              <span className="home-halloween-choice-copy">
                <span className="home-halloween-door-label">ประตูสี{activity.color}</span>
                <span className="home-halloween-choice-title" id={`home-halloween-${activity.id}-title`}>{activity.title}</span>
                <span className="home-halloween-choice-description" id={`home-halloween-${activity.id}-description`}>{activity.description}</span>
                {activity.id !== 'ghost' && <HalloweenCountdown activity={activity.id} now={countdownNow} />}
                <span className="home-halloween-door-action" aria-hidden="true">{locked ? 'เปิดได้เมื่อครบเวลา' : activity.id === 'ghost' ? 'เปิดกระจกเผยร่าง' : 'เปิดประตู'}</span>
              </span>
            </button>;
          })}
        </div>}
        {selected?.id !== 'ghost' && <p className="home-halloween-dialog-note">หลอนนิด ๆ น่ารักหน่อย ๆ แบบน้องมั่งมี</p>}
      </div>
    </dialog>
  </div>;
}
