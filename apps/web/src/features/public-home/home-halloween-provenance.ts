export type HalloweenImageProvenance = {
  version: 1;
  source: 'https://mangmeeplus.com';
  event: 'halloween';
  cardId: string;
  variant: 'card' | 'story' | 'back';
};

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const keyword = 'mangmeeplus';
const prefix = encoder.encode(`${keyword}\0`);
const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const maxText = 2048;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
type Range = { start: number; end: number };
type ParsedImage = { format: 'png' | 'jpeg'; insert: number; remove: Range[]; metadata: HalloweenImageProvenance | null };

function fail(message: string): never { throw new Error(`Invalid Halloween image: ${message}`); }
function startsWith(bytes: Uint8Array, expected: Uint8Array) { return expected.every((value, index) => bytes[index] === value); }
function validate(value: unknown): HalloweenImageProvenance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid provenance fields');
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 5 || fields.version !== 1 || fields.source !== 'https://mangmeeplus.com'
    || fields.event !== 'halloween' || typeof fields.cardId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(fields.cardId)
    || !['card', 'story', 'back'].includes(fields.variant as string)) fail('invalid provenance fields');
  return { version: 1, source: 'https://mangmeeplus.com', event: 'halloween', cardId: fields.cardId, variant: fields.variant as HalloweenImageProvenance['variant'] };
}

export function makeHalloweenImageProvenance(cardId: string, variant: HalloweenImageProvenance['variant']): HalloweenImageProvenance {
  return validate({ version: 1, source: 'https://mangmeeplus.com', event: 'halloween', cardId, variant });
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function provenanceAt(image: ParsedImage, payload: Uint8Array, range: Range) {
  if (!startsWith(payload, prefix)) return;
  if (image.metadata) fail('duplicate provenance');
  const text = payload.subarray(prefix.length);
  if (!text.length || text.length > maxText) fail('provenance length');
  let value: unknown;
  try { value = JSON.parse(decoder.decode(text)); } catch { fail('damaged provenance JSON'); }
  image.metadata = validate(value);
  image.remove.push(range);
}

function parsePng(bytes: Uint8Array): ParsedImage {
  if (!startsWith(bytes, pngSignature)) fail('PNG signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const image: ParsedImage = { format: 'png', insert: -1, remove: [], metadata: null };
  let offset = 8;
  let hasData = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) fail('truncated PNG chunk');
    const length = view.getUint32(offset);
    if (length > 0x7fffffff || length > bytes.length - offset - 12) fail('PNG chunk bounds');
    const end = offset + length + 12;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type)) fail('PNG chunk type');
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) fail('PNG CRC');
    if (offset === 8 && (type !== 'IHDR' || length !== 13 || !view.getUint32(offset + 8) || !view.getUint32(offset + 12))) fail('PNG header');
    if (offset !== 8 && type === 'IHDR') fail('duplicate PNG header');
    if (type === 'IDAT') hasData = true;
    if (type === 'tEXt') {
      const payload = bytes.subarray(offset + 8, end - 4);
      const separator = payload.indexOf(0);
      if (separator < 1 || separator > 79) fail('PNG text keyword');
      provenanceAt(image, payload, { start: offset, end });
    }
    if (type === 'IEND') {
      if (length !== 0 || !hasData || end !== bytes.length) fail('PNG ending');
      image.insert = offset;
      return image;
    }
    offset = end;
  }
  return fail('missing PNG ending');
}

function parseJpeg(bytes: Uint8Array): ParsedImage {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('JPEG signature');
  const image: ParsedImage = { format: 'jpeg', insert: -1, remove: [], metadata: null };
  let offset = 2;
  let hasFrame = false;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 0xff) fail('JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) fail('truncated JPEG marker');
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (image.insert < 0 || offset !== bytes.length) fail('JPEG ending');
      return image;
    }
    if (marker === 0xd8 || marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) fail('unexpected JPEG marker');
    if (marker === 1) continue;
    if (offset + 2 > bytes.length) fail('truncated JPEG length');
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || length > bytes.length - offset) fail('JPEG segment bounds');
    const end = offset + length;
    if (marker === 0xfe) provenanceAt(image, bytes.subarray(offset + 2, end), { start, end });
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8 || !bytes[offset + 7] || length !== 8 + 3 * bytes[offset + 7]) fail('JPEG frame');
      hasFrame = true;
    }
    offset = end;
    if (marker === 0xda) {
      if (!hasFrame || length < 6 || length !== 6 + 2 * bytes[end - length + 2]) fail('JPEG scan header');
      if (image.insert < 0) image.insert = start;
      // Walk encoded scan data structurally: FF00 is a sample byte, not a metadata marker.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const next = offset;
        while (bytes[offset] === 0xff) offset++;
        if (offset >= bytes.length) fail('truncated JPEG scan');
        if (bytes[offset] === 0 || (bytes[offset] >= 0xd0 && bytes[offset] <= 0xd7)) { offset++; continue; }
        offset = next;
        break;
      }
    }
  }
  return fail('missing JPEG ending');
}

function parseImage(bytes: Uint8Array) {
  if (bytes[0] === 137) return parsePng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes);
  return fail('unsupported signature');
}

export function readHalloweenProvenance(bytes: Uint8Array): HalloweenImageProvenance | null {
  return parseImage(bytes).metadata;
}

export function embedHalloweenProvenance(bytes: Uint8Array, metadata: HalloweenImageProvenance): Uint8Array {
  const text = encoder.encode(JSON.stringify(validate(metadata)));
  if (text.length > maxText) fail('provenance length');
  const image = parseImage(bytes);
  const payload = new Uint8Array(prefix.length + text.length);
  payload.set(prefix);
  payload.set(text, prefix.length);
  const marker = new Uint8Array(payload.length + (image.format === 'png' ? 12 : 4));
  const view = new DataView(marker.buffer);
  if (image.format === 'png') {
    view.setUint32(0, payload.length);
    marker.set(encoder.encode('tEXt'), 4);
    marker.set(payload, 8);
    view.setUint32(marker.length - 4, crc32(marker.subarray(4, marker.length - 4)));
  } else {
    marker.set([0xff, 0xfe]);
    view.setUint16(2, payload.length + 2);
    marker.set(payload, 4);
  }
  const edits = [...image.remove.map(range => ({ ...range, replacement: new Uint8Array() })), { start: image.insert, end: image.insert, replacement: marker }].sort((a, b) => a.start - b.start);
  const result = new Uint8Array(bytes.length + marker.length - image.remove.reduce((sum, range) => sum + range.end - range.start, 0));
  let input = 0;
  let output = 0;
  for (const edit of edits) {
    result.set(bytes.subarray(input, edit.start), output);
    output += edit.start - input;
    result.set(edit.replacement, output);
    output += edit.replacement.length;
    input = edit.end;
  }
  result.set(bytes.subarray(input), output);
  return result;
}
