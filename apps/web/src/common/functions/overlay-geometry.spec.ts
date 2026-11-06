import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeAnchoredPanel, overlayEdges, readOverlayBounds } from './overlay-geometry';
const viewport = { top: 0, bottom: 844, left: 0, right: 390 };
const field = { top: 400, bottom: 444, left: 16, right: 374 };
test('BEH-Q calendar prefers below, stays attached and cannot cover the top stack', () => {
  const bounds = overlayEdges(viewport, [{ ...viewport, bottom: 80, edge: 'top' }, { ...viewport, top: 80, bottom: 140, edge: 'top' }]);
  assert.equal(bounds.top, 140);
  assert.deepEqual(placeAnchoredPanel(field, bounds, 400, 286), { side: 'below', edge: 450, left: 16, maxHeight: 386 });
  assert.equal(placeAnchoredPanel({ ...field, top: 600, bottom: 644 }, bounds, 300, 286)?.side, 'above');
  assert.equal(placeAnchoredPanel(field, viewport, 300, 286)?.side, 'below');
});
test('BEH-Q closes for a field hidden under sticky chrome, offscreen or clipped, never forces a 96px overflow', () => {
  const bounds = { ...viewport, top: 140, bottom: 720 };
  for (const anchor of [{ ...field, top: 50, bottom: 94 }, { ...field, top: -50, bottom: -6 }, { ...field, top: 820, bottom: 864 }, { ...field, left: 400, right: 500 }]) {
    assert.equal(placeAnchoredPanel(anchor, bounds, 400, 286), null);
  }
  assert.equal(placeAnchoredPanel(field, { ...viewport, top: 390, bottom: 460 }, 400, 286), null);
});
test('BEH-Q measures bottom bars and ignores sidebars, offscreen and horizontally unrelated chrome', () => {
  assert.deepEqual(overlayEdges(viewport, [
    { ...viewport, top: 720, edge: 'bottom' },
    { ...viewport, bottom: 0, top: -80, edge: 'top' },
    { ...viewport, edge: 'top' }, // full-height overlay/sidebar is not a top bar
    { top: 0, bottom: 250, left: 500, right: 600, edge: 'top' },
  ]), { ...viewport, bottom: 720 });
});

test('JFIX-2Q a chooser above the bottom action bar opens upward even when the field edge overlaps the bar', () => {
  const screen = { top: 0, bottom: 720, left: 0, right: 1280 };
  const bounds = overlayEdges(screen, [
    { ...screen, bottom: 64, edge: 'top' },
    { ...screen, top: 656, edge: 'bottom' },
  ]);
  assert.deepEqual(bounds, { ...screen, top: 64, bottom: 656 });
  for (const bottom of [650, 660]) {
    const anchor = { top: 620, bottom, left: 790, right: 1220 };
    assert.deepEqual(placeAnchoredPanel(anchor, bounds, 240, 430), { side: 'above', edge: 614, left: 790, maxHeight: 240 });
  }
  assert.equal(placeAnchoredPanel({ top: 656, bottom: 696, left: 790, right: 1220 }, bounds, 240, 430), null);
});

test('JFIX-2Q phone chooser remains attached to the visible side of its field without covering either bar', () => {
  const bounds = overlayEdges(viewport, [{ ...viewport, bottom: 120, edge: 'top' }, { ...viewport, top: 720, edge: 'bottom' }]);
  const above = placeAnchoredPanel({ ...field, top: 690, bottom: 734 }, bounds, 240, 358)!;
  assert.equal(above.side, 'above'); assert.equal(above.edge, 684);
  assert.ok(above.edge - above.maxHeight >= bounds.top);
  const below = placeAnchoredPanel({ ...field, top: 100, bottom: 144 }, bounds, 240, 358)!;
  assert.equal(below.side, 'below'); assert.equal(below.edge, 150);
  assert.ok(below.edge + below.maxHeight <= bounds.bottom);
  assert.equal(placeAnchoredPanel({ ...field, top: 76, bottom: 120 }, bounds, 240, 358), null);
});


test('UAT-T1 a portaled calendar can open above a phone bottom sheet and show a whole month', () => {
  const globals = globalThis as any;
  const previous = { window: globals.window, document: globals.document };
  const root = { querySelectorAll: () => [] };
  const anchor = { getBoundingClientRect: () => ({ top: 650, bottom: 694, left: 16, right: 374 }),
    closest: (selector: string) => selector === '[data-modal-body]' ? { getBoundingClientRect: () => ({ top: 500, bottom: 760 }) } : root };
  try {
    globals.window = { innerHeight: 844, innerWidth: 390 }; globals.document = { body: root };
    const bounds = readOverlayBounds(anchor as any);
    const placed = placeAnchoredPanel(anchor.getBoundingClientRect(), bounds, 400, 286)!;
    assert.equal(placed.side, 'above'); assert.equal(placed.maxHeight, 400);
    assert.ok(placed.edge - placed.maxHeight >= bounds.top);
  } finally { globals.window = previous.window; globals.document = previous.document; }
});

test('MOBILE-1 a dialog calendar fits the whole month above its action bar on a 375 by 667 phone', () => {
  const screen = { top: 0, bottom: 667, left: 0, right: 375 };
  const bounds = overlayEdges(screen, [{ ...screen, top: 575, edge: 'bottom' }]);
  const anchor = { top: 325, bottom: 369, left: 16, right: 359 };
  // Neither side of the field has 500px: the calendar may overlap its trigger,
  // rather than cutting the final week out of view.
  const placed = placeAnchoredPanel(anchor, bounds, 500, 286, true)!;
  assert.equal(placed.maxHeight, 500);
  const top = placed.side === 'above' ? placed.edge - placed.maxHeight : placed.edge;
  assert.ok(top >= bounds.top + 8);
  assert.ok(top + placed.maxHeight <= bounds.bottom - 8);
});

test('MOBILE-1 normal-flow dialog action bars reserve space for portaled calendars', () => {
  const globals = globalThis as any;
  const previous = { window: globals.window, document: globals.document, getComputedStyle: globals.getComputedStyle };
  const rect = { top: 575, bottom: 667, left: 0, right: 375, width: 375, height: 92 };
  const footer = { hasAttribute: (name: string) => name === 'data-modal-chrome', contains: () => false,
    closest: () => null, getBoundingClientRect: () => ({ ...rect, toJSON: () => rect }) };
  const root = { querySelectorAll: () => [footer] };
  const anchor = { closest: () => root, getBoundingClientRect: () => ({ top: 325, bottom: 369, left: 16, right: 359 }) };
  try {
    globals.window = { innerHeight: 667, innerWidth: 375 }; globals.document = { body: root };
    globals.getComputedStyle = () => ({ position: 'static', visibility: 'visible', display: 'block' });
    assert.deepEqual(readOverlayBounds(anchor as any), { top: 0, bottom: 575, left: 0, right: 375 });
  } finally { Object.assign(globals, previous); }
});

// Demo 2026-11-06: a fixed chat button at the bottom right (computed top 759px, bottom 81px) was read as a
// top bar, so the VAT and evidence lists above it closed the moment they opened.
test('a floating button pinned to the bottom is a bottom bar, never a top one', () => {
  const globals = globalThis as any;
  const previous = { window: globals.window, document: globals.document, getComputedStyle: globals.getComputedStyle };
  const rect = { top: 759, bottom: 819, left: 1480, right: 1540, width: 60, height: 60 };
  const button = { hasAttribute: () => false, contains: () => false, closest: () => null, getBoundingClientRect: () => ({ ...rect, toJSON: () => rect }) };
  const root = { querySelectorAll: () => [button] };
  const anchorRect = { top: 394, bottom: 434, left: 846, right: 1483 };
  const anchor = { closest: () => root, getBoundingClientRect: () => anchorRect };
  try {
    globals.window = { innerHeight: 900, innerWidth: 1556 }; globals.document = { body: root };
    globals.getComputedStyle = () => ({ position: 'fixed', visibility: 'visible', display: 'block', top: '759px', bottom: '81px' });
    const bounds = readOverlayBounds(anchor as any);
    assert.deepEqual(bounds, { top: 0, bottom: 759, left: 0, right: 1556 });
    assert.equal(placeAnchoredPanel(anchorRect, bounds, 240, 300)?.side, 'below');
  } finally { Object.assign(globals, previous); }
});
