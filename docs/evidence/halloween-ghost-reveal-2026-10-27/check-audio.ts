// Run from repository root: pnpm exec tsx docs/evidence/halloween-ghost-reveal-2026-10-27/check-audio.ts
import assert from 'node:assert/strict';
import { startHalloweenAudio } from '../../../apps/web/src/features/public-home/home-halloween-audio';
import { startHalloweenRevealAudio } from '../../../apps/web/src/features/public-home/home-halloween-reveal-audio';

const contexts: FakeAudio[] = [];
const page = Object.assign(new EventTarget(), { hidden: false });
class FakeAudio {
  state = 'suspended';
  destination = {};
  buffer = new Float32Array();
  source = { started: false, onended: undefined as (() => void) | undefined, connect() {}, disconnect() {}, start() { this.started = true; } };
  constructor() { contexts.push(this); }
  createBuffer(_channels: number, length: number) {
    this.buffer = new Float32Array(length);
    return { getChannelData: () => this.buffer };
  }
  createGain() { return { gain: { value: 0 }, connect() {} }; }
  createBufferSource() { return this.source; }
  resume() { assert.notEqual(this.state, 'closed'); this.state = 'running'; return Promise.resolve(); }
  suspend() { assert.notEqual(this.state, 'closed'); this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

Object.assign(globalThis, { document: page, window: { AudioContext: FakeAudio } });
function visibility(hidden: boolean) {
  page.hidden = hidden;
  page.dispatchEvent(new Event('visibilitychange'));
}

async function check() {
  const signatures = new Set<string>();
  for (const kind of ['ambience', 'thai', 'western', 'japanese', 'chinese', 'korean', 'secret'] as const) {
    const stop = kind === 'ambience' ? startHalloweenAudio() : startHalloweenRevealAudio(kind);
    await Promise.resolve();
    const audio = contexts.at(-1)!;
    assert.equal(audio.source.started, true);
    visibility(true);
    assert.equal(audio.state, 'suspended');
    visibility(false);
    assert.equal(audio.state, 'running');
    if (kind !== 'ambience') {
      assert.equal(audio.buffer.length, (kind === 'secret' ? 7.5 : 4.5) * 22050);
      let sum = 0;
      let peak = 0;
      for (const sample of audio.buffer) {
        assert.ok(Number.isFinite(sample));
        sum += Math.abs(sample);
        peak = Math.max(peak, Math.abs(sample));
      }
      assert.ok(peak > 0 && peak < .2);
      signatures.add(sum.toFixed(4));
    }
    stop();
    stop();
    visibility(true);
    visibility(false);
    assert.equal(audio.state, 'closed');
  }
  assert.equal(signatures.size, 6);

  visibility(true);
  const stopHidden = startHalloweenAudio();
  await Promise.resolve();
  assert.equal(contexts.at(-1)!.state, 'suspended');
  stopHidden();
  visibility(false);
  const stopEarly = startHalloweenRevealAudio('secret');
  const early = contexts.at(-1)!;
  stopEarly();
  await Promise.resolve();
  assert.equal(early.source.started, false);
  assert.equal(early.state, 'closed');

  const stopEnded = startHalloweenRevealAudio('thai');
  await Promise.resolve();
  const ended = contexts.at(-1)!;
  ended.source.onended?.();
  visibility(true);
  visibility(false);
  assert.equal(ended.state, 'closed');
  stopEnded();
  Object.assign(globalThis, { window: {} });
  startHalloweenAudio()();
  startHalloweenRevealAudio('thai')();
  console.log('PASS: ambience and six reveal stings suspend hidden, resume visible, and close without resurrection.');
  console.log('PASS: initial hidden, stop before resume, natural end, repeated stop, and unsupported audio are safe.');
  console.log('PASS: six finite, distinct reveal waveforms; duration 4.5s/7.5s and peak amplitude below 0.2.');
}
void check();
