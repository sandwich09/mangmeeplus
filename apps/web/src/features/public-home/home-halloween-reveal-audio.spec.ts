import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareHalloweenRevealAudio } from './home-halloween-reveal-audio';

test('audio unlocks in the click preparation and waits for the server-selected region before playing', async () => {
  const originals = new Map(['window', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let resumes = 0, starts = 0, closes = 0;
  const durations: number[] = [];
  class Audio {
    state = 'running';
    destination = {};
    resume() { resumes++; return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { closes++; this.state = 'closed'; return Promise.resolve(); }
    createBuffer(_channels: number, length: number, rate: number) {
      durations.push(length / rate);
      return { getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() { return { buffer: undefined, onended: undefined, connect() {}, disconnect() {}, start() { starts++; } }; }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: Audio } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false, addEventListener() {}, removeEventListener() {} } });
  try {
    const audio = prepareHalloweenRevealAudio();
    assert.equal(resumes, 1);
    assert.equal(starts, 0);
    assert.deepEqual(durations, []);
    audio.play('secret');
    await Promise.resolve();
    assert.equal(starts, 1);
    assert.deepEqual(durations, [7.5]);
    audio.stop();
    audio.stop();
    assert.equal(closes, 1);
    audio.play('thai');
    assert.equal(starts, 1);
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
