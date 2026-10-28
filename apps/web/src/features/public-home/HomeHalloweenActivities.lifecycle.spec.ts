import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { HomeHalloweenActivities } from './HomeHalloweenActivities';
import { HALLOWEEN_GAME_DEADLINES } from './home-halloween-countdown';

const runtime = require('react') as typeof React;

test('automatic chooser is silent, stays dismissed across renders, and gestures own one audio loop', () => {
  const originals = { useState: runtime.useState, useRef: runtime.useRef, useEffect: runtime.useEffect, createElement: runtime.createElement };
  const globals = new Map(['window', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const states: any[] = [], refs: any[] = [];
  const effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  let stateCursor = 0, refCursor = 0, effectCursor = 0;
  let elements: { type: unknown; props: any }[] = [];
  let pending: (() => void)[] = [];
  let starts = 0, stops = 0, suspends = 0, resumes = 0, shows = 0, focused = 0;
  const nativeDialog = { open: false, scrollTop: 0, showModal() { this.open = true; shows++; }, close() { this.open = false; control('dialog').onClose({ currentTarget: this }); } };
  function control(type: string, key?: string, value?: string) {
    const element = elements.find(element => element.type === type && (!key || element.props[key] === value));
    assert.ok(element, `${type} ${key ?? ''} ${value ?? ''}`);
    return element.props;
  }
  function render(autoOpen: boolean) {
    stateCursor = 0; refCursor = 0; effectCursor = 0; elements = []; pending = [];
    HomeHalloweenActivities({ autoOpen });
    for (const work of pending) work();
  }
  class AudioContextProbe {
    state = 'running';
    destination = {};
    constructor() { starts++; }
    resume() { resumes++; this.state = 'running'; return Promise.resolve(); }
    suspend() { suspends++; this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; stops++; return Promise.resolve(); }
    createBuffer(_channels: number, size: number) { return { getChannelData: () => new Float32Array(size) }; }
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    createBufferSource() { return { connect() {}, disconnect() {}, start() {} }; }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: AudioContextProbe, setInterval() { return 1; }, clearInterval() {} } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } });
  Reflect.set(runtime, 'useState', (initial: unknown) => {
    const index = stateCursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (value: any) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  });
  Reflect.set(runtime, 'useRef', (initial: unknown) => { const index = refCursor++; return refs[index] ?? (refs[index] = { current: initial }); });
  Reflect.set(runtime, 'useEffect', (work: () => void | (() => void), deps: unknown[]) => {
    const index = effectCursor++;
    if (effects[index] && deps.every((dep, i) => Object.is(dep, effects[index].deps[i]))) return;
    pending.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: work() || undefined }; });
  });
  Reflect.set(runtime, 'createElement', (type: unknown, props: any, ...children: any[]) => {
    elements.push({ type, props });
    if (props?.ref) props.ref.current = type === 'dialog' ? nativeDialog : { focus() { focused++; } };
    return originals.createElement(type as any, props, ...children);
  });
  try {
    render(false);
    assert.equal(nativeDialog.open, false, 'normal homepage remains manual');
    render(true);
    assert.equal(nativeDialog.open, true);
    assert.equal(starts, 0, 'automatic entry never requests audio');
    render(true);
    assert.equal(shows, 1, 'ordinary state renders do not open again');
    states[2] = HALLOWEEN_GAME_DEADLINES.candy - 1000;
    render(true);
    assert.equal(control('button', 'data-halloween-door', 'ghost').disabled, false);
    assert.equal(control('button', 'data-halloween-door', 'candy').disabled, true, 'upcoming door is natively disabled');
    assert.equal(control('button', 'data-halloween-door', 'escape').disabled, true, 'later door is natively disabled');
    states[2] = HALLOWEEN_GAME_DEADLINES.candy;
    render(true);
    assert.equal(control('button', 'data-halloween-door', 'candy').disabled, false, 'door unlocks at its deadline');
    control('button', 'data-halloween-door', 'candy').onClick();
    render(true);
    assert.equal(starts, 1, 'a door supplies the user gesture');
    const candyGame = elements.find(element => typeof element.type === 'function' && element.type.name === 'HalloweenCandyGame');
    assert.ok(candyGame, 'the open candy door renders its game');
    candyGame.props.onStart();
    assert.equal(suspends, 1, 'starting a round pauses the quiet door ambience');
    assert.equal(candyGame.props.onEnd, undefined, 'the result keeps door ambience paused under celebration music');
    candyGame.props.onStart();
    assert.equal(suspends, 2, 'replay pauses the ambience again');
    const beforeBack = resumes;
    candyGame.props.onBack();
    assert.equal(resumes, beforeBack + 1, 'returning to the doors resumes the ambience');
    states[0] = null;
    states[2] = HALLOWEEN_GAME_DEADLINES.escape;
    render(true);
    control('button', 'data-halloween-door', 'escape').onClick();
    render(true);
    assert.equal(starts, 1, 'changing doors keeps one loop');
    const escapeGame = elements.find(element => typeof element.type === 'function' && element.type.name === 'HalloweenEscapeGame');
    assert.ok(escapeGame, 'the open escape door renders its game');
    escapeGame.props.onStart();
    assert.equal(suspends, 3, 'starting an escape run pauses the quiet door ambience');
    const beforeEscapeResult = resumes;
    escapeGame.props.onEnd();
    assert.equal(resumes, beforeEscapeResult + 1, 'the escape result resumes the same quiet ambience');
    escapeGame.props.onStart();
    assert.equal(suspends, 4, 'escape replay pauses the ambience again');
    const beforeEscapeBack = resumes;
    escapeGame.props.onBack();
    assert.equal(resumes, beforeEscapeBack + 1, 'returning from the mansion resumes the ambience');
    control('dialog').onCancel();
    nativeDialog.close();
    render(true);
    assert.equal(stops, 1);
    assert.equal(nativeDialog.open, false);
    assert.equal(shows, 1, 'dismissal does not retrigger automatic opening');
    for (const dismissal of ['close', 'backdrop'] as const) {
      control('button', 'className', 'home-halloween-entry-button').onClick();
      render(true);
      assert.equal(nativeDialog.open, true);
      if (dismissal === 'close') control('button', 'className', 'home-halloween-close').onClick();
      else {
        Object.assign(nativeDialog, { getBoundingClientRect: () => ({ left: 10, right: 100, top: 10, bottom: 100 }) });
        control('dialog').onClick({ target: nativeDialog, currentTarget: nativeDialog, clientX: 0, clientY: 0 });
      }
      render(true);
      assert.equal(nativeDialog.open, false);
      assert.equal(starts, stops, 'every dismissal disposes its loop');
    }
    control('button', 'className', 'home-halloween-entry-button').onClick();
    render(true);
    for (const effect of effects) effect.cleanup?.();
    assert.equal(starts, stops, 'unmount disposes the active loop');
    assert.ok(focused > 0, 'closing restores an entrance focus target');
  } finally {
    for (const effect of effects) effect.cleanup?.();
    for (const name of ['useState', 'useRef', 'useEffect', 'createElement'] as const) Reflect.set(runtime, name, originals[name]);
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
