'use client';

import * as React from 'react';
import { useEffect, useRef } from 'react';
import { HalloweenGhostGame } from './HalloweenGhostGame';
import { startHalloweenAudio } from './home-halloween-audio';

export function HalloweenEventPage({ initialCardId }: { initialCardId?: string }) {
  const stopAudio = useRef<(() => void) | null>(null);
  useEffect(() => () => { stopAudio.current?.(); }, []);

  return <div className="halloween-event-page" onClickCapture={() => {
    if (!stopAudio.current) stopAudio.current = startHalloweenAudio();
  }}>
    <header className="halloween-event-nav"><span>มั่งมีพลัส</span><a href="/">กลับหน้าแรก</a></header>
    <main>
      <p className="halloween-event-kicker">ฮาโลวีนกับน้องมั่งมี</p>
      <h1>ฮาโลวีนนี้ คุณจะเป็นผีอะไร?</h1>
      <HalloweenGhostGame key={initialCardId ?? 'mirror'} initialCardId={initialCardId} />
    </main>
    <footer>มั่งมีพลัส · <a href="https://line.me/R/ti/p/@mangmeeplus" target="_blank" rel="noopener noreferrer">LINE: @mangmeeplus</a></footer>
  </div>;
}
