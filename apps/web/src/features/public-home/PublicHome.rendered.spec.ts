import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { billingOffer, PLAN_TIER_PRESETS } from '@watchdog-bms/contracts';
import { PublicHome, HomeStructuredData } from './PublicHome';
import { HomePricing, HomeAbilityPop, recommendedPlan } from './HomeInteractions';
import { HomeReceiptStory } from './HomeReceiptStory';
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
      if (interval === 'month') assert.ok(markup.includes(price.toLocaleString('en-US')), `${plan.tier} monthly price visible without JS`);
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

test('HOME-PAGE all 18 local images exist; informative pictures have Thai alternatives and fixed dimensions', () => {
  const markup = html();
  const images = [...markup.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
  assert.equal(images.length, 18);
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
test('HOME-PAGE ability pop starts on visibility, disconnects and preserves content without an observer', () => {
  const runtime = require('react') as typeof React;
  const originalEffect = runtime.useEffect, originalCreate = runtime.createElement;
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
  let effect: () => void | (() => void) = () => {}, onVisibility: (entries: { isIntersecting: boolean }[]) => void = () => {};
  let observed: unknown, disconnects = 0;
  const classes: string[] = [], element = { classList: { add: (name: string) => classes.push(name) } };
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: class {
    constructor(callback: typeof onVisibility) { onVisibility = callback; }
    observe(target: unknown) { observed = target; }
    disconnect() { disconnects++; }
  } });
  Reflect.set(runtime, 'useEffect', (work: typeof effect) => { effect = work; });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'div' && (props?.className === 'mm-abilities' || props?.className === 'chooser-mascot')) props.ref.current = element;
    return (originalCreate as any)(type, props, ...children);
  });
  const render = (className?: string) => renderToStaticMarkup(React.createElement(HomeAbilityPop, { className, children: 'น้องมั่งมีทำอะไรได้' }));
  try {
    assert.match(render(), /น้องมั่งมีทำอะไรได้/);
    const cleanup = effect();
    assert.equal(observed, element);
    onVisibility([{ isIntersecting: false }]); assert.deepEqual(classes, []);
    onVisibility([{ isIntersecting: true }]); assert.deepEqual(classes, ['is-visible']); assert.equal(disconnects, 1);
    cleanup?.(); assert.equal(disconnects, 2);
    assert.match(render('chooser-mascot'), /class="chooser-mascot"/);
    const mascotCleanup = effect(); assert.equal(observed, element); mascotCleanup?.();
    Reflect.deleteProperty(globalThis, 'IntersectionObserver');
    assert.match(render(), /น้องมั่งมีทำอะไรได้/); assert.equal(effect(), undefined);
  } finally {
    Reflect.set(runtime, 'useEffect', originalEffect); Reflect.set(runtime, 'createElement', originalCreate);
    if (originalObserver) Object.defineProperty(globalThis, 'IntersectionObserver', originalObserver); else Reflect.deleteProperty(globalThis, 'IntersectionObserver');
  }
});

test('HOME-PAGE receipt story starts muted once on scroll, uses plain playback hints, and keeps two controls on the audio clock', async () => {
  const runtime = require('react') as typeof React;
  const originalState = runtime.useState, originalCreate = runtime.createElement, originalEffect = runtime.useEffect;
  const globals = ['document', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;
  const originals = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const states: any[] = []; let cursor = 0, buttons: any[] = [], audioProps: any;
  let effect: () => (() => void) | undefined = () => undefined, visibility = () => {}, intersect = (_: any) => {};
  let pauses = 0, disconnects = 0, frameId = 0;
  let rejectPlayback: Error | null = null, delayPlayback = false, cancelPending: (() => void) | undefined;
  const classes = new Set<string>(), observed: any[] = [], unobserved: any[] = [];
  const narrator = { classList: { add: (...names: string[]) => names.forEach(name => classes.add(name)), remove: (...names: string[]) => names.forEach(name => classes.delete(name)) } };
  const pictureListeners = new Map<string, () => void>();
  const picture = { complete: false, addEventListener: (name: string, fn: () => void) => pictureListeners.set(name, fn), removeEventListener: (name: string) => pictureListeners.delete(name) };
  const mascot = { querySelector: () => picture };
  const section = { querySelector: (selector: string) => selector === '.receipt-narrator' ? narrator : mascot };
  const frames = new Map<number, () => void>(), listeners = new Map<string, () => void>();
  const plays: { muted: boolean; from: number }[] = [];
  const documentStub = { hidden: false, addEventListener: (_: string, fn: () => void) => { visibility = fn; }, removeEventListener: () => {} };
  const media = { muted: false, currentTime: 0, ended: false,
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
    pause: () => { pauses++; cancelPending?.(); cancelPending = undefined; audioProps.onPause(); listeners.get('pause')?.(); },
    play: async () => {
      plays.push({ muted: media.muted, from: media.currentTime });
      if (rejectPlayback) throw rejectPlayback;
      media.ended = false; audioProps.onPlay(); listeners.get('play')?.();
      if (delayPlayback) await new Promise<void>((_, reject) => { cancelPending = () => reject(new DOMException('Paused', 'AbortError')); });
      audioProps.onPlaying(); listeners.get('playing')?.();
    },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: class {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe(target: any) { observed.push(target); } unobserve(target: any) { unobserved.push(target); } disconnect() { disconnects++; }
  } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (fn: () => void) => { frames.set(++frameId, fn); return frameId; } });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (id: number) => frames.delete(id) });
  Reflect.set(runtime, 'useState', (initial: unknown) => {
    const index = cursor++, original = originalState(initial);
    if (!(index in states)) states[index] = original[0];
    return [states[index], (next: unknown) => { states[index] = next; }];
  });
  Reflect.set(runtime, 'useEffect', (work: typeof effect) => { effect = work; });
  const nodeText = (nodes: any): string => Array.isArray(nodes) ? nodes.map(nodeText).join('') : React.isValidElement(nodes) ? nodeText((nodes.props as any).children) : nodes == null || typeof nodes === 'boolean' ? '' : String(nodes);
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'button') buttons.push({ props, text: props['aria-label'] ?? nodeText(children) });
    if (type === 'section' && props?.ref) props.ref.current = section;
    if (type === 'audio') { audioProps = props; props.ref.current = media; media.muted = props.muted; }
    return (originalCreate as any)(type, props, ...children);
  });
  const render = () => { cursor = 0; buttons = []; const html = renderToStaticMarkup(React.createElement(HomeReceiptStory)); assert.equal(buttons.length, 2); return html; };
  const press = async (label: string) => { assert.ok(buttons.some(button => button.text === label), label); buttons.find(button => button.text === label).props.onClick(); await Promise.resolve(); };
  const tick = (time: number) => { media.currentTime = time; audioProps.onTimeUpdate({ currentTarget: media }); return render(); };
  const frameAt = (time: number) => {
    media.currentTime = time;
    const [id, fn] = [...frames][0]!; frames.delete(id); fn();
    return render();
  };
  try {
    const initial = render(), cleanup = effect();
    assert.equal(audioProps.preload, 'none'); assert.equal(audioProps.muted, true); assert.equal(audioProps.autoPlay, undefined);
    assert.deepEqual(plays, []); assert.equal(frames.size, 0); assert.match(initial, /ตัวอย่างจำลอง/);
    assert.doesNotMatch(initial, /เริ่มใหม่|เลือกดูแต่ละขั้นตอน/);
    assert.match(initial, /มีใบเสร็จอยู่ใช่ไหม/);
    assert.deepEqual(observed, [section, mascot]); assert.ok(classes.has('is-ready')); assert.ok(!classes.has('is-visible'));
    // The speech bubble can be visible before the mascot. It must not consume the entrance.
    intersect([{ target: narrator, isIntersecting: true, intersectionRatio: .8 }]); assert.ok(!classes.has('is-visible'));
    intersect([{ target: mascot, isIntersecting: true, intersectionRatio: .2 }]); assert.ok(!classes.has('is-visible'));
    intersect([{ target: mascot, isIntersecting: true, intersectionRatio: .5 }]); assert.ok(!classes.has('is-visible'));
    // Loading finishes while offscreen: wait for the next scroll into view, not a click.
    intersect([{ target: mascot, isIntersecting: false, intersectionRatio: 0 }]);
    picture.complete = true; pictureListeners.get('load')?.(); assert.ok(!classes.has('is-visible'));
    intersect([{ target: mascot, isIntersecting: true, intersectionRatio: .35 }]);
    assert.ok(classes.has('is-visible')); assert.ok(classes.has('has-started')); assert.deepEqual(unobserved, [mascot]);
    assert.deepEqual(plays, [{ muted: true, from: 0 }]); assert.equal(frames.size, 1);
    assert.match(render(), /เปิดเสียงเพื่อฟังน้องมั่งมีเล่าได้นะคะ/);
    assert.ok(existsSync(new URL('../../../public/home/mangmee-receipt-story.m4a', import.meta.url)));
    await press('เปิดเสียง'); render(); assert.equal(media.muted, false); assert.equal(plays.length, 1);
    assert.match(render(), /น้องมั่งมีกำลังเล่า/); assert.doesNotMatch(render(), /เปิดเสียงเพื่อฟัง/);
    assert.match(frameAt(4.31), /ส่งรูปใบเสร็จแล้ว/);
    assert.match(frameAt(4.32), /รายการรอตรวจ/);
    assert.match(render(), /น้องเตรียมรายการให้ค่ะ/);
    assert.match(render(), /--story-time:4.32s/);
    // A waiting event freezes animation frames; playback resumes from the audio position.
    audioProps.onWaiting(); listeners.get('waiting')?.(); assert.equal(frames.size, 0);
    assert.match(render(), /กำลังโหลด/);
    audioProps.onPlaying(); listeners.get('playing')?.(); assert.equal(frames.size, 1); render();
    media.currentTime = 4.437; // Native time advanced since the last React render.
    await press('หยุดชั่วคราว'); assert.equal(frames.size, 0); assert.match(render(), /--story-time:4.437s/);
    intersect([{ target: section, isIntersecting: false }]);
    intersect([{ target: section, isIntersecting: true, intersectionRatio: .6 }, { target: mascot, isIntersecting: true, intersectionRatio: .5 }]);
    assert.equal(plays.length, 1); assert.equal(frames.size, 0); assert.ok(classes.has('has-started')); assert.deepEqual(unobserved, [mascot]);
    await press('ปิดเสียง'); render(); assert.equal(media.muted, true); assert.equal(plays.length, 1);
    await press('เล่นต่อ'); assert.deepEqual(plays[1], { muted: true, from: 4.437 });
    assert.match(frameAt(7.53), /รายการรอตรวจ/);
    assert.match(frameAt(7.54), /รอคุณยืนยัน/);
    assert.doesNotMatch(render(), /บันทึกเรียบร้อยค่ะ/);
    assert.match(tick(11.71), /รอคุณยืนยัน/);
    assert.match(frameAt(11.72), /บันทึกเรียบร้อยค่ะ/);
    media.currentTime = 16.82; media.ended = true; audioProps.onEnded(); listeners.get('ended')?.();
    assert.equal(frames.size, 0); assert.match(text(render()), /17 \/ 17 วินาที/);
    await press('เปิดเสียง'); render(); assert.equal(plays.length, 2); assert.equal(media.currentTime, 16.82);
    await press('เล่นอีกครั้ง'); assert.deepEqual(plays[2], { muted: false, from: 0 }); assert.equal(frames.size, 1); render();
    const beforeHidden = pauses; documentStub.hidden = true; visibility(); assert.equal(pauses, beforeHidden + 1); assert.equal(frames.size, 0);
    documentStub.hidden = false; render(); await press('เล่น');
    intersect([{ target: section, isIntersecting: false }]); assert.equal(pauses, beforeHidden + 2); assert.equal(frames.size, 0);
    intersect([{ target: section, isIntersecting: true }]);
    audioProps.onError(); listeners.get('error')?.(); assert.match(render(), /เล่นตัวอย่างไม่สำเร็จ/);
    assert.match(render(), /มีใบเสร็จอยู่ใช่ไหม/);
    rejectPlayback = new Error('media unavailable'); await press('เล่น'); assert.match(render(), /เล่นตัวอย่างไม่สำเร็จ/);
    rejectPlayback = null; await press('เล่น'); assert.doesNotMatch(render(), /เล่นตัวอย่างไม่สำเร็จ/); assert.equal(frames.size, 1);
    cleanup?.(); assert.equal(disconnects, 1); assert.equal(frames.size, 0); assert.equal(listeners.size, 0); assert.equal(classes.size, 0); assert.equal(pictureListeners.size, 0);
    // A fresh visit honors enabling sound before the cached image enters.
    states.length = 0; render(); const cachedCleanup = effect(); let playCount = plays.length;
    await press('เปิดเสียง'); render(); assert.equal(plays.length, playCount);
    intersect([{ target: mascot, isIntersecting: true, intersectionRatio: .35 }]);
    assert.ok(classes.has('has-started')); assert.equal(plays.length, playCount + 1); assert.deepEqual(plays.at(-1), { muted: false, from: 0 }); cachedCleanup?.();
    // Broken/slow image still permits the greeting and controls once visible.
    picture.complete = false; states.length = 0; render(); const failedImageCleanup = effect(); playCount = plays.length;
    intersect([{ target: mascot, isIntersecting: true, intersectionRatio: .35 }]); assert.ok(!classes.has('is-visible'));
    pictureListeners.get('error')?.(); assert.ok(classes.has('is-visible')); assert.equal(plays.length, playCount + 1); failedImageCleanup?.();
    // Browser policy rejection keeps the same controls and permits an explicit retry.
    picture.complete = true; media.muted = false; states.length = 0; render(); const blockedCleanup = effect(); playCount = plays.length;
    rejectPlayback = new DOMException('User activation required', 'NotAllowedError');
    intersect([{ target: mascot, isIntersecting: true, intersectionRatio: .5 }]); await Promise.resolve();
    assert.equal(plays.length, playCount + 1); assert.ok(classes.has('is-visible')); assert.ok(!classes.has('has-started'));
    assert.match(render(), /แตะ ▶ เพื่อเริ่มเรื่องได้เลยค่ะ/); assert.doesNotMatch(render(), /เล่นตัวอย่างไม่สำเร็จ|เบราว์เซอร์/); assert.equal(frames.size, 0);
    intersect([{ target: mascot, isIntersecting: false }]); intersect([{ target: mascot, isIntersecting: true, intersectionRatio: .5 }]);
    assert.equal(plays.length, playCount + 1);
    rejectPlayback = null; await press('เล่น'); assert.doesNotMatch(render(), /แตะ ▶ เพื่อเริ่มเรื่อง/); assert.match(render(), /เปิดเสียงเพื่อฟัง/); assert.ok(classes.has('has-started')); blockedCleanup?.();
    // Leaving while audio is loading aborts playback without restarting on return.
    states.length = 0; render(); const pendingCleanup = effect(); playCount = plays.length; delayPlayback = true;
    intersect([{ target: mascot, isIntersecting: true, intersectionRatio: .5 }]); assert.match(render(), /กำลังเตรียมเสียง/); assert.ok(!classes.has('has-started'));
    intersect([{ target: section, isIntersecting: false }]); await Promise.resolve(); await Promise.resolve();
    assert.doesNotMatch(render(), /กำลังเตรียมเสียง|เล่นตัวอย่างไม่สำเร็จ/); assert.equal(frames.size, 0);
    intersect([{ target: section, isIntersecting: true }, { target: mascot, isIntersecting: true, intersectionRatio: .5 }]); assert.equal(plays.length, playCount + 1);
    delayPlayback = false; pendingCleanup?.();
    // A manual start/pause before entry must not be undone by the observer.
    states.length = 0; render(); const earlyCleanup = effect(); await press('เล่น'); render(); await press('หยุดชั่วคราว'); render(); playCount = plays.length;
    intersect([{ target: mascot, isIntersecting: true, intersectionRatio: .5 }]); assert.equal(plays.length, playCount); assert.equal(frames.size, 0); earlyCleanup?.();
    Reflect.deleteProperty(globalThis, 'IntersectionObserver'); states.length = 0; render(); const withoutObserver = effect(); playCount = plays.length;
    assert.equal(classes.size, 0); assert.match(render(), /มีใบเสร็จอยู่ใช่ไหม/); withoutObserver?.();
    assert.equal(plays.length, playCount);
  } finally {
    Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'createElement', originalCreate); Reflect.set(runtime, 'useEffect', originalEffect);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('HOME-PAGE mascot asks one question at a time, preserves edits, and recommends only after completion', () => {
  const runtime = require('react') as typeof React;
  const originalState = runtime.useState, originalCreate = runtime.createElement, originalEffect = runtime.useEffect;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const scrolls: any[] = [], focuses: any[] = [], questionFocuses: any[] = [];
  let reducedMotion = false, pose = '', effects: (() => void)[] = [], effectCursor = 0;
  const dependencies: (readonly unknown[] | undefined)[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => ({ matches: reducedMotion }) } });
  Reflect.set(runtime, 'useEffect', (work: () => void, deps?: readonly unknown[]) => {
    const index = effectCursor++, previous = dependencies[index];
    if (!deps || !previous || deps.some((value, i) => value !== previous[i])) effects.push(work);
    dependencies[index] = deps;
  });
  const states: any[] = []; let cursor = 0; let buttons: any[] = [];
  Reflect.set(runtime, 'useState', (initial: unknown) => {
    const index = cursor++, original = originalState(initial);
    if (!(index in states)) states[index] = original[0];
    return [states[index], (next: unknown) => { states[index] = next; }];
  });
  const nodeText = (nodes: any): string => Array.isArray(nodes) ? nodes.map(nodeText).join('') : React.isValidElement(nodes) ? nodeText((nodes.props as any).children) : nodes == null || typeof nodes === 'boolean' ? '' : String(nodes);
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'button') buttons.push({ props, text: nodeText(children) });
    if (type === 'img') pose = props.src;
    if (type === 'h4' && props.ref) props.ref.current = { focus: (options: unknown) => questionFocuses.push({ question: nodeText(children), options }) };
    if (type === 'article' && props.ref) props.ref.current = {
      focus: (options: unknown) => focuses.push(options),
      scrollIntoView: (options: unknown) => scrolls.push({ target: props['aria-labelledby'], options }),
    };
    return (originalCreate as any)(type, props, ...children);
  });
  const render = () => {
    cursor = 0; effectCursor = 0; effects = []; buttons = [];
    const markup = renderToStaticMarkup(React.createElement(HomePricing)); effects.forEach(work => work()); return markup;
  };
  const press = (label: string) => {
    const button = buttons.find(button => button.text === label || button.text.startsWith(label));
    assert.ok(button, label); button.props.onClick(); return render();
  };
  const options = () => buttons.filter(button => button.props.className === 'opt');
  try {
    const initial = render();
    assert.match(initial, /ให้น้องมั่งมีช่วยเลือกแพ็กเกจ/); assert.match(initial, /ข้อ 1 จาก 4/);
    assert.doesNotMatch(initial, /ตอบ 4 ข้อจากงานที่ร้านทำอยู่จริง|เลือกคำตอบด้านบน|<details class="card chooser"/);
    assert.deepEqual(options().map(button => button.text), ['1 - 2 คน', '3 - 5 คน', '6 - 10 คน', '11 - 30 คน']);
    assert.match(pose, /mangmee-reviewing/); assert.equal(questionFocuses.length, 0); assert.deepEqual(scrolls, []);
    assert.match(press('3 - 5 คน'), /ข้อ 2 จาก 4/); assert.match(pose, /mangmee-scanning/);
    assert.deepEqual(options().map(button => button.text), ['ไม่เกิน 30 ใบ', '31 - 50 ใบ', '51 - 100 ใบ', '101 - 500 ใบ']);
    assert.match(questionFocuses[0].question, /แต่ละเดือน/);
    assert.match(press('จ่ายรายปี'), /19,990/); assert.equal(questionFocuses.length, 1); assert.equal(scrolls.length, 0);
    assert.match(press('ไม่เกิน 30 ใบ'), /ข้อ 3 จาก 4/); assert.match(pose, /mangmee-reviewing/);
    assert.match(press('ย้อนกลับ'), /ข้อ 2 จาก 4/);
    assert.equal(options().find(button => button.text === 'ไม่เกิน 30 ใบ').props['aria-pressed'], true);
    assert.match(press('51 - 100 ใบ'), /ข้อ 3 จาก 4/);
    assert.match(press('1 สาขา'), /ข้อ 4 จาก 4/); assert.match(pose, /mangmee-scanning/);
    assert.deepEqual(options().map(button => button.text), ['ไม่ต้องทำเอง', 'ต้องทำเอง']);
    assert.equal(scrolls.length, 0); assert.equal(focuses.length, 0);
    const result = press('ต้องทำเอง');
    assert.match(result, /น้องแนะนำแพ็กเกจธุรกิจค่ะ/); assert.match(result, /ตอบครบแล้วค่ะ/); assert.match(pose, /mangmee-reviewing/);
    assert.match(result, /คนดูแลใบเสร็จ<\/span><b>3 - 5 คน/); assert.equal(options().length, 0);
    assert.deepEqual(scrolls, [{ target: 'home-plan-ENTERPRISE_1999', options: { behavior: 'smooth', block: 'start' } }]);
    assert.deepEqual(focuses, [{ preventScroll: true }]);
    press('จ่ายรายเดือน'); render(); assert.equal(scrolls.length, 1); assert.equal(focuses.length, 1);
    assert.match(press('แก้คำตอบ'), /ข้อ 1 จาก 4/);
    assert.equal(options().find(button => button.text === '3 - 5 คน').props['aria-pressed'], true);
    // Re-selecting the same answer advances, and old later answers do not complete the guide early.
    assert.match(press('3 - 5 คน'), /ข้อ 2 จาก 4/);
    assert.equal(options().find(button => button.text === '51 - 100 ใบ').props['aria-pressed'], true);
    press('ไม่เกิน 30 ใบ'); press('1 สาขา'); assert.equal(scrolls.length, 1);
    assert.equal(options().find(button => button.text === 'ต้องทำเอง').props['aria-pressed'], true);
    reducedMotion = true;
    assert.match(press('ไม่ต้องทำเอง'), /น้องแนะนำแพ็กเกจเติบโตค่ะ/);
    assert.deepEqual(scrolls[1], { target: 'home-plan-BASIC_499', options: { behavior: 'instant', block: 'start' } });
    assert.equal(scrolls.length, 2);
  } finally {
    Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'createElement', originalCreate); Reflect.set(runtime, 'useEffect', originalEffect);
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
