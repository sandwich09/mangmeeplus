import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { t, getDefaultLocale } from './workspace-i18n.logic';

describe('workspace-i18n', () => {
  it('returns Thai string for th locale', () => {
    assert.strictEqual(t('dashboard.title', 'th'), 'แดชบอร์ด');
  });

  it('returns English string for en locale', () => {
    assert.strictEqual(t('dashboard.title', 'en'), 'Dashboard');
  });

  it('getDefaultLocale returns th', () => {
    assert.strictEqual(getDefaultLocale(), 'th');
  });

  it('falls back to key for unknown key (cast as any)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.strictEqual(t('not.a.real.key' as any, 'th'), 'not.a.real.key');
  });
});
