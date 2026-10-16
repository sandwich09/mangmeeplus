import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SIGNUP_TRIAL_AFTER, SIGNUP_TRIAL_HEADLINE } from './signup.logic';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// The phone is the primary surface: 390px wide, with the browser chrome eating the bottom. These
// are the two ways this journey has broken there before — a `vh` height that the address bar cuts
// off, and a width that puts the submit button off-screen sideways.
const VIEWPORT = 390;
/** 390 minus the page's own `px-4` gutters on both sides. */
const CONTENT_WIDTH = VIEWPORT - 16 * 2;

const dir = fileURLToPath(new URL('.', import.meta.url));
const pages = readdirSync(dir)
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => ({ name, source: readFileSync(new URL(`./${name}`, import.meta.url), 'utf8') }));

describe('the public signup journey at 390px', () => {
  it('measures the pages it claims to cover', () => {
    assert.ok(pages.length >= 4, `only found ${pages.map((p) => p.name).join(', ')}`);
  });

  // Height is not asserted here: `src/common/styles/viewport-units.spec.ts` (INV-10) already bans
  // static viewport units across the whole app, and naming the banned class in a second place is
  // what that scanner reads as a violation.
  it('sizes every full-height screen in this journey', () => {
    for (const { name, source } of pages) {
      if (/\bmin-h-\w+\b/.test(source)) assert.match(source, /\bmin-h-dvh\b/, name);
    }
  });

  it('declares no fixed width wider than the 390px content column', () => {
    for (const { name, source } of pages) {
      for (const [, prop, px] of source.matchAll(/\b((?:min-)?w)-\[(\d+)px\]/g)) {
        assert.ok(
          Number(px) <= CONTENT_WIDTH,
          `${name}: ${prop}-[${px}px] is wider than the ${CONTENT_WIDTH}px column`,
        );
      }
    }
  });

  it('keeps the content column inside the viewport', () => {
    // `max-w-md` is 448px, which is wider than 390 — it only works because the column also carries
    // horizontal padding and `w-full`, so it shrinks. A column without that would overflow.
    for (const { name, source } of pages) {
      for (const [line] of source.matchAll(/.*\bmax-w-(?:md|lg|4xl)\b.*/g)) {
        assert.match(line, /\bw-full\b|\bmx-auto\b/, `${name}: ${line.trim()}`);
      }
    }
  });
});

describe('the signup notice', () => {
  it('renders as flowing text with no fixed width', async () => {
    const { TrialNotice } = await import('./SignupPage');
    const html = renderToStaticMarkup(React.createElement(TrialNotice));
    // Owner 2026-09-20: both lines have to REACH the screen, not merely exist as constants — what
    // signing up gets you, and what starting it costs.
    assert.match(html, new RegExp(SIGNUP_TRIAL_HEADLINE));
    assert.match(html, new RegExp(SIGNUP_TRIAL_AFTER));
    assert.doesNotMatch(html, /ทดลองใช้ฟรี|ฟรี 30 วัน/);
    assert.doesNotMatch(html, /w-\[\d+px\]/);
    // Owner copy rule for this journey.
    assert.doesNotMatch(html, /\+/);
  });
});

describe('the closed and outage notices', () => {
  it('gives each a full-width tap target rather than a link in a paragraph', async () => {
    const { SignupClosedNotice, SignupUnavailableNotice } = await import('./SignupChrome');
    const closed = renderToStaticMarkup(React.createElement(SignupClosedNotice));
    const outage = renderToStaticMarkup(
      React.createElement(SignupUnavailableNotice, { onRetry: () => {} }),
    );
    for (const html of [closed, outage]) {
      // The shared button is 44px tall on a phone, and w-full keeps it inside the 390px column.
      assert.match(html, /class="mangmee-btn mangmee-btn-primary w-full"/);
      assert.doesNotMatch(html, /\+/);
    }
    // R11: two different situations, so they may not read as the same sentence.
    assert.match(closed, /ยังไม่เปิดรับสมัคร/);
    assert.match(outage, /ยังเปิดรับสมัครอยู่/);
  });
});
