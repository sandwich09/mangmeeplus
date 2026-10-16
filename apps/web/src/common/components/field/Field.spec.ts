import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('password fields render a reveal toggle and stay masked until it is pressed', async () => {
  const { TextField } = await import('./Field');
  const html = renderToStaticMarkup(React.createElement(TextField, {
    label: 'รหัสผ่านปัจจุบัน',
    name: 'current-password',
    type: 'password',
  }));

  assert.match(html, /type="password"/);
  assert.match(html, /<button type="button" aria-label="แสดงรหัสผ่าน"/);
  // Room for the button so the eye never sits on top of the typed characters.
  assert.match(html, /class="[^"]*pr-10/);
});

test('non-password fields render no toggle', async () => {
  const { TextField } = await import('./Field');
  const html = renderToStaticMarkup(React.createElement(TextField, {
    label: 'Email',
    name: 'email',
    type: 'email',
  }));

  assert.doesNotMatch(html, /<button/);
});

test('one line under a field: the hint, or the error in its place, and the input points at the line that is shown', async () => {
  const { TextField, SelectField, TextareaField, SwitchField } = await import('./Field');
  const props = { label: 'เลขผู้เสียภาษี', name: 'tax-id', hint: 'ตัวเลข 13 หลัก' };
  const calm = renderToStaticMarkup(React.createElement(TextField, props));
  assert.match(calm, /aria-describedby="tax-id-hint"/);
  assert.match(calm, /<span id="tax-id-hint" class="text-xs font-normal text-gray-500">ตัวเลข 13 หลัก<\/span>/);
  assert.doesNotMatch(calm, /role="alert"/);

  const wrong = renderToStaticMarkup(React.createElement(TextField, { ...props, error: 'เลขผู้เสียภาษีต้องมี 13 หลัก' }));
  assert.match(wrong, /aria-invalid="true"/);
  assert.match(wrong, /aria-describedby="tax-id-error"/);
  // The error is 14 px text, and the grey hint is gone: the rule is not printed twice.
  assert.match(wrong, /<span id="tax-id-error" role="alert" class="text-sm font-normal text-red-600">เลขผู้เสียภาษีต้องมี 13 หลัก<\/span>/);
  assert.doesNotMatch(wrong, /tax-id-hint|ตัวเลข 13 หลัก/);

  // An error with no hint, and the sibling fields, follow the same rule.
  assert.match(renderToStaticMarkup(React.createElement(TextField, { label: 'ชื่อ', name: 'n', error: 'กรอกชื่อ' })), /aria-describedby="n-error"/);
  for (const [Field, extra] of [[TextareaField, {}], [SwitchField, {}], [SelectField, { children: React.createElement('option', { value: 'a' }, 'ก') }]] as const) {
    const calmSibling = renderToStaticMarkup(React.createElement(Field as never, { label: 'ช่อง', name: 'f', hint: 'คำแนะนำ', ...extra }));
    assert.match(calmSibling, /id="f-hint"/); assert.match(calmSibling, /aria-describedby="f-hint"/);
    const wrongSibling = renderToStaticMarkup(React.createElement(Field as never, { label: 'ช่อง', name: 'f', hint: 'คำแนะนำ', error: 'ผิด', ...extra }));
    assert.match(wrongSibling, /<span id="f-error" role="alert" class="text-sm font-normal text-red-600">ผิด<\/span>/);
    assert.match(wrongSibling, /aria-describedby="f-error"/);
    assert.doesNotMatch(wrongSibling, /f-hint|คำแนะนำ/);
  }
});


test('text fields keep an end action inside the input wrapper with space for its touch target', async () => {
  const { TextField } = await import('./Field');
  const html = renderToStaticMarkup(React.createElement(TextField, { label: 'เลขบัญชี', value: 'xxx-1234', readOnly: true,
    endAdornment: React.createElement('button', { type: 'button', 'aria-label': 'ดูเลขเต็ม', className: 'h-11 w-11' }) }));
  assert.match(html, /<span class="relative block"><input[^>]*pr-11[^>]*\/><button/);
  assert.match(html, /aria-label="ดูเลขเต็ม" class="h-11 w-11"/);
  assert.doesNotMatch(html, /endAdornment=/);
});
