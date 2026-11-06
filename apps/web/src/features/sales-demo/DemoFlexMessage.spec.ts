import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { certificateHarness, h } from '@/features/expenses/expense-certificate-test-harness';
import { DemoFlexMessage } from './DemoFlexMessage';
import type { DemoAction, DemoMessage } from './demo-line-chat.logic';

const evidence = JSON.parse(readFileSync('../../docs/evidence/line-system-oa-design-lock-2026-10-04/source-answer-examples.json', 'utf8'));
const card = (Object.values(evidence) as { card?: Extract<DemoMessage, { type: 'flex' }> }[]).find(entry => entry.card)?.card as Extract<DemoMessage, { type: 'flex' }>;

test('locked-design JSON renders its actual text and buttons, and dispatches the original postback', () => {
  assert.ok(card);
  const actions: DemoAction[] = [];
  const view = certificateHarness(() => h(DemoFlexMessage, { message: card, onAction: action => actions.push(action) }));
  const html = view.render();
  for (const text of ['ยืนยันการแก้ไขรายการ', 'ค่าบริการ', '1,789.04', 'ยืนยัน', 'ยกเลิก']) assert.ok(html.includes(text), text);
  view.find('button', props => props.children.includes('ยืนยัน')).onClick({ stopPropagation() {} });
  assert.equal(actions[0].type, 'postback');
  assert.match((actions[0] as Extract<DemoAction, { type: 'postback' }>).data, /action=draft-update-confirm/);
});

test('unknown nested node falls back to canonical text, then alt text, with escaped content', () => {
  const message = { ...card, canonicalText: '<script>canonical</script>', contents: { type: 'bubble', body: { type: 'box', contents: [{ type: 'video' }] } } };
  const view = certificateHarness(() => h(DemoFlexMessage, { message, onAction() {} }));
  assert.match(view.render(), /&lt;script&gt;canonical&lt;\/script&gt;/);
  assert.doesNotMatch(view.render(), /<script>/);
  const alt = certificateHarness(() => h(DemoFlexMessage, { message: { ...message, canonicalText: undefined }, onAction() {} }));
  assert.ok(alt.render().includes(card.altText.replaceAll('&', '&amp;')));
});

test('box layout preserves flex, spacing, margins, baseline, absolute offsets and carousel containers', () => {
  const message = { ...card, contents: { type: 'carousel', contents: [{ type: 'bubble', body: {
    type: 'box', layout: 'horizontal', spacing: '8px', paddingAll: '0px', contents: [
      { type: 'text', text: 'left', flex: 3 },
      { type: 'box', width: '50px', layout: 'baseline', margin: '12px', contents: [
        { type: 'text', text: 'right', position: 'absolute', offsetEnd: '4px', offsetTop: '2px' },
      ] }, { type: 'spacer', size: 'sm' }, { type: 'separator' },
    ],
  } }] } };
  const view = certificateHarness(() => h(DemoFlexMessage, { message, onAction() {} }));
  const html = view.render();
  for (const rule of ['demo-flex-carousel', 'flex:3 0 0', 'margin-left:12px', 'align-items:baseline', 'position:absolute', 'right:4px', 'top:2px', 'width:4px']) assert.ok(html.includes(rule), rule);
});

test('busy disables mutation buttons while URI buttons remain usable', () => {
  const view = certificateHarness(() => h(DemoFlexMessage, { message: card, onAction() {}, disabled: true }));
  view.render();
  assert.equal(view.find('button', props => props.children.includes('ยืนยัน')).disabled, true);
});

test('block padding survives as longhands, bubble width follows its LINE size, and block separators draw', () => {
  const message = { ...card, contents: { type: 'bubble', size: 'kilo',
    header: { type: 'box', layout: 'vertical', paddingAll: '16px', paddingTop: '10px', backgroundColor: '#15803D', contents: [{ type: 'text', text: 'หัวการ์ด' }] },
    body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'เนื้อหา' }] },
    footer: { type: 'box', layout: 'vertical', contents: [{ type: 'image', url: '/assets/line/system-card-mascot-general-20261005.png' }] },
    styles: { footer: { separator: true, separatorColor: '#E3EBE5' } } } };
  const html = certificateHarness(() => h(DemoFlexMessage, { message, onAction() {} })).render();
  for (const rule of ['width:min(260px, 100%)', 'padding-top:10px;padding-bottom:16px;padding-left:16px;padding-right:16px', 'padding-top:20px', 'height:1px;background:#E3EBE5', 'src="https://mangmeeplus.com/assets/line/system-card-mascot-general-20261005.png"']) assert.ok(html.includes(rule), rule);
  assert.doesNotMatch(html, /padding:/);
});
