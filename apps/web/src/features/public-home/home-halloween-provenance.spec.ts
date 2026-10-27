import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { GHOST_CARDS, SECRET_CARD_BACK, STANDARD_CARD_BACK } from './home-halloween-cards';
import { embedHalloweenProvenance, makeHalloweenImageProvenance, readHalloweenProvenance, type HalloweenImageProvenance } from './home-halloween-provenance';

const encoder = new TextEncoder();
const prefix = encoder.encode('mangmeeplus\0');
const metadata = makeHalloweenImageProvenance('01-krasue', 'card');
const png = new Uint8Array(readFileSync(new URL(`../../../public${GHOST_CARDS[0].image}`, import.meta.url)));
const jpeg = removeJpegMetadata(new Uint8Array(readFileSync(new URL('../../../../../docs/evidence/halloween-ghost-reveal-2026-10-27/mangmee-01-krasue-story-9x16.jpg', import.meta.url))));
function concat(...arrays: Uint8Array[]) { return Buffer.concat(arrays); }
function pngChunks(bytes: Uint8Array) {
  const chunks: { type: string; bytes: Uint8Array; data: Uint8Array }[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset < bytes.length;) {
    const end = offset + view.getUint32(offset) + 12;
    chunks.push({ type: Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString(), bytes: bytes.subarray(offset, end), data: bytes.subarray(offset + 8, end - 4) });
    offset = end;
  }
  return chunks;
}
function isOurs(chunk: ReturnType<typeof pngChunks>[number]) { return chunk.type === 'tEXt' && prefix.every((value, index) => chunk.data[index] === value); }
function removePngMetadata(bytes: Uint8Array) { return concat(bytes.subarray(0, 8), ...pngChunks(bytes).filter(chunk => !isOurs(chunk)).map(chunk => chunk.bytes)); }
function textChunk(text: string, keyword = 'mangmeeplus') {
  const body = encoder.encode(`tEXt${keyword}\0${text}`);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const chunk = new Uint8Array(body.length + 8);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length - 4);
  chunk.set(body, 4);
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}
function pngWithText(text: string, keyword?: string) {
  const clean = removePngMetadata(png);
  return concat(clean.subarray(0, -12), textChunk(text, keyword), clean.subarray(-12));
}
function scanOffset(bytes: Uint8Array) {
  for (let offset = 2; offset + 4 < bytes.length;) {
    assert.equal(bytes[offset], 0xff);
    if (bytes[offset + 1] === 0xda) return offset;
    offset += 2 + bytes[offset + 2] * 256 + bytes[offset + 3];
  }
  throw new Error('Fixture has no scan');
}
function removeJpegMetadata(bytes: Uint8Array) {
  const scan = scanOffset(bytes);
  const kept = [bytes.subarray(0, 2)];
  for (let offset = 2; offset < scan;) {
    const end = offset + 2 + bytes[offset + 2] * 256 + bytes[offset + 3];
    const payload = bytes.subarray(offset + 4, end);
    if (bytes[offset + 1] !== 0xfe || !prefix.every((value, index) => payload[index] === value)) kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  return new Uint8Array(concat(...kept, bytes.subarray(scan)));
}
function jpegComment(payload: Uint8Array) {
  const header = new Uint8Array([0xff, 0xfe, (payload.length + 2) >>> 8, (payload.length + 2) & 255]);
  return concat(header, payload);
}
function jpegWithComment(payload: Uint8Array) {
  const scan = scanOffset(jpeg);
  return concat(jpeg.subarray(0, scan), jpegComment(payload), jpeg.subarray(scan));
}

test('all 25 approved PNGs roundtrip repeatably with every original chunk and decompressed image byte preserved', () => {
  const assets = [...GHOST_CARDS.map(card => ({ image: card.image, id: card.id, variant: 'card' as const })),
    ...[STANDARD_CARD_BACK, SECRET_CARD_BACK].map(image => ({ image, id: image.split('/').at(-1)!.replace('.png', ''), variant: 'back' as const }))];
  assert.equal(assets.length, 25);
  for (const asset of assets) {
    const original = new Uint8Array(readFileSync(new URL(`../../../public${asset.image}`, import.meta.url)));
    const snapshot = original.slice();
    const expected = makeHalloweenImageProvenance(asset.id, asset.variant);
    const stamped = embedHalloweenProvenance(original, expected);
    assert.deepEqual(readHalloweenProvenance(stamped), expected, asset.id);
    assert.deepEqual(embedHalloweenProvenance(stamped, expected), stamped, asset.id);
    assert.deepEqual(removePngMetadata(stamped), removePngMetadata(original), asset.id);
    const samples = (bytes: Uint8Array) => inflateSync(concat(...pngChunks(bytes).filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)));
    assert.deepEqual(samples(stamped), samples(original), asset.id);
    assert.deepEqual(original, snapshot, 'input bytes are immutable');
    assert.equal(pngChunks(stamped).filter(isOurs).length, 1);
  }
});

test('PNG read ignores other text, replacement changes only ours, and checks CRC, bounds and metadata fields', () => {
  const unmarked = pngWithText('a mangmeeplus string is not a marker', 'Description');
  assert.equal(readHalloweenProvenance(unmarked), null);
  const stamped = embedHalloweenProvenance(unmarked, metadata);
  const changed = makeHalloweenImageProvenance('back-secret', 'back');
  assert.deepEqual(readHalloweenProvenance(embedHalloweenProvenance(stamped, changed)), changed);
  assert.deepEqual(removePngMetadata(stamped), unmarked);
  for (const invalid of [{ ...metadata, version: 2 }, { ...metadata, source: 'https://other.test' }, { ...metadata, event: 'other' },
    { ...metadata, cardId: '../01-krasue' }, { ...metadata, variant: 'other' }, { ...metadata, extra: true }]) {
    assert.throws(() => readHalloweenProvenance(pngWithText(JSON.stringify(invalid))), /provenance fields/);
    assert.throws(() => embedHalloweenProvenance(png, invalid as HalloweenImageProvenance), /provenance fields/);
  }
  for (const invalid of ['', '{', 'x'.repeat(2049)]) assert.throws(() => readHalloweenProvenance(pngWithText(invalid)));
  const damaged = stamped.slice();
  damaged[damaged.length - 5] ^= 1;
  assert.throws(() => readHalloweenProvenance(damaged), /CRC/);
  assert.throws(() => readHalloweenProvenance(stamped.subarray(0, -1)));
  const overflow = stamped.slice();
  overflow.set([0xff, 0xff, 0xff, 0xff], 8);
  assert.throws(() => readHalloweenProvenance(overflow), /bounds/);
  const duplicate = concat(stamped.subarray(0, -12), textChunk(JSON.stringify(metadata)), stamped.subarray(-12));
  assert.throws(() => readHalloweenProvenance(duplicate), /duplicate/);
});

test('real JPEG roundtrips idempotently, retains JFIF first and every encoded scan byte', () => {
  assert.equal(readHalloweenProvenance(jpeg), null);
  const snapshot = jpeg.slice();
  const expected = makeHalloweenImageProvenance('01-krasue', 'story');
  const stamped = embedHalloweenProvenance(jpeg, expected);
  assert.deepEqual(readHalloweenProvenance(stamped), expected);
  assert.deepEqual(embedHalloweenProvenance(stamped, expected), stamped);
  assert.deepEqual(removeJpegMetadata(stamped), jpeg);
  assert.deepEqual(stamped.subarray(0, scanOffset(jpeg)), jpeg.subarray(0, scanOffset(jpeg)));
  assert.deepEqual(stamped.subarray(scanOffset(stamped)), jpeg.subarray(scanOffset(jpeg)));
  assert.deepEqual(jpeg, snapshot);
  const changed = makeHalloweenImageProvenance('23-mangmee-secret', 'story');
  const replaced = embedHalloweenProvenance(stamped, changed);
  assert.deepEqual(readHalloweenProvenance(replaced), changed);
  assert.deepEqual(replaced.subarray(scanOffset(replaced)), jpeg.subarray(scanOffset(jpeg)));
});

test('JPEG reads actual COM segments, rejects truncated or invalid markers and never searches entropy for a label', () => {
  assert.equal(readHalloweenProvenance(jpegWithComment(encoder.encode('Description: mangmeeplus'))), null);
  for (const text of ['{', JSON.stringify({ ...metadata, source: 'https://other.test' }), 'x'.repeat(2049)]) {
    assert.throws(() => readHalloweenProvenance(jpegWithComment(concat(prefix, encoder.encode(text)))));
  }
  const stamped = embedHalloweenProvenance(jpeg, metadata);
  for (const cut of [1, 2, 3, 10, stamped.length - 1, scanOffset(stamped) + 5]) assert.throws(() => readHalloweenProvenance(stamped.subarray(0, cut)));
  const overflow = jpeg.slice();
  overflow[4] = 0xff;
  overflow[5] = 0xff;
  assert.throws(() => readHalloweenProvenance(overflow));
  const entropyText = concat(jpeg.subarray(0, -2), new Uint8Array([0xff, 0]), prefix, encoder.encode(JSON.stringify(metadata)), jpeg.subarray(-2));
  assert.equal(readHalloweenProvenance(entropyText), null);
  assert.throws(() => readHalloweenProvenance(new Uint8Array([1, 2, 3])));
  assert.throws(() => makeHalloweenImageProvenance('', 'card'));
  assert.throws(() => makeHalloweenImageProvenance('x'.repeat(101), 'card'));
});
