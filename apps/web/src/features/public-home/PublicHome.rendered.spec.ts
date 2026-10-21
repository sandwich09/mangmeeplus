import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { billingOffer, PLAN_TIER_PRESETS } from '@watchdog-bms/contracts';
import { PublicHome, HomeStructuredData } from './PublicHome';
import { HomePricing, recommendedPlan } from './HomeInteractions';
import { HOME_CONTACT_URL, HOME_DOCUMENTS, HOME_FAQ, HOME_JSON_LD, HOME_LINE_URL, HOME_PLANS } from './home-content';

const html = () => renderToStaticMarkup(React.createElement(PublicHome));
const text = (value: string) => value.replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#x27;', "'");

test('HOME-PAGE server renders the owner H1, section outline, LINE handoffs and unchanged login route', () => {
  const markup = html();
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
  assert.match(markup, /<h1[^>]*>ขายได้ทุกวัน <span>แต่จ่ายไปเท่าไร/);
  for (const section of ['how', 'pricing', 'use', 'line', 'trust', 'faq']) assert.ok(markup.includes(`id="${section}"`), section);
  for (const href of [HOME_LINE_URL, HOME_CONTACT_URL, '/login', '/privacy', '/terms']) assert.ok(markup.includes(`href="${href}"`), href);
  assert.doesNotMatch(markup, /official\.mangmeeplus\.com|\/\_blob\/|sc-for|sc-if|\{\{|ต้นแบบ v3|91–97%|80 เครดิต/);
  assert.match(markup, /ราคานี้ยังไม่มี VAT ออกใบเสร็จรับเงินให้/);
  assert.match(markup, /ทำนอกระบบ/);
  assert.match(markup, /เลือกช่วงวันเอง/);
  assert.match(markup, /ใบเสร็จครบจำนวนแล้วทำยังไง/);
  assert.match(markup, /เปลี่ยนแพ็กเกจทีหลังได้ไหม/);
});

test('HOME-PAGE JSON-LD parses, uses the request nonce, and FAQ answers equal the rendered FAQ exactly', () => {
  const script = renderToStaticMarkup(React.createElement(HomeStructuredData, { nonce: 'request-nonce' }));
  assert.match(script, /nonce="request-nonce"/);
  const data = JSON.parse(script.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]!);
  assert.deepEqual(data, HOME_JSON_LD);
  assert.deepEqual(data['@graph'].map((entry: any) => entry['@type']), ['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']);
  const visible = [...html().matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/g)].map(([, question, answer]) => ({ question: text(question!), answer: text(answer!) }));
  assert.deepEqual(visible, HOME_FAQ);
  const faqEntity = data['@graph'].find((entry: any) => entry['@type'] === 'FAQPage');
  assert.ok(faqEntity);
  assert.deepEqual(faqEntity.mainEntity,
    visible.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })));
});

test('HOME-PAGE monthly and annual prices, allowances, user and branch limits match the billing catalog in HTML and offers', () => {
  const markup = html();
  const offers = HOME_JSON_LD['@graph'].find(entry => entry['@type'] === 'SoftwareApplication')!.offers!;
  assert.equal(offers.length, 8);
  HOME_PLANS.forEach((plan, index) => {
    const preset = PLAN_TIER_PRESETS[plan.tier];
    assert.equal(plan.users, preset.employeeLimit); assert.equal(plan.branches, preset.branchLimit);
    for (const interval of ['month', 'year'] as const) {
      const offer = billingOffer(plan.tier, interval);
      const price = interval === 'month' ? plan.monthlyPrice : plan.annualPrice;
      assert.equal(price * 100, offer.priceSatang);
      assert.equal(interval === 'month' ? plan.monthlyReceipts : plan.annualReceipts, offer.receiptAllowance);
      assert.equal(offers[index * 2 + (interval === 'year' ? 1 : 0)]!.price, price);
      assert.equal(offers[index * 2 + (interval === 'year' ? 1 : 0)]!.priceCurrency, 'THB');
      assert.ok(markup.includes(price.toLocaleString('en-US')), `${plan.tier} ${interval} visible without JS`);
    }
    assert.equal(plan.systemTax, plan.tier === 'ENTERPRISE_1999');
  });
});

test('HOME-PAGE package chooser fits people, receipts, branches and system tax needs', () => {
  assert.equal(recommendedPlan([0, 0, 0, 0]), 0);
  assert.equal(recommendedPlan([1, 0, 0, 0]), 1);
  assert.equal(recommendedPlan([0, 2, 0, 0]), 2);
  assert.equal(recommendedPlan([0, 0, 3, 0]), 3);
  assert.equal(recommendedPlan([0, 0, 0, 1]), 3);
});

test('HOME-PAGE all 17 local assets exist; informative pictures have Thai alternatives and fixed dimensions', () => {
  const markup = html();
  const images = [...markup.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
  assert.equal(images.length, 17);
  for (const image of images) {
    const src = image.match(/src="([^"]+)"/)![1]!;
    assert.ok(existsSync(new URL(`../../../public${src}`, import.meta.url)), src);
    assert.match(image, /width="\d+"/); assert.match(image, /height="\d+"/); assert.match(image, /alt="[^"]*"/);
  }
  for (const [file, title] of HOME_DOCUMENTS) {
    assert.match(markup, new RegExp(`aria-label="ขยายภาพ${title.replace(/[()]/g, '\\$&')}"`));
    assert.ok(markup.includes(`/home/${file}.webp`));
  }
});

test('HOME-PAGE keeps the artboard phone columns, safe bottom CTA, reduced motion and a viewport-bound native gallery', () => {
  const css = readFileSync(new URL('./public-home.css', import.meta.url), 'utf8');
  assert.match(css, /@container \(max-width:700px\)/);
  assert.match(css, /\.public-home \.plans\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /max-height:calc\(100dvh - 32px\)/);
  assert.match(css, /\.public-home \.reel\{/);
  const component = readFileSync(new URL('./HomeInteractions.tsx', import.meta.url), 'utf8');
  assert.match(component, /animationPlayState: paused \? 'paused' : 'running'/);
  assert.match(component, /showModal\(\)/); assert.match(component, /onClose=/);
  assert.match(css, /\.public-home \.count\{/);
});

// Existing rendered-spec pattern: capture native button handlers while preserving real React SSR.
test('HOME-PAGE choosing annual billing and a team size updates the rendered offer without submitting or navigating', () => {
  const runtime = require('react') as typeof React;
  const originalState = runtime.useState, originalCreate = runtime.createElement;
  const states: any[] = []; let cursor = 0; let buttons: any[] = [];
  Reflect.set(runtime, 'useState', (initial: unknown) => {
    const index = cursor++, original = originalState(initial);
    if (!(index in states)) states[index] = original[0];
    return [states[index], (next: unknown) => { states[index] = next; }];
  });
  const nodeText = (nodes: any): string => Array.isArray(nodes) ? nodes.map(nodeText).join('') : React.isValidElement(nodes) ? nodeText((nodes.props as any).children) : nodes == null || typeof nodes === 'boolean' ? '' : String(nodes);
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'button') buttons.push({ props, text: nodeText(children) });
    return (originalCreate as any)(type, props, ...children);
  });
  const render = () => { cursor = 0; buttons = []; return renderToStaticMarkup(React.createElement(HomePricing)); };
  try {
    render(); buttons.find(button => button.text === 'ไม่ต้อง').props.onClick();
    assert.match(render(), /ไม่ต้องออกเอกสารภาษีในระบบ/);
    buttons.find(button => button.text.startsWith('จ่ายรายปี')).props.onClick();
    assert.match(render(), /19,990/);
    buttons.find(button => button.text === '3 - 5 คน').props.onClick();
    assert.match(render(), /แพ็กเกจที่เหมาะกับคำตอบ เติบโต/);
    buttons.find(button => button.text === 'ต้องออก').props.onClick();
    assert.match(render(), /แพ็กเกจที่เหมาะกับคำตอบ ธุรกิจ/);
  } finally { Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'createElement', originalCreate); }
});
