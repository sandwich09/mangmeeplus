import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('renders a themed combobox and keeps the selected form value', async () => {
  const { ThemedSelect } = await import('./ThemedSelect');
  const html = renderToStaticMarkup(React.createElement(
    ThemedSelect,
    { name: 'kind', defaultValue: 'SERVICE', required: true, 'aria-label': 'Kind' },
    React.createElement('option', { value: 'STOCKABLE' }, 'Stockable'),
    React.createElement('option', { value: 'SERVICE' }, 'Service'),
  ));

  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /required=""/);
  assert.match(html, /name="kind" value="SERVICE"/);
  // The trigger shows the selected option's label even while the list is closed.
  assert.match(html, /Service/);
  assert.doesNotMatch(html, /<select/);
  // The option list is portaled and mounted only while open, so a closed select
  // contributes no listbox to the page — that is what keeps it out of the
  // surrounding table's overflow clip.
  assert.doesNotMatch(html, /role="listbox"/);
});

test('SelectField names its combobox with the field label for every selected value', async () => {
  const { SelectField } = await import('./Field');
  for (const value of ['ACTIVE', 'SUSPENDED']) {
    const html = renderToStaticMarkup(React.createElement(SelectField, { label: 'สถานะบัญชี', value },
      React.createElement('option', { value: 'ACTIVE' }, 'เปิดใช้งาน'),
      React.createElement('option', { value: 'SUSPENDED' }, 'ระงับ')));
    const trigger = html.match(/<summary[^>]*>/)?.[0] ?? '';
    assert.match(trigger, /aria-label="สถานะบัญชี"/);
    assert.doesNotMatch(trigger, /aria-label="(?:เปิดใช้งาน|ระงับ)"/);
  }
});
