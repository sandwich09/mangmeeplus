import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The Modal renders through a portal, so these are read from the source (the browser check is in the round's notes).
const modal = readFileSync(new URL('./Modal.tsx', import.meta.url), 'utf8');
const confirm = readFileSync(new URL('./use-confirm.tsx', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../document-preview/DocumentPreviewModal.tsx', import.meta.url), 'utf8');

test('a dirty dialog does not lose typed text: the backdrop is dead, ✕ and Escape ask first', () => {
  assert.match(modal, /dirty = false,/, 'off unless the caller says so');
  assert.match(modal, /onMouseDown=\{closeOnBackdrop && !dirty \? onClose :/);
  assert.match(modal, /const requestClose = !dirty \? onClose : \(\) => setAsking\(\(already\) => !already\);/);
  assert.match(modal, /if \(event\.key === 'Escape'\) \{\s*requestClose\(\);/);
  assert.match(modal, /onClick=\{requestClose\}\s*aria-label=\{closeLabel\}/);
  // The question, its two outcomes in the shared order (safe first, focused), laid out by the group rule.
  assert.match(modal, /<p role="alert"[^>]*>ยังไม่ได้บันทึกสิ่งที่พิมพ์ไว้<\/p>\s*<ActionGroup>\s*<button ref=\{keepTypingRef\}[^>]*className=\{secondaryButtonClass\} onClick=\{\(\) => setAsking\(false\)\}>พิมพ์ต่อ<\/button>\s*<button[^>]*className=\{dangerButtonClass\} onClick=\{\(\) => \{ setAsking\(false\); onClose\(\); \}\}>ปิดโดยไม่บันทึก<\/button>/);
  assert.match(modal, /if \(asking\) keepTypingRef\.current\?\.focus\(\);/);
  assert.match(modal, /\{footer && !askingNow && \(/, 'one set of buttons at a time');
});

test('the confirm dialog never shows two ยกเลิก by default: its fallback safe button reads ปิด', () => {
  assert.match(confirm, /const FALLBACK_SAFE_LABEL = 'ปิด';/);
  assert.equal(confirm.match(/pending\?\.cancelLabel \?\? FALLBACK_SAFE_LABEL/g)?.length, 2, 'the button and the header ✕');
  assert.match(confirm, /title=\{pending\?\.title \?\? 'ยืนยัน'\}/);
  assert.match(confirm, /\{pending\?\.confirmLabel \?\? 'ยืนยัน'\}/);
  assert.doesNotMatch(confirm.replace(/\/\*\*[\s\S]*?\*\//g, ''), /'ยกเลิก'/);
});

test('the document preview lets its host own the main button', () => {
  assert.match(preview, /mainAction = 'print',/, 'default unchanged: print is the filled button, last');
  assert.match(preview, /className=\{hostIsMain \? secondaryButtonClass : primaryButtonClass\}>พิมพ์<\/button>/);
  assert.match(preview, /hostIsMain \? <>\{openNewTab\}\{print\}\{footer\}<\/> : <>\{footer\}\{openNewTab\}\{print\}<\/>/);
});
