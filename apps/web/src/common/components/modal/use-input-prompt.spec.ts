import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('input prompt renders a required danger prompt with a disabled confirm button', async () => {
  const { renderInputPromptContent } = await import('./use-input-prompt');
  const content = renderInputPromptContent(
    { label: 'เหตุผลปฏิเสธ' },
    '',
    () => undefined,
    () => undefined,
  );
  const html = renderToStaticMarkup(React.createElement('div', null, content.body, content.footer));

  assert.match(html, />เหตุผลปฏิเสธ</);
  assert.match(html, /aria-label="เหตุผลปฏิเสธ"/);
  assert.match(html, /class="[^"]*mangmee-input/);
  assert.match(html, /<button[^>]*disabled=""[^>]*class="[^"]*bg-red-600/);
});
