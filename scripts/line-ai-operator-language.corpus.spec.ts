import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_AI_ALL_OPERATOR_CASES, LINE_AI_OPERATOR_AVAILABILITY_CORPUS, LINE_AI_OPERATOR_LANGUAGE_CORPUS, OPERATOR_LANGUAGE_CATEGORY_MINIMUMS } from './line-ai-operator-language.corpus';

describe('LINE AI operator-language corpus', () => {
  it('keeps at least 220 reviewable cases with stable expectations and category coverage', () => {
    assert.ok(LINE_AI_OPERATOR_LANGUAGE_CORPUS.length >= 220);
    assert.equal(new Set(LINE_AI_OPERATOR_LANGUAGE_CORPUS.map(({ id }) => id)).size, LINE_AI_OPERATOR_LANGUAGE_CORPUS.length);
    for (const testCase of LINE_AI_OPERATOR_LANGUAGE_CORPUS) {
      assert.ok(testCase.message.trim(), `${testCase.id} needs a message`);
      assert.ok(testCase.expectedTools.length > 0, `${testCase.id} needs expectedTools`);
      assert.equal(new Set(testCase.expectedTools).size, testCase.expectedTools.length, `${testCase.id} repeats expectedTools`);
      assert.ok(testCase.expectedTools.every((tool) => !testCase.forbiddenTools.includes(tool)), `${testCase.id} expects and forbids the same tool`);
    }
    for (const [category, minimum] of Object.entries(OPERATOR_LANGUAGE_CATEGORY_MINIMUMS)) {
      const count = LINE_AI_OPERATOR_LANGUAGE_CORPUS.filter((testCase) => testCase.category === category).length;
      assert.ok(count >= minimum, `${category} has ${count}; expected at least ${minimum}`);
    }
  });

  it('adds at least 128 unique full-flow availability cases with noisy owner language', () => {
    assert.ok(LINE_AI_OPERATOR_AVAILABILITY_CORPUS.length >= 128);
    assert.ok(LINE_AI_OPERATOR_AVAILABILITY_CORPUS.filter(({ noisy }) => noisy).length >= 40);
    assert.equal(new Set(LINE_AI_ALL_OPERATOR_CASES.map(({ id }) => id)).size, LINE_AI_ALL_OPERATOR_CASES.length);
    assert.equal(new Set(LINE_AI_OPERATOR_AVAILABILITY_CORPUS.map(({ message }) => message)).size, LINE_AI_OPERATOR_AVAILABILITY_CORPUS.length);
    for (const testCase of LINE_AI_OPERATOR_AVAILABILITY_CORPUS) {
      assert.ok(testCase.requiredReplyIncludes.every((text) => text.length > 0), `${testCase.id} has an empty copy assertion`);
      assert.ok(testCase.expectedInvokedTools.every((tool) => !testCase.forbiddenTools.includes(tool)), `${testCase.id} invokes a forbidden tool`);
    }
  });
});
