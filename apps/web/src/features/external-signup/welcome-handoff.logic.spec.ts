import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readClaimedCompany, rememberClaimedCompany } from './welcome-handoff.logic';

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const claimResult = {
  companyId: 'cmp_1',
  companyName: 'ร้านสมชายค้าส่ง',
  homePath: '/companies/cmp_1/dashboard',
  attachedToExistingUser: false,
};

describe('welcome handoff', () => {
  it('round-trips the claim result', () => {
    const storage = fakeStorage();
    rememberClaimedCompany(claimResult, storage);
    assert.deepEqual(readClaimedCompany(storage), {
      companyName: 'ร้านสมชายค้าส่ง',
      homePath: '/companies/cmp_1/dashboard',
      attachedToExistingUser: false,
    });
  });

  it('reads nothing when the tab never saw the claim', () => {
    assert.equal(readClaimedCompany(fakeStorage()), null);
    assert.equal(readClaimedCompany(fakeStorage({ 'watchdog.signupWelcome': 'not json' })), null);
    assert.equal(readClaimedCompany(fakeStorage({ 'watchdog.signupWelcome': '{"companyName":""}' })), null);
  });

  // The value survives in a store the page itself can write, so the landing path is re-checked.
  it('refuses an off-app landing path but keeps the company name', () => {
    for (const homePath of ['//evil.example', 'https://evil.example', 'companies/x']) {
      const stored = JSON.stringify({ companyName: 'ร้านทดสอบ', homePath });
      const result = readClaimedCompany(fakeStorage({ 'watchdog.signupWelcome': stored }));
      assert.equal(result?.homePath, '/', homePath);
      assert.equal(result?.companyName, 'ร้านทดสอบ', homePath);
    }
  });

  it('still greets the shop when only the name survived', () => {
    const stored = JSON.stringify({ companyName: 'ร้านสมชายค้าส่ง' });
    assert.deepEqual(readClaimedCompany(fakeStorage({ 'watchdog.signupWelcome': stored })), {
      companyName: 'ร้านสมชายค้าส่ง',
      homePath: '/',
      attachedToExistingUser: false,
    });
  });
});
