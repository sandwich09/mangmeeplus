import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { withLineExternalBrowser } from '@/common/auth/line-in-app-browser.logic';
import { lineStartUrl } from './auth.logic';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// Effects never run under renderToStaticMarkup, so the body behind a tap-time 401 is rendered
// directly and the wiring that selects it is read off the source — the same split the other page
// specs use for post-mount behaviour.
const source = readFileSync(new URL('./LineQrApprovePage.tsx', import.meta.url), 'utf8');

async function renderPage(code = 'abc'): Promise<string> {
  const { default: LineQrApprovePage } = await import('./LineQrApprovePage');
  return renderToStaticMarkup(React.createElement(LineQrApprovePage, { code }));
}

async function renderNeedLogin(lineLoginAvailable: boolean, code = 'abc'): Promise<string> {
  const { LineQrNeedLogin } = await import('./LineQrApprovePage');
  return renderToStaticMarkup(React.createElement(LineQrNeedLogin, { code, lineLoginAvailable }));
}

describe('LineQrApprovePage confirm step', () => {
  it('opens straight on the confirm step the route already proved there is a session for', async () => {
    const html = await renderPage();
    assert.match(html, /ยืนยันการเข้าสู่ระบบ/);
    assert.match(html, /ไม่ใช่ฉัน/);
    // Phone-first: the card still fills the viewport height on a 390px screen.
    assert.match(html, /min-h-dvh/);
  });

  it('never re-checks the session the server route already gated on', () => {
    // apps/web/app/line-qr/[code]/page.tsx redirects every non-signed-in status to /login, so a
    // probe here would only rotate the refresh token and could read a live session as signed out.
    assert.doesNotMatch(source, /refreshSessionWithOutcome/);
    // Channel availability is the one thing the browser does not know; it must not gate the UI.
    assert.match(source, /fetch\('\/api\/auth\/line-login\/availability'\)/);
  });

  it('treats a 401 at tap time as signed out, and keeps every other status distinct', () => {
    assert.match(source, /response\.status === 401\) setState\('need_login'\)/);
    assert.match(source, /response\.status === 403\) setState\('forbidden'\)/);
    assert.match(source, /else setState\('failed'\)/);
    assert.doesNotMatch(source, /session_expired/);
  });
});

describe('LineQrApprovePage need-login body', () => {
  it('leads with LINE login and keeps the password route as the secondary link', async () => {
    const html = await renderNeedLogin(true);
    assert.match(html, /เข้าสู่ระบบด้วย LINE<\/button>/);
    assert.match(html, /bg-\[#06C755\]/);
    assert.match(html, /เข้าสู่ระบบด้วยรหัสผ่าน<\/a>/);
    assert.match(html, /href="\/login\?line=qr-approve&amp;next=%2Fline-qr%2Fabc"/);
    // Owner copy rule: no "+" anywhere the user reads.
    assert.doesNotMatch(html, /\+/);
  });

  it('offers no LINE button when the server says the channel is unavailable', async () => {
    const html = await renderNeedLogin(false);
    assert.doesNotMatch(html, /เข้าสู่ระบบด้วย LINE/);
    assert.match(html, /เข้าสู่ระบบด้วยรหัสผ่าน/);
    assert.match(html, /href="\/login\?line=qr-approve&amp;next=%2Fline-qr%2Fabc"/);
  });

  it('sends the LINE round trip back to this code, escaping LINE’s in-app browser', () => {
    assert.match(source, /assign\(withLineExternalBrowser\(lineStartUrl\(`\/line-qr\/\$\{encodeURIComponent\(code\)\}`\), navigator\.userAgent\)\)/);
    const target = (userAgent: string) =>
      withLineExternalBrowser(lineStartUrl(`/line-qr/${encodeURIComponent('abc')}`), userAgent);
    assert.equal(
      target('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Line/14.1.0'),
      '/api/auth/line-login/start?returnTo=%2Fline-qr%2Fabc&openExternalBrowser=1',
    );
    assert.equal(target('Mozilla/5.0 (iPhone) Safari/605.1'), '/api/auth/line-login/start?returnTo=%2Fline-qr%2Fabc');
  });
});
