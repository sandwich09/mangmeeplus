'use client';

import { useEffect, useState, type CSSProperties } from 'react';

type TocItem = { id: string; label: string };

/** One rAF-coalesced scroll subscription per consumer. Legal pages are long and the
 *  rail updates on every frame of a fast scroll, so the handler must stay passive. */
function useScrollEffect(onScroll: () => void) {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        onScroll();
      });
    };
    onScroll();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
    // The callers below pass stable closures over state setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Distance below the viewport top at which a section counts as "the one being read".
 *  Sits just under the sticky masthead. */
const ACTIVE_LINE = 128;

export function LegalToc({ items }: { items: ReadonlyArray<TocItem> }) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? '');

  useScrollEffect(() => {
    // Last heading to have passed the line wins. An IntersectionObserver would leave
    // the rail blank whenever a section is taller than the viewport — and on these
    // pages most of them are.
    let current = items[0]?.id ?? '';
    for (const item of items) {
      const element = document.getElementById(item.id);
      if (element && element.getBoundingClientRect().top <= ACTIVE_LINE) current = item.id;
    }
    // The closing section is often too short to ever reach the line, so it would never
    // light up without this: at the bottom of the page, it is what you are reading.
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) current = items[items.length - 1]?.id ?? current;
    setActiveId(current);
  });

  return (
    <nav aria-label="สารบัญ" className="doc-toc">
      {items.map((item, index) => {
        const isActive = item.id === activeId;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="doc-toc-item"
            data-active={isActive}
            aria-current={isActive ? 'location' : undefined}
          >
            <span className="doc-toc-num doc-display" aria-hidden>{index + 1}</span>
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

/**
 * A way back for someone who came from the sign-up form or the acceptance page: the logo leads to /login and loses
 * their place. Drawn only when this tab has a page behind it; a document opened in its own tab shows nothing.
 */
export function LegalBackLink() {
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => { setCanGoBack(window.history.length > 1); }, []);
  if (!canGoBack) return null;
  return (
    <button type="button" className="doc-back" onClick={() => window.history.back()}>
      <span aria-hidden>‹</span>กลับ
    </button>
  );
}

/** How much of the document is behind you. These are long enough that knowing costs
 *  nothing and helps; it renders as a hairline on the masthead's bottom edge. */
export function LegalReadingProgress() {
  const [progress, setProgress] = useState(0);

  useScrollEffect(() => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    setProgress(scrollable > 0 ? Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100)) : 0);
  });

  return (
    <div
      className="doc-progress"
      style={{ '--doc-progress': `${progress}%` } as CSSProperties}
      aria-hidden
    />
  );
}
