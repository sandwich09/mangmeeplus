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

  // UAT 2026-09-06: the intake router typed a multi-line answerText with real newlines, which JSON
  // forbids, and the whole route failed closed as ROUTER_JSON_PARSE_FAILED.
  it('escapes a raw newline/tab inside a string literal so the object parses', () => {
    const raw = 'here: {"intent":"UNSUPPORTED",\n"answerText":"บรรทัดแรก\nบรรทัดสอง\tจบ"}';
    assert.deepEqual(JSON.parse(extractJson(raw)), { intent: 'UNSUPPORTED', answerText: 'บรรทัดแรก\nบรรทัดสอง\tจบ' });
  });

  it('does the same inside a ```json fence and leaves already-escaped sequences alone', () => {
    const fenced = '```json\n{"a":"x\ny","b":"p\\nq","c":"say \\"hi\\"\n"}\n```';
    assert.deepEqual(JSON.parse(extractJson(fenced)), { a: 'x\ny', b: 'p\nq', c: 'say "hi"\n' });
  });

  it('keeps valid JSON byte-identical, newlines between tokens included', () => {
    const valid = '{\n  "a": 1,\n  "b": "two",\n  "c": [true, null]\n}';
    assert.equal(extractJson(`prose ${valid} prose`), valid);
  });

  it('a plain-prose reply that is not JSON still fails to parse', () => {
    assert.throws(() => JSON.parse(extractJson('ขั้นตอนที่ 1: {ถ่ายรูป}\nขั้นตอนที่ 2: "ส่งมา"')));
  });
});
