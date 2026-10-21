import * as React from 'react';
import Link from 'next/link';

import { HOME_EVENTS, type HomeEvent } from '@watchdog-bms/contracts';
export { HOME_EVENTS, resolveHomeEvent, type HomeEvent } from '@watchdog-bms/contracts';
export const HOME_EVENT_PALETTES = { forest: 'เขียวป่า', pumpkin: 'ครีมฟักทอง', plum: 'ม่วงพลัม' } as const;
export type HomeEventPalette = keyof typeof HOME_EVENT_PALETTES;
export const DEFAULT_HOME_EVENT_PALETTE: HomeEventPalette = 'plum';

export function resolveHomeEventPalette(value: string | string[] | undefined): HomeEventPalette {
  return typeof value === 'string' && Object.hasOwn(HOME_EVENT_PALETTES, value) ? value as HomeEventPalette : DEFAULT_HOME_EVENT_PALETTE;
}

export function HomeEventPreviewTools({ event, palette }: { event: HomeEvent; palette: HomeEventPalette }) {
  return <details className="home-event-tools" open>
    <summary><span className="home-event-tool-dot" aria-hidden="true" />พรีวิวธีมหน้าแรก<span className="home-event-chevron" aria-hidden="true">⌄</span></summary>
    <nav aria-label="เลือกธีมหน้าแรก">
      {Object.entries(HOME_EVENTS).map(([id, title]) => <Link key={id} href={`/?preview=events&event=${id}&palette=${palette}`} prefetch={false} scroll={false}
        aria-current={event === id ? 'true' : undefined}>{title}</Link>)}
    </nav>
    {event === 'halloween' && <div className="home-event-palettes">
      <p id="home-event-palette-label">สีพื้นหลัง</p>
      <nav aria-labelledby="home-event-palette-label">
        {Object.entries(HOME_EVENT_PALETTES).map(([id, title]) => <Link key={id} href={`/?preview=events&event=halloween&palette=${id}`} prefetch={false} scroll={false}
          aria-current={palette === id ? 'true' : undefined}>
          <span className={`home-event-swatch home-event-swatch-${id}`} aria-hidden="true" />{title}
        </Link>)}
      </nav>
    </div>}
    <label className="home-event-motion"><input type="checkbox" id="home-event-pause" disabled={event === 'default'} />หยุดเอฟเฟกต์</label>
  </details>;
}

const assetRoot = '/home/events/halloween/';

export function HomeEventArtwork({ event, placement }: { event: HomeEvent; placement: 'hero' | 'middle' | 'stage' | 'faq' | 'footer' }) {
  if (event !== 'halloween') return null;
  const image = (name: string, className: string, width: number, height: number, lazy = true) =>
    <img src={`${assetRoot}${name}.png`} className={className} alt="" width={width} height={height} loading={lazy ? 'lazy' : 'eager'} decoding="async" draggable={false} />;
  return <div className={`home-event-art home-event-${placement}`} data-event-art="" aria-hidden="true">
    {placement === 'hero' && <>
      <span className="home-event-moon" />
      {image('mangmee-broom', 'home-event-broom', 1536, 1024, false)}
      {image('friendly-ghost', 'home-event-ghost', 1236, 1273, false)}
    </>}
    {(placement === 'hero' || placement === 'middle') && (placement === 'middle'
      ? [['1.5%', '10%', '0s'], ['97%', '24%', '-2s'], ['1.5%', '43%', '-4s'], ['97%', '64%', '-1s'], ['1.5%', '84%', '-3s'], ['97%', '94%', '-5s'], ['45%', '24px', '-2s'], ['61%', 'calc(100% - 28px)', '-4s']]
      : [['9%', '15%', '0s'], ['24%', '10%', '-2s'], ['82%', '29%', '-4s'], ['91%', '38%', '-1s'], ['13%', '38%', '-3s'], ['74%', '9%', '-5s']]).map(([left, top, delay], index) =>
      <svg key={index} className="home-event-star" style={{ left, top, animationDelay: delay }} viewBox="0 0 24 24"><path d="M12 0 15 9 24 12 15 15 12 24 9 15 0 12 9 9Z" /></svg>)}
    {placement === 'stage' && image('mangmee-broom', 'home-event-broom-mobile', 1536, 1024)}
    {placement === 'faq' && image('mangmee-peeking', 'home-event-peeking', 1312, 1199)}
    {placement === 'footer' && <>
      {image('friendly-pumpkin', 'home-event-pumpkin', 1236, 1273)}
      {image('friendly-ghost', 'home-event-footer-ghost', 1236, 1273)}
    </>}
  </div>;
}
