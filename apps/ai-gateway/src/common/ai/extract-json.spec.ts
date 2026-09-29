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

  // tuning-6a (E1a, run 5 malformedRouter — "ใบเสร็จต้องเก็บไว้กี่ปีอ่ะคะ", real raw output): the
  // model closed its object one brace early (`…"answerText":"…"}}`) and then kept writing a
  // trailing sibling field (`,"resolvedClarificationIds":[]}`) — the legacy slice-to-LAST-'}'
  // swallowed that trailing junk as part of the "object" and the whole thing failed to parse. Both
  // router attempts failed this exact way and the customer waited 16s for a generic "ไม่แน่ใจ" reply.
  it('E1a real sample: recovers the object when it closes one brace early and keeps writing a trailing field', () => {
    const raw = "{\"intent\":\"ADVISOR_CONVERSATION\",\"language\":\"th\",\"confidence\":0.82,\"semanticOutcome\":\"AMBIGUOUS\",\"fundingSource\":\"UNKNOWN\",\"decisionV1\":{\"subrequests\":[{\"kind\":\"general\",\"goal\":\"ใบเสร็จต้องเก็บไว้กี่ปีตามกฎหมาย\",\"sources\":[{\"part\":0,\"whole\":true}],\"filters\":{}}]},\"advisorAnswer\":{\"version\":1,\"mode\":\"SOCIAL_CHAT\",\"confidence\":0.82,\"needsTools\":false,\"answerText\":\"โดยทั่วไปตามกฎหมายไทย เอกสารทางการเงิน เช่น ใบเสร็จรับเงิน ใบกำกับภาษี ต้องเก็บไว้อย่างน้อย 5 ปี นับจากวันที่ออกเอกสาร ค่ะ\\nหากธุรกิจอยู่ภายใต้ภาษีมูลค่าเพิ่ม (VAT) สรรพากรอาจขอตรวจย้อนหลังได้ถึง 5 ปี ดังนั้นเก็บไว้ครบ 5 ปีถือว่าปลอดภัยนะคะ 😊\"}},\"resolvedClarificationIds\":[]}";
    const parsed = JSON.parse(extractJson(raw)) as { advisorAnswer?: { answerText?: string } };
    assert.match(parsed.advisorAnswer?.answerText ?? '', /อย่างน้อย 5 ปี/);
  });

  // tuning-6a (E1b, run 5 malformedRouter — "หัก ณ ที่จ่ายคืออะไรครับ", real raw output): the model
  // typed a literal '"' as a Thai-style quotation mark inside the answerText string instead of
  // escaping it (`ผู้รับจะได้รับ "ใบรับรองการหัก ณ ที่จ่าย" ไว้เป็นหลักฐาน…`), which a naive scan
  // reads as the string closing early.
  it('E1b real sample: recovers the object when a string value contains an unescaped literal quote', () => {
    const raw = "{\"intent\":\"ADVISOR_CONVERSATION\",\"language\":\"th\",\"confidence\":0.92,\"semanticOutcome\":\"AMBIGUOUS\",\"fundingSource\":\"UNKNOWN\",\"decisionV1\":{\"subrequests\":[{\"kind\":\"general\",\"goal\":\"อธิบายความหมายของหัก ณ ที่จ่าย\",\"sources\":[{\"part\":0,\"whole\":true}],\"filters\":{}}]},\"advisorAnswer\":{\"version\":1,\"mode\":\"SOCIAL_CHAT\",\"confidence\":0.88,\"needsTools\":false,\"answerText\":\"หัก ณ ที่จ่าย (Withholding Tax) คือภาษีที่ผู้จ่ายเงินมีหน้าที่หักออกจากยอดที่จ่ายให้ผู้รับ แล้วนำส่งกรมสรรพากรแทนค่ะ เช่น จ้างฟรีแลนซ์ 10,000 บาท อัตรา 3% → จ่ายจริง 9,700 บาท ส่วน 300 บาทถูกนำส่งสรรพากรแทนผู้รับ ผู้รับจะได้รับ \"ใบรับรองการหัก ณ ที่จ่าย\" ไว้เป็นหลักฐานเพื่อใช้ขอเครดิตภาษีตอนยื่นแบบประจำปีค่ะ\"}}";
    const parsed = JSON.parse(extractJson(raw)) as { advisorAnswer?: { answerText?: string } };
    assert.match(parsed.advisorAnswer?.answerText ?? '', /ใบรับรองการหัก ณ ที่จ่าย/);
  });
  it('NAT06 real sample: a fullwidth comma between array elements is the separator it meant', () => {
    const raw = '{"pages":[{"page":1,"evidence":[]}，{"page":2,"text":"หน้า ๒，ยังอ่านได้"}]}';
    assert.deepEqual(JSON.parse(extractJson(raw)), { pages: [{ page: 1, evidence: [] }, { page: 2, text: 'หน้า ๒，ยังอ่านได้' }] });
  });
});
