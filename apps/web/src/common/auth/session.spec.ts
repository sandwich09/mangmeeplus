import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_STORAGE_KEYS, clearStoredAuthTokens, logoutCurrentSession } from './session';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('web auth session helpers', () => {
  // Tokens now live in httpOnly cookies; localStorage is only scrubbed for legacy keys.
  it('clears every known auth token key', () => {
    const storage = new MemoryStorage();
    for (const key of AUTH_STORAGE_KEYS) {
      storage.setItem(key, `value-${key}`);
    }

    clearStoredAuthTokens(storage);

    for (const key of AUTH_STORAGE_KEYS) {
      assert.equal(storage.getItem(key), null);
    }
  });

  it('stays on the current page when the BFF cannot be reached', async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = (globalThis as Record<string, unknown>).window;
    const storage = new MemoryStorage();
    storage.setItem(AUTH_STORAGE_KEYS[0], 'legacy-token');
    let redirect: string | null = null;
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    (globalThis as Record<string, unknown>).window = {
      localStorage: storage,
      location: { assign: (path: string) => (redirect = path) },
    };

    try {
      assert.equal(await logoutCurrentSession(), false);
      assert.equal(redirect, null);
      assert.equal(storage.getItem(AUTH_STORAGE_KEYS[0]), 'legacy-token');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalWindow === undefined) delete (globalThis as Record<string, unknown>).window;
      else (globalThis as Record<string, unknown>).window = originalWindow;
    }
  });

  it('clears legacy storage and redirects after a successful BFF response', async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = (globalThis as Record<string, unknown>).window;
    const storage = new MemoryStorage();
    storage.setItem(AUTH_STORAGE_KEYS[0], 'legacy-token');
    let redirect: string | null = null;
    globalThis.fetch = async () => new Response(null, { status: 204 });
    (globalThis as Record<string, unknown>).window = {
      localStorage: storage,
      location: { assign: (path: string) => (redirect = path) },
    };

    try {
      assert.equal(await logoutCurrentSession(), true);
      assert.equal(redirect, '/login');
      assert.equal(storage.getItem(AUTH_STORAGE_KEYS[0]), null);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalWindow === undefined) delete (globalThis as Record<string, unknown>).window;
      else (globalThis as Record<string, unknown>).window = originalWindow;
    }
  });
});
