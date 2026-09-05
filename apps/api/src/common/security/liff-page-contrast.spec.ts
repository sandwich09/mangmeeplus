import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { liffPageHtml } from './liff-page.security';

/**
 * Review SHOULD-FIX 2. The theme shipped white text on `--brand` #22C55E, which is 2.28:1 — a shop
 * owner reading a phone in daylight cannot see it, and it fails WCAG AA's 4.5:1 outright. Asserting
 * the hex pair would only pin today's mistake, so the ratio is COMPUTED here: any future palette
 * edit that drops a foreground/background pair below the bar fails this file.
 */

/** WCAG 2.1 relative luminance, from sRGB hex. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const AA = 4.5;

describe('WCAG contrast of the LIFF palette', () => {
  it('computes the published ratios correctly', () => {
    // Anchors: the ratio of a colour with itself is 1, black on white is 21, and the value that
    // started all this is 2.28 — so the helper is measuring what it claims to measure.
    assert.equal(Math.round(contrast('#ffffff', '#ffffff')), 1);
    assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
    assert.equal(contrast('#ffffff', '#22C55E').toFixed(2), '2.28');
  });

  it('refuses white on the light brand green, which is why nothing uses that pair', () => {
    assert.ok(contrast('#ffffff', '#22C55E') < AA, 'if this ever passes, the palette moved');
    const html = liffPageHtml({ title: 't', data: {}, content: '' });
    // #22C55E may still appear — but only as the success notice's left rule, where no text sits on
    // it. Neither the buttons nor the header bar may name it as a background.
    assert.equal(html.includes('background:var(--brand)'), false, 'no white-on-#22C55E surface');
    assert.ok(html.includes('header.brand{display:flex;align-items:center;gap:8px;padding:10px 16px;background:var(--brand-dark)'));
    assert.ok(html.includes('button,a.btn{border:0;border-radius:12px;background:var(--brand-dark);color:#fff'));
  });

  it('keeps every text-on-ground pair the pages actually paint at or above AA', () => {
    const pairs: Array<[string, string, string]> = [
      ['button and header bar', '#ffffff', '#15803D'],
      ['body ink on the page ground', '#101828', '#F5F8F6'],
      ['body ink on the card', '#101828', '#ffffff'],
      ['muted technical text in #detail', '#475467', '#F5F8F6'],
      ['secondary links on the card', '#15803D', '#ffffff'],
      ['info notice', '#1E3A8A', '#EFF6FF'],
      ['success notice', '#14532D', '#ECFDF5'],
      ['warning notice', '#713F12', '#FEF9C3'],
      ['error notice', '#7F1D1D', '#FEF2F2'],
      ['field-level error', '#B91C1C', '#ffffff'],
    ];
    for (const [name, foreground, background] of pairs) {
      const ratio = contrast(foreground, background);
      assert.ok(ratio >= AA, `${name}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, below ${AA}`);
    }
  });

  it('serves every one of those colours, so the table above is not describing a page that moved on', () => {
    const html = liffPageHtml({ title: 't', data: {}, content: '' });
    for (const colour of ['#15803D', '#101828', '#F5F8F6', '#475467', '#1E3A8A', '#EFF6FF', '#14532D', '#ECFDF5', '#713F12', '#FEF9C3', '#7F1D1D', '#FEF2F2', '#B91C1C']) {
      assert.ok(html.includes(colour), `${colour} is asserted above but no longer served`);
    }
  });
});
