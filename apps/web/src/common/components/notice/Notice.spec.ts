import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const h = React.createElement;

test('a notice says its tone in a role and a mark, not by colour alone', async () => {
  const { Notice } = await import('./Notice');
  const html = (tone: string) => renderToStaticMarkup(h(Notice, { tone } as never, 'ข้อความ'));
  assert.match(html('error'), /^<div role="alert" data-tone="error" class="rounded-xl border border-\[#FECDCA\] bg-error-50 px-4 py-3 text-sm font-medium text-error-700">⚠ ข้อความ<\/div>$/);
  assert.match(html('warning'), /^<div role="status" data-tone="warning" class="[^"]*bg-warning-50[^"]*text-warning-700">⚠ ข้อความ<\/div>$/);
  assert.match(html('success'), /^<div role="status" data-tone="success" class="[^"]*bg-success-50[^"]*">✓ ข้อความ<\/div>$/);
  // A note is not a success: no tick, and not the green of "done".
  assert.match(html('info'), /^<div role="status" data-tone="info" class="[^"]*--color-info-surface[^"]*">ข้อความ<\/div>$/);
  assert.doesNotMatch(html('info'), /✓|bg-brand|bg-success/);
});

test('a refusal carries its way out: one action beside the sentence', async () => {
  const { Notice } = await import('./Notice');
  const html = renderToStaticMarkup(h(Notice, { tone: 'error', action: h('a', { href: '/settings/profile' }, 'กรอกข้อมูลร้าน') }, 'ยังไม่มีเลขผู้เสียภาษีของร้าน'));
  assert.match(html, /role="alert"[^>]*flex flex-wrap items-center/);
  assert.match(html, /<div class="min-w-0 flex-1 basis-64">⚠ ยังไม่มีเลขผู้เสียภาษีของร้าน<\/div><div class="shrink-0"><a href="\/settings\/profile">กรอกข้อมูลร้าน<\/a><\/div><\/div>$/);
});

test('the expense banners keep their props and render through the shared notice', async () => {
  const { ErrorBanner, InfoBanner, StateBanner } = await import('../../../features/expenses/ExpensesUi');
  const error = renderToStaticMarkup(h(ErrorBanner, { message: 'บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ ลองอีกครั้ง' }));
  assert.match(error, /^<div tabindex="-1" role="alert" data-tone="error" class="[^"]*bg-error-50[^"]*text-error-700 whitespace-pre-line">⚠ บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ ลองอีกครั้ง<\/div>$/);
  assert.match(renderToStaticMarkup(h(InfoBanner, { message: 'อ่านข้อมูลไม่ครบ' })), /^<div role="status" data-tone="info"[^>]*>อ่านข้อมูลไม่ครบ<\/div>$/);
  assert.equal(renderToStaticMarkup(h(StateBanner, { error: null })), '');
  assert.match(renderToStaticMarkup(h(StateBanner, { error: 'Forbidden' })), /role="status" data-tone="info"[^>]*>🔒 คุณไม่มีสิทธิ์เข้าถึงส่วนนี้</);
  assert.match(renderToStaticMarkup(h(StateBanner, { error: 'เชื่อมต่อระบบไม่ได้' })), /role="alert"[^>]*>⚠ เชื่อมต่อระบบไม่ได้</);
});
