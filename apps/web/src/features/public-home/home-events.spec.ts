import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicHome } from './PublicHome';
import { resolveHomeEvent, resolveHomeEventPalette } from './HomeEventTheme';

test('event selection accepts registered IDs and falls back safely for missing, repeated and unknown inputs', () => {
  assert.equal(resolveHomeEvent('halloween'), 'halloween');
  for (const input of [undefined, 'default', 'christmas', '__proto__', 'toString', ['halloween', 'default']]) {
    assert.equal(resolveHomeEvent(input), 'default');
  }
  for (const palette of ['forest', 'pumpkin', 'plum'] as const) assert.equal(resolveHomeEventPalette(palette), palette);
  for (const input of [undefined, 'unknown', '__proto__', ['plum', 'pumpkin']]) assert.equal(resolveHomeEventPalette(input), 'plum');
});

test('seasonal decoration preserves all content and links, and default mounts no event artwork', () => {
  const normal = renderToStaticMarkup(React.createElement(PublicHome));
  const themed = renderToStaticMarkup(React.createElement(PublicHome, { event: 'halloween' }));
  assert.doesNotMatch(normal, /data-event-art|\/home\/events\/|home-event-tools|data-home-event/);
  assert.match(themed, /data-home-event="halloween"/);
  assert.match(themed, /data-home-palette="plum"/);
  assert.match(themed, /home-event-middle/);
  const text = (html: string) => html.replace(/<[^>]*>/g, '');
  assert.equal(text(themed), text(normal));
  for (const palette of ['pumpkin', 'plum'] as const) {
    const variant = renderToStaticMarkup(React.createElement(PublicHome, { event: 'halloween', palette }));
    assert.match(variant, new RegExp(`data-home-palette="${palette}"`));
    assert.equal(text(variant), text(normal));
    assert.equal(renderToStaticMarkup(React.createElement(PublicHome, { palette })), normal);
  }
  const links = (html: string) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(links(themed), links(normal));
  const images = [...themed.matchAll(/<img\b[^>]*src="(\/home\/events\/[^" ]+)"[^>]*>/g)];
  assert.equal(images.length, 7);
  for (const [markup, path] of images) {
    assert.match(markup, /alt=""/);
    assert.ok(existsSync(new URL(`../../../public${path}`, import.meta.url)), path);
  }
});
