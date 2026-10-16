import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('name prop renders an sr-only native file input carrying name and required', async () => {
  const { ThemedFile } = await import('./ThemedFile');
  const html = renderToStaticMarkup(React.createElement(ThemedFile, {
    name: 'attachment',
    required: true,
    'aria-describedby': 'receipt-hint',
  }));

  assert.match(html, /<input[^>]*type="file"/);
  assert.match(html, /<input[^>]*name="attachment"/);
  assert.match(html, /<input[^>]*required/);
  assert.match(html, /<input[^>]*class="sr-only"/);
  assert.match(html, /<input[^>]*aria-describedby="receipt-hint"/);
  // Empty state: Thai placeholder + pick chip, no clear button.
  assert.match(html, /ยังไม่ได้เลือกไฟล์/);
  assert.match(html, /เลือกไฟล์/);
  assert.doesNotMatch(html, /นำไฟล์ออก/);
});

test('controlled file shows its name with clear button and change chip', async () => {
  const { ThemedFile } = await import('./ThemedFile');
  const html = renderToStaticMarkup(React.createElement(ThemedFile, {
    file: 'receipt-2569.jpg',
    'aria-required': true,
  }));

  assert.match(html, /receipt-2569\.jpg/);
  assert.match(html, /<input[^>]*aria-required="true"/);
  assert.doesNotMatch(html, /<input[^>]*required=""/);
  assert.match(html, /aria-label="นำไฟล์ออก"/);
  assert.match(html, /เปลี่ยนไฟล์/);
  assert.doesNotMatch(html, /ยังไม่ได้เลือกไฟล์/);
});

test('disabled state hides the clear button and dims the chip', async () => {
  const { ThemedFile } = await import('./ThemedFile');
  const html = renderToStaticMarkup(React.createElement(ThemedFile, {
    file: 'receipt.pdf',
    disabled: true,
  }));

  assert.match(html, /<input[^>]*disabled/);
  assert.doesNotMatch(html, /นำไฟล์ออก/);
  assert.match(html, /cursor-not-allowed/);
});

test('slip copy overrides show visible change and remove while sharing the phone picker', async () => {
  const { ThemedFile } = await import('./ThemedFile');
  const html = renderToStaticMarkup(React.createElement(ThemedFile, {
    file: 'สลิป.jpg', accept: 'image/jpeg,application/pdf',
    labels: { pick: 'แนบสลิป', change: 'เปลี่ยน', clear: 'เอาออก', loading: 'กำลังอัปโหลดสลิป…' },
  }));
  assert.match(html, /สลิป.jpg/); assert.match(html, />เปลี่ยน<\/span>/); assert.match(html, />เอาออก<\/button>/);
  assert.doesNotMatch(html, /capture=/); assert.match(html, /type="file"/);
});

test('a hint sits under the picker as a line that may wrap, never inside it where a phone cut it', async () => {
  const { ThemedFile } = await import('./ThemedFile');
  const plain = renderToStaticMarkup(React.createElement(ThemedFile, { accept: '.pdf' }));
  assert.match(plain, /^<label /, 'no hint: the picker alone, as before');
  for (const props of [{ hint: 'รองรับไฟล์รูปภาพและ PDF' }, { placeholder: 'รองรับไฟล์รูปภาพและ PDF' }]) {
    const html = renderToStaticMarkup(React.createElement(ThemedFile, { ...props, 'aria-describedby': 'own-note' }));
    // The picker keeps its short empty text; the hint is its own paragraph after the label and is not truncated.
    assert.match(html, /^<div class="min-w-0"><label [\s\S]*ยังไม่ได้เลือกไฟล์[\s\S]*<\/label><p id="([^"]+)" class="mt-1 text-xs text-gray-500">รองรับไฟล์รูปภาพและ PDF<\/p><\/div>$/);
    assert.doesNotMatch(html.match(/<label[\s\S]*<\/label>/)![0], /รองรับไฟล์/);
    // The input is described by the caller's own note and by the hint.
    const hintId = html.match(/<p id="([^"]+)"/)![1];
    assert.ok(html.includes(`aria-describedby="own-note ${hintId}"`));
  }
  // With a file chosen the hint stays where it is and the picker shows the name.
  const chosen = renderToStaticMarkup(React.createElement(ThemedFile, { hint: 'รองรับไฟล์รูปภาพและ PDF', file: 'ใบเสร็จ.jpg' }));
  assert.match(chosen, /ใบเสร็จ\.jpg[\s\S]*<\/label><p[^>]*>รองรับไฟล์รูปภาพและ PDF<\/p>/);
});
