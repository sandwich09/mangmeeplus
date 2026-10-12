import assert from 'node:assert/strict';
import { mock } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).React = React;
export const h: typeof React.createElement = (...args: any[]) => (React.createElement as any)(...args);
export function mutable(path: string) {
  const exports = { ...require(path) };
  require.cache[require.resolve(path)]!.exports = exports;
  return exports;
}

// SSR exercises real handlers; only hooks' persistence and portal transport are replaced.
export function certificateHarness(renderNode: () => React.ReactNode, initial: unknown[] = []) {
  const runtime = require('react');
  const state = [...initial];
  const nodes: { tag: string; props: any }[] = [];
  let effects: Array<() => void | (() => void)> = [];
  let cleanups: Array<() => void> = [];
  function render(runEffects = false) {
    let index = 0;
    nodes.length = 0;
    effects = [];
    const realState = runtime.useState;
    const stateMock = mock.method(runtime, 'useState', (init: unknown) => {
      const pair = realState(init);
      const slot = index++;
      if (!(slot in state)) state[slot] = pair[0];
      return [state[slot], (next: any) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    });
    const effectMock = mock.method(runtime, 'useEffect', (fn: () => void | (() => void)) => { effects.push(fn); });
    const realCreate = runtime.createElement;
    const createMock = mock.method(runtime, 'createElement', (tag: any, props: any, ...children: any[]) => {
      nodes.push({ tag: typeof tag === 'string' ? tag : tag.name, props: { ...props, children } });
      return realCreate(tag, props, ...children);
    });
    let html: string;
    try { html = renderToStaticMarkup(renderNode()); }
    finally { stateMock.mock.restore(); effectMock.mock.restore(); createMock.mock.restore(); }
    if (runEffects) {
      cleanups.forEach(fn => fn());
      cleanups = effects.map(fn => fn()).filter((fn): fn is () => void => typeof fn === 'function');
    }
    return html;
  }
  const find = (tag: string, predicate: (props: any) => boolean = () => true) => {
    const node = nodes.find(node => node.tag === tag && predicate(node.props));
    assert.ok(node, `missing ${tag}`);
    return node.props;
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { state, nodes, render, find, settle, cleanup: () => cleanups.forEach(fn => fn()) };
}
