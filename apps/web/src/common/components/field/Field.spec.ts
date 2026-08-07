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
