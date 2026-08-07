import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildImagePdf } from './image-pdf.logic';

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const decode = (pdf: Uint8Array): string => Buffer.from(pdf).toString('latin1');

describe('buildImagePdf', () => {
  it('writes a structurally valid one-page PDF', () => {
    const text = decode(buildImagePdf({ jpeg, pixelWidth: 850, pixelHeight: 1202 }));
    assert.ok(text.startsWith('%PDF-1.4\n'), 'has the PDF header');
    assert.ok(text.endsWith('%%EOF\n'), 'has the EOF marker');
    assert.match(text, /\/Type \/Catalog/);
    assert.match(text, /\/Count 1/);
    assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
    assert.match(text, /\/Filter \/DCTDecode/);
  });

  it('points every xref entry at the object it claims', () => {
    // A wrong offset is exactly the bug a reader reports as "damaged file", and it is invisible
    // in a rendered preview — so assert the table against the bytes it indexes.
    const text = decode(buildImagePdf({ jpeg, pixelWidth: 850, pixelHeight: 1202 }));
    const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    assert.ok(text.startsWith('xref\n', startxref), 'startxref points at the table');
    // lines: 'xref', '0 6', the free entry, then one entry per object
    const lines = text.slice(startxref).split('\n');
    assert.equal(lines[1], '0 6', 'the table covers the free entry plus five objects');
    assert.equal(lines[2], '0000000000 65535 f ', 'object 0 is the free entry');
    const entries = lines.slice(3, 8);
    assert.equal(entries.length, 5);
    entries.forEach((entry, index) => {
      assert.equal(entry.length, 19, 'each entry is a fixed 20-byte record');
      assert.ok(text.startsWith(`${index + 1} 0 obj`, Number(entry.slice(0, 10))), `object ${index + 1} lives at its xref offset`);
    });
  });

  it('declares the real stream lengths', () => {
    const pdf = buildImagePdf({ jpeg, pixelWidth: 100, pixelHeight: 100 });
    const text = decode(pdf);
    assert.match(text, new RegExp(`/Filter /DCTDecode /Length ${jpeg.length} >>`));
    const contentLength = Number(/<< \/Length (\d+) >>\nstream\nq /.exec(text)?.[1]);
    const content = /stream\n(q [^\n]+)\n/.exec(text.slice(text.indexOf('/Contents')))?.[1] ?? '';
    assert.equal(contentLength, content.length + 1, 'content /Length counts the drawing operator plus its newline');
  });

  it('fits the image inside the page margins and keeps its aspect ratio', () => {
    const portrait = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/.exec(decode(buildImagePdf({ jpeg, pixelWidth: 850, pixelHeight: 1202 })));
    const [width, height, left, bottom] = (portrait ?? []).slice(1).map(Number);
    assert.ok(width! <= 595.28 - 48 + 0.01 && height! <= 841.89 - 48 + 0.01, 'stays inside the margins');
    assert.ok(Math.abs(width! / height! - 850 / 1202) < 0.001, 'keeps the source aspect ratio');
    assert.ok(Math.abs((595.28 - width! - left! * 2)) < 0.01, 'is centred horizontally');
    assert.ok(Math.abs((841.89 - height! - bottom! * 2)) < 0.01, 'is centred vertically');

    // A wide document must be bounded by the page width, not the height.
    const landscape = /q ([\d.]+) 0 0 ([\d.]+) /.exec(decode(buildImagePdf({ jpeg, pixelWidth: 2000, pixelHeight: 500 })));
    assert.ok(Math.abs(Number(landscape?.[1]) - (595.28 - 48)) < 0.01, 'wide image fills the usable width');
  });

  it('refuses input it cannot draw', () => {
    assert.throws(() => buildImagePdf({ jpeg: new Uint8Array(), pixelWidth: 10, pixelHeight: 10 }), /empty image/);
    assert.throws(() => buildImagePdf({ jpeg, pixelWidth: 0, pixelHeight: 10 }), /no size/);
  });
});
