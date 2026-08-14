import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getInitials, getMangmeeMenuTone, mangmeeToneClass, stripThaiTitlePrefix } from './mangmee-design';

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

  // UAT 2026-08-15: the sidebar greeted a renamed admin as นายมีนา ใจงาม after she had corrected her
  // คำนำหน้า to นางสาว, because the session name is the global User row. Owner decided the shell
  // should not show the title at all.
  it('drops the Thai title prefix so the shell shows the person, not their คำนำหน้า', () => {
    assert.equal(stripThaiTitlePrefix('นายมีนา ใจงาม'), 'มีนา ใจงาม');
    assert.equal(stripThaiTitlePrefix('นางสาวมีนา ใจงาม'), 'มีนา ใจงาม', 'นางสาว must win over นาง');
    assert.equal(stripThaiTitlePrefix('นางสมศรี ดีงาม'), 'สมศรี ดีงาม');
    // Both spellings of the same person now render identically, which is the point: a stale title
    // in the session can no longer be visible.
    assert.equal(stripThaiTitlePrefix('นายมีนา ใจงาม'), stripThaiTitlePrefix('นางสาวมีนา ใจงาม'));
  });

  it('leaves names without a title, and never blanks a name out', () => {
    assert.equal(stripThaiTitlePrefix('มีนา ใจงาม'), 'มีนา ใจงาม');
    assert.equal(stripThaiTitlePrefix('คุณนภา วงศ์ทอง'), 'คุณนภา วงศ์ทอง', 'คุณ is a courtesy the shell already keeps');
    assert.equal(stripThaiTitlePrefix('Jane Doe'), 'Jane Doe');
    assert.equal(stripThaiTitlePrefix('นางสาว'), 'นางสาว', 'a name that is only a title stays readable');
    assert.equal(stripThaiTitlePrefix(''), '');
    assert.equal(stripThaiTitlePrefix(null), '');
  });

  it('gives the shell avatar the same initials as the employee card', () => {
    // The employee card renders มใ from the profile name while the sidebar rendered นใ from the
    // prefixed session name — the same person with two different avatars.
    assert.equal(getInitials(stripThaiTitlePrefix('นายมีนา ใจงาม')), 'มใ');
    assert.equal(getInitials(stripThaiTitlePrefix('นางสาวมีนา ใจงาม')), 'มใ');
  });
});
