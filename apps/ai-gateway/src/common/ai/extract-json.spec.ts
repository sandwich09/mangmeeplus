import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from './extract-json';

describe('extractJson', () => {
  it('returns the object from a ```json fence', () => {
    assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  });

  it('returns the object from a bare ``` fence', () => {
    assert.equal(extractJson('```\n{"a":1}\n```'), '{"a":1}');
  });

  it('slices first-brace to last-brace when prose surrounds the object', () => {
    assert.equal(extractJson('here you go: {"a":1} thanks'), '{"a":1}');
  });

  it('returns the original text unchanged when there is no object', () => {
    assert.equal(extractJson('no json here'), 'no json here');
  });
});
