/**
 * The owner's decision of 2026-09-19, as a guard (contract appendix §25).
 *
 * "หน้าจอใช้ยาก … ห้ามเปลี่ยนหรือเพิ่มหน้าจอ": the capture-group screens are deleted, and this spec
 * exists so they cannot come back one import at a time. A typecheck catches a reference to a file
 * that is gone; nothing catches a NEW page at the same route, a new fetch to a group endpoint, or a
 * dictionary key growing back — which is exactly how a withdrawn surface reappears.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { workspaceDictionary } from '../../common/i18n/workspace-dictionary';

const WEB_ROOT = new URL('../../../', import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.spec\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const sources = walk(`${WEB_ROOT}app`).concat(walk(`${WEB_ROOT}src`));

describe('the capture-group screens stay withdrawn (appendix §25)', () => {
  it('has no route, page or component for a capture group', () => {
    const offenders = sources.filter((file) => /expenses\/capture(\/|$)/.test(file.replace(WEB_ROOT, ''))
      || /features\/expenses\/capture\//.test(file));
    assert.deepEqual(offenders.map((file) => file.replace(WEB_ROOT, '')), []);
  });

  it('never builds a link to a group page, on any surface', () => {
    const offenders = sources.filter((file) => readFileSync(file, 'utf8').includes('/expenses/capture/'));
    assert.deepEqual(offenders.map((file) => file.replace(WEB_ROOT, '')), []);
  });

  /**
   * The capability and the per-expense read status are the ONLY two capture reads the web still
   * makes. Everything else on the group aggregate stays on the server, permission-checked, with no
   * client that can call it.
   */
  it('calls no capture-group endpoint', () => {
    const allowed = ['expenses/capture-capability', 'expenses/capture-policy'];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.match(/expenses\/capture[a-z-]*/g) ?? []) {
        assert.ok(
          allowed.some((suffix) => suffix.endsWith(match.split('/').pop()!)),
          `${file.replace(WEB_ROOT, '')} still reaches ${match}`,
        );
      }
      assert.equal(text.includes('capture-groups'), false, `${file.replace(WEB_ROOT, '')} still reaches a group route`);
    }
  });

  it('keeps only the capture copy the surviving screens use, in both locales', () => {
    const th = Object.keys(workspaceDictionary.th).filter((key) => key.startsWith('expenses.capture.'));
    const en = Object.keys(workspaceDictionary.en).filter((key) => key.startsWith('expenses.capture.'));
    assert.deepEqual(th.sort(), en.sort(), 'th and en keep parity');
    const used = new Set<string>();
    for (const file of sources) {
      for (const match of readFileSync(file, 'utf8').match(/expenses\.capture\.[a-z_0-9]+/g) ?? []) used.add(match);
    }
    // Every surviving key is rendered by something, and nothing renders a key that is gone.
    assert.deepEqual(th.filter((key) => !used.has(key)), [], 'a key nothing renders is dead copy');
    assert.deepEqual([...used].filter((key) => !th.includes(key)), [], 'a rendered key must exist');
  });

  it('says what the engine created, and never offers to split by hand', () => {
    assert.match(workspaceDictionary.th['expenses.capture.auto_split']!, /พบเอกสาร \{count\} ใบในไฟล์นี้ — สร้างรายการเพิ่มให้แล้ว/);
    for (const locale of ['th', 'en'] as const) {
      for (const [key, value] of Object.entries(workspaceDictionary[locale])) {
        if (!key.startsWith('expenses.capture.')) continue;
        assert.doesNotMatch(value, /กลุ่มหลักฐาน|งานรับหลักฐาน|evidence group|evidence job/i, `${locale}.${key} still names the withdrawn screen`);
      }
    }
  });
});
