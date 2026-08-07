import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLineText, classifyIntent, chooseAgent, hashMessagePreview, parseLineCompanyCommand } from './line-ai-classifier.logic';

describe('normalizeLineText', () => {
  it('trims and collapses whitespace', () => {
    assert.equal(normalizeLineText('  hello   world  '), 'hello world');
  });
  it('lowercases text', () => {
    assert.equal(normalizeLineText('Hello World'), 'hello world');
  });
});

describe('classifyIntent', () => {
  it('returns mutation_request for Thai mutation keyword', () => {
    assert.equal(classifyIntent('ชำระเงิน'), 'mutation_request');
  });
  it('returns mutation_request for English mutation keyword', () => {
    assert.equal(classifyIntent('please approve this'), 'mutation_request');
  });
  it('returns unsupported_module for accounting keyword', () => {
    assert.equal(classifyIntent('ดูบัญชีบริษัท'), 'unsupported_module');
  });
  it('returns unsupported_module for Thai payroll keyword', () => {
    assert.equal(classifyIntent('เงินเดือนเดือนนี้'), 'unsupported_module');
  });
  it('returns read_detail for inventory keyword', () => {
    assert.equal(classifyIntent('ดูสต็อกสินค้า'), 'read_detail');
  });
  it('returns read_detail for stock keyword in English', () => {
    assert.equal(classifyIntent('check stock balance'), 'read_detail');
  });
  it('returns read_summary for notification keyword', () => {
    assert.equal(classifyIntent('มีแจ้งเตือนอะไรบ้าง'), 'read_summary');
  });
  it('returns read_summary for unknown general query', () => {
    assert.equal(classifyIntent('how is business today'), 'read_summary');
  });
});

describe('chooseAgent', () => {
  it('returns inventory agent for inventory intent', () => {
    assert.equal(chooseAgent('read_detail', 'ดูสต็อก'), 'inventory');
  });
  it('returns notifications agent for alert text', () => {
    assert.equal(chooseAgent('read_summary', 'มีการแจ้งเตือน'), 'notifications');
  });
  it('returns general for mutation_request', () => {
    assert.equal(chooseAgent('mutation_request', 'ชำระเงิน'), 'general');
  });
  it('returns general for unsupported_module', () => {
    assert.equal(chooseAgent('unsupported_module', 'บัญชี'), 'general');
  });
  it('returns general for generic text', () => {
    assert.equal(chooseAgent('read_summary', 'ธุรกิจเป็นยังไงบ้าง'), 'general');
  });
});

describe('hashMessagePreview', () => {
  it('returns 16-char hex string', () => {
    const h = hashMessagePreview('hello world');
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]+$/);
  });
  it('is deterministic', () => {
    assert.equal(hashMessagePreview('same text'), hashMessagePreview('same text'));
  });
  it('differs for different text', () => {
    assert.notEqual(hashMessagePreview('text a'), hashMessagePreview('text b'));
  });
});

describe('parseLineCompanyCommand', () => {
  it('parses the list form', () => {
    assert.deepEqual(parseLineCompanyCommand('/companies'), { kind: 'list' });
    assert.deepEqual(parseLineCompanyCommand(' /company '), { kind: 'list' });
  });
  it('parses the select form with index or id', () => {
    assert.deepEqual(parseLineCompanyCommand('/company 2'), { kind: 'select', value: '2' });
    assert.deepEqual(parseLineCompanyCommand('/company comp-abc'), { kind: 'select', value: 'comp-abc' });
  });
  it('returns null for normal text and non-leading slash', () => {
    assert.equal(parseLineCompanyCommand('ขอรายชื่อลูกค้า'), null);
    assert.equal(parseLineCompanyCommand('ขอ /company 2'), null);
  });
});
