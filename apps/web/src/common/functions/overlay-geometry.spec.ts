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
