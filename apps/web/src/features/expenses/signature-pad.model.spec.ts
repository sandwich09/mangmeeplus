import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSignatureCropBounds, isSignaturePadEmpty } from './signature-pad.model';

function imageDataWithInk(width: number, height: number, points: Array<[number, number]>): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of points) data[(y * width + x) * 4 + 3] = 255;
  return { data, width, height } as unknown as ImageData;
}

test('crops to opaque signature points with padding clamped to the canvas', () => {
  assert.deepEqual(
    findSignatureCropBounds(imageDataWithInk(10, 8, [[3, 2], [7, 5]]), 2),
    { x: 1, y: 0, width: 9, height: 8 },
  );
  assert.deepEqual(
    findSignatureCropBounds(imageDataWithInk(10, 8, [[0, 0]]), 3),
    { x: 0, y: 0, width: 4, height: 4 },
  );
  assert.equal(findSignatureCropBounds(imageDataWithInk(2, 2, []), 2), null);
});

test('treats a pad as empty until at least one stroke has a point', () => {
  assert.equal(isSignaturePadEmpty([]), true);
  assert.equal(isSignaturePadEmpty([[], []]), true);
  assert.equal(isSignaturePadEmpty([[{ x: 0.5, y: 0.5 }]]), false);
});
