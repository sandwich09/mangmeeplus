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

// The open list is portaled and not in static markup, so the list is read through the function that builds it.
test('an empty choice that only prompts is not an option; a real "all" or "none" row stays', async () => {
  const source = (await import('node:fs')).readFileSync(new URL('./ThemedSelect.tsx', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function promptOption'), source.indexOf('export function ThemedSelect'));
  const ts = (await import('typescript')).default;
  const promptOption = new Function(`${ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; return promptOption;`)() as
    (options: Array<{ value: string; label: string; disabled: boolean; hidden: boolean }>, required: boolean) => { label: string } | undefined;
  const option = (value: string, label: string, extra: Partial<{ disabled: boolean; hidden: boolean }> = {}) => ({ value, label, disabled: false, hidden: false, ...extra });
  // A required select: its first, empty option is the prompt.
  assert.equal(promptOption([option('', 'เลือกเงินที่ใช้ชำระ'), option('CASH', 'เงินสด')], true)?.label, 'เลือกเงินที่ใช้ชำระ');
  // An empty option the caller disabled (or hid) is a prompt whether or not the select is required.
  assert.equal(promptOption([option('', 'กรุณาเลือกสาขาของรายการ', { disabled: true }), option('b1', 'สำนักงานใหญ่')], false)?.label, 'กรุณาเลือกสาขาของรายการ');
  assert.equal(promptOption([option('', 'เลือก', { hidden: true }), option('a', 'ก')], false)?.label, 'เลือก');
  // A filter's "all" and a field's "none" are real choices: not required, not disabled.
  assert.equal(promptOption([option('', 'ทุกประเภทเอกสาร'), option('RECEIPT', 'ใบเสร็จรับเงิน')], false), undefined);
  assert.equal(promptOption([option('', 'ไม่ระบุ'), option('a', 'ก')], false), undefined);
  // In a required select only the FIRST empty option prompts.
  assert.equal(promptOption([option('a', 'ก'), option('', 'อื่น ๆ')], true), undefined);
  // The list is built from the choices without the prompt, and the search filters the same list.
  assert.match(source, /const choices = prompt \? options\.filter\(\(option\) => option !== prompt\) : options;/);
  assert.match(source, /const visibleOptions = searchable \? choices\.filter\([\s\S]*?\) : choices;/);
});

test('the closed control shows the prompt in a quieter colour, a chosen value in full, and wraps a long value when asked', async () => {
  const { ThemedSelect } = await import('./ThemedSelect');
  const h = React.createElement;
  const options = [h('option', { key: 0, value: '' }, 'เลือกเงินที่ใช้ชำระ'), h('option', { key: 1, value: 'CASH' }, 'เงินสด')];
  const empty = renderToStaticMarkup(h(ThemedSelect, { required: true, value: '', name: 'method' }, options));
  assert.match(empty, /<span data-prompt="true" class="min-w-0 truncate text-gray-500">เลือกเงินที่ใช้ชำระ<\/span>/);
  assert.match(empty, /name="method" value=""/, 'the form value stays empty, so required still refuses it');
  const chosen = renderToStaticMarkup(h(ThemedSelect, { required: true, value: 'CASH' }, options));
  assert.match(chosen, /<span class="min-w-0 truncate text-gray-800">เงินสด<\/span>/);
  // A real "all" row is shown as a value, as before.
  const all = renderToStaticMarkup(h(ThemedSelect, { value: '' }, h('option', { value: '' }, 'ทุกเดือน'), h('option', { value: '10' }, 'ต.ค.')));
  assert.match(all, /<span class="min-w-0 truncate text-gray-800">ทุกเดือน<\/span>/);
  // `placeholder`: no empty option at all, nothing chosen yet.
  const named = renderToStaticMarkup(h(ThemedSelect, { value: '', placeholder: 'เลือกธนาคาร' }, h('option', { value: 'KBANK' }, 'กสิกรไทย')));
  assert.match(named, /<span data-prompt="true" class="min-w-0 truncate text-gray-500">เลือกธนาคาร<\/span>/);
  // Without `placeholder` an unmatched value still falls back to the first option, as it always has.
  assert.match(renderToStaticMarkup(h(ThemedSelect, { value: 'x' }, h('option', { value: 'KBANK' }, 'กสิกรไทย'))), />กสิกรไทย<\/span>/);
  // wrapLabel: the value may take a second line and the control is allowed to grow past a caller's fixed height.
  const wrapped = renderToStaticMarkup(h(ThemedSelect, { wrapLabel: true, value: 'a', className: 'h-11' }, h('option', { value: 'a' }, 'ผู้รับเงินไม่สามารถออกใบเสร็จรับเงิน')));
  assert.match(wrapped, /<summary[^>]*class="[^"]*h-11 !h-auto"/);
  assert.match(wrapped, /<span class="min-w-0 whitespace-normal break-words text-gray-800">/);
});
