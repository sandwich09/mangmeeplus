import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(await readFile(resolve(root, 'scripts/line-oa/rich-menu-v2-ver2.manifest.json'), 'utf8'));
const imagePath = resolve(root, manifest.image.path);

describe('LINE Rich Menu V2 Ver2 manifest', () => {
  // The Owner-approved bitmap arrives as a design export; until it is committed the manifest
  // carries null checksums and this case only pins the contract that the checksums MUST be
  // recorded together with the file — a present file with null metadata fails loudly.
  it('binds the opaque 2500x1686 PNG once the bitmap is committed', async () => {
    if (!existsSync(imagePath)) {
      assert.equal(manifest.image.sha256, null, 'no bitmap yet — checksum must stay null');
      assert.equal(manifest.image.byteSize, null, 'no bitmap yet — byteSize must stay null');
      return;
    }
    const image = await readFile(imagePath);
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(image.readUInt32BE(16), 2500);
    assert.equal(image.readUInt32BE(20), 1686);
    assert.ok([0, 2, 3].includes(image[25]), `PNG color type ${image[25]} must not contain alpha`);
    assert.ok(image.byteLength < 1_000_000);
    assert.equal(image.byteLength, manifest.image.byteSize);
    assert.equal(createHash('sha256').update(image).digest('hex'), manifest.image.sha256);
  });

  it('covers the canvas exactly once with the six approved ver2 actions', () => {
    const { width, height } = manifest.lineRichMenu.size;
    const areas = manifest.lineRichMenu.areas;
    assert.equal(manifest.profileId, 'line-rich-menu-v2-ver2');
    assert.equal(manifest.rollbackProfileId, 'line-rich-menu-v2-ver1');
    assert.equal(areas.length, 6);
    assert.equal(areas.reduce((sum, { bounds }) => sum + bounds.width * bounds.height, 0), width * height);
    for (const [index, { bounds }] of areas.entries()) {
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.width > 0 && bounds.height > 0);
      assert.ok(bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);
      for (const { bounds: other } of areas.slice(index + 1)) {
        const overlaps = bounds.x < other.x + other.width && bounds.x + bounds.width > other.x
          && bounds.y < other.y + other.height && bounds.y + bounds.height > other.y;
        assert.equal(overlaps, false);
      }
    }
    assert.deepEqual(areas.map(({ action }) => action), [
      // Ver2 changes vs ver1: the free-signup URI tile becomes the Promotion tile (backend
      // `staff_menu_promotion` answers with the package poster card), and ถ่ายใบเสร็จ opens the
      // LINE camera DIRECTLY via the URI scheme — no bot round-trip, no attach/camera submenu.
      { type: 'message', label: 'Promotion Package', text: 'โปรโมชั่น' },
      { type: 'message', label: 'บริษัทของฉัน', text: '/companies' },
      { type: 'uri', label: 'ถ่ายใบเสร็จ', uri: 'https://line.me/R/nv/camera/' },
      { type: 'postback', label: 'คุยกับน้องมั่งมี', data: 'action=line-rich-talk', inputOption: 'openKeyboard' },
      { type: 'message', label: 'สรุปค่าใช้จ่าย', text: 'ดูค่าใช้จ่ายเดือนนี้' },
      { type: 'message', label: 'ติดต่อเรา', text: 'ติดต่อเรา' },
    ]);
  });
});
