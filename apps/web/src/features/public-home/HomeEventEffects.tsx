'use client';

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

type Burst = { id: number; x: number; y: number; compact: boolean };
const flights = [[-110, -90, -28], [-45, -140, -12], [85, -115, 22], [135, -30, 35], [-130, 25, -38], [60, 65, 18]];

export function HomeEventEffects() {
  const layer = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLImageElement>(null);
  const nextId = useRef(0);
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    const home = layer.current?.closest<HTMLElement>('.public-home');
    const sprite = ghost.current;
    if (!home || !sprite) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const pause = home.querySelector<HTMLInputElement>('#home-event-pause');
    const content = home.querySelector<HTMLElement>('.pg');
    const column = home.querySelector<HTMLElement>('.w');
    const obstacles = [...home.querySelectorAll<HTMLElement>('.pg :is(h1,h2,h3,h4,p,a,button,summary,input,select,figure,li,dt,dd,img,.tbl,.docs-row,.card,.mbar), .home-event-tools')];
    const stopped = () => motion.matches || Boolean(pause?.checked);
    let frame = 0;

    function positionGhost() {
      frame = 0;
      if (!sprite || stopped()) return;
      const width = document.documentElement.clientWidth;
      const gutter = width - (column?.getBoundingClientRect().right ?? width);
      const size = width <= 700 ? 40 : Math.max(24, Math.min(64, gutter - 8));
      const height = size * 1273 / 1236;
      const progress = Math.min(1, Math.max(0, scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)));
      const top = 110 + progress * Math.max(0, innerHeight - 220 - height);
      const left = width - size - 2;
      // On phones the gutter cannot fit a readable ghost: show it only in clear space.
      const crowded = obstacles.some(el => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.right > left - 4 && box.left < width && box.bottom > top - 4 && box.top < top + height + 4;
      });
      sprite.style.width = `${size}px`;
      sprite.style.transform = `translateY(${top}px)`;
      sprite.style.opacity = crowded ? '0' : '1';
    }
    function schedulePosition() { if (!frame) frame = requestAnimationFrame(positionGhost); }
    function syncMotion() {
      if (stopped()) setBursts([]);
      schedulePosition();
    }
    function scatter(event: MouseEvent) {
      // Native click covers mouse and completed touch taps, without firing on a swipe.
      if (stopped() || event.button !== 0 || event.detail === 0 || !(event.target instanceof Element)
        || event.target.closest('.home-event-tools, input, textarea, select, [contenteditable], dialog')) return;
      const burst = { id: nextId.current++, x: event.clientX, y: event.clientY, compact: innerWidth <= 700 };
      setBursts(current => [...current.slice(-2), burst]);
    }

    home.addEventListener('click', scatter, { passive: true });
    window.addEventListener('scroll', schedulePosition, { passive: true });
    window.addEventListener('resize', schedulePosition);
    motion.addEventListener('change', syncMotion);
    pause?.addEventListener('change', syncMotion);
    const resize = new ResizeObserver(schedulePosition);
    if (content) resize.observe(content);
    schedulePosition();
    return () => {
      home.removeEventListener('click', scatter);
      window.removeEventListener('scroll', schedulePosition);
      window.removeEventListener('resize', schedulePosition);
      motion.removeEventListener('change', syncMotion);
      pause?.removeEventListener('change', syncMotion);
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={layer} className="home-event-interactions" data-event-art="" aria-hidden="true">
    <img ref={ghost} className="home-event-slide-ghost" src="/home/events/halloween/friendly-ghost.png" width="1236" height="1273" alt="" draggable={false} decoding="async" />
    {bursts.map(burst => <div key={burst.id} className="home-event-burst" style={{ left: burst.x, top: burst.y }}>
      {flights.map(([x, y, angle], index) => <span key={index} className="home-event-bat"
        style={{ '--bat-x': `${x * (burst.compact ? .7 : 1)}px`, '--bat-y': `${y * (burst.compact ? .7 : 1)}px`, '--bat-angle': `${angle}deg`, width: 26 + index % 3 * 4 } as React.CSSProperties}
        onAnimationEnd={index === 0 ? event => { if (event.target === event.currentTarget) setBursts(current => current.filter(item => item.id !== burst.id)); } : undefined}>
        <svg viewBox="0 0 40 24" fill="none">
          <g className="home-event-bat-wings"><path d="M18 10C12 2 5 2 1 1L3 15Q8 11 10 19Q14 15 18 20M22 10C28 2 35 2 39 1L37 15Q32 11 30 19Q26 15 22 20" /></g>
          <path d="m16 10 1-6 3 3 3-3 1 6c4 8-1 13-4 13s-8-5-4-13Z" />
          <circle cx="18.5" cy="12" r="1" fill="#ffe6a9" stroke="none" /><circle cx="21.5" cy="12" r="1" fill="#ffe6a9" stroke="none" />
        </svg>
      </span>)}
    </div>)}
  </div>;
}
