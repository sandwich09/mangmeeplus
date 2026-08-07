import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getInitials, getMangmeeMenuTone, mangmeeToneClass } from './mangmee-design';

describe('mangmee design helpers', () => {
  it('maps known workspace modules to the reference icon tone', () => {
    assert.equal(getMangmeeMenuTone('dashboard', 'main'), 'brand');
    assert.equal(getMangmeeMenuTone('inbox', 'main'), 'line');
    assert.equal(getMangmeeMenuTone('sales', 'operate'), 'rose');
    assert.equal(getMangmeeMenuTone('reports', 'finance'), 'indigo');
  });

  it('falls back from unknown keys to the nav group tone', () => {
    assert.equal(getMangmeeMenuTone('custom-finance-report', 'finance'), 'amber');
    assert.equal(getMangmeeMenuTone('custom-main-tool', 'main'), 'brand');
  });

  it('has icon and badge classes for every tone used by the shell', () => {
    for (const tone of ['brand', 'line', 'rose', 'sky', 'cyan', 'amber', 'lime', 'teal', 'indigo', 'purple', 'slate', 'danger'] as const) {
      assert.match(mangmeeToneClass[tone].icon, /^mangmee-icon-tone-/);
      assert.match(mangmeeToneClass[tone].badge, /^mangmee-badge-/);
    }
  });

  it('derives compact Thai initials for rounded avatars', () => {
    assert.equal(getInitials('คุณนภา วงศ์ทอง'), 'นว');
    assert.equal(getInitials('บัญชี'), 'บั');
    assert.equal(getInitials(''), '?');
  });
});
