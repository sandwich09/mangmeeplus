import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from '/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus/node_modules/typescript/lib/typescript.js';
import { ResponseComposerAgent } from '/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus/apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts';
import { formatExpenseExplainReply } from '/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus/apps/ai-gateway/src/modules/line-ai/agents/expense-explain-formatter.ts';
import { formatDraftUpdateReply } from '/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus/apps/ai-gateway/src/modules/line-ai/agents/draft-update-formatter.ts';
import { buildDraftUpdatePreviewCard, draftUpdateAppliedReply, draftUpdateBlockedReply, DRAFT_UPDATE_CANCELLED_REPLY } from '/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus/apps/api/src/modules/line-ai/domain/logic/line-draft-update-card.logic.ts';

const repo = '/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus';
const outputDir = '/Users/thawatchai/.codex/visualizations/2026/10/02/01a0fafe-90e8-7493-ab20-40fc97d2e2fb/system-oa-flex-assets';
function source(path) {
  return ts.createSourceFile(path, fs.readFileSync(repo + '/' + path, 'utf8'), ts.ScriptTarget.Latest, true);
}
function literal(path, name) {
  const file = source(path);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, name + ' must exist');
  return JSON.parse(JSON.stringify(vm.runInNewContext('(' + found.getText(file) + ')')));
}
function casualFixture() {
  const file = source('apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.spec.ts');
  let value;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'it'
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === 'uses the warm female employee persona for pure casual conversation') {
      function inner(child) {
        if (ts.isPropertyAssignment(child) && child.name.getText(file) === 'text' && ts.isStringLiteral(child.initializer)) value = child.initializer.text;
        ts.forEachChild(child, inner);
      }
      inner(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(typeof value, 'string');
  return value;
}

const composerSpec = 'apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.spec.ts';
const access = { permissions: literal(composerSpec, 'STAFF'), entitledFeatureKeys: literal(composerSpec, 'EXPENSES_ONLY') };
const composer = new ResponseComposerAgent();
const capability = composer.composeCapabilityHelp('ทำอะไรได้บ้าง', 'th', 'th-TH', access);
const casual = await composer.composeCasual('วันนี้เหนื่อยจัง', { generateText: async () => ({ ok: true, text: casualFixture() }) });
const explainFixture = literal('apps/ai-gateway/src/modules/line-ai/agents/expense-explain-record.spec.ts', 'BHC_EXPLAIN');
const explain = formatExpenseExplainReply(explainFixture);
const draftFixture = literal('apps/api/src/modules/line-ai/domain/logic/line-draft-update-card.logic.spec.ts', 'preview');
const previewText = formatDraftUpdateReply({ found: true, preview: draftFixture });
const card = buildDraftUpdatePreviewCard(draftFixture);
const applied = draftUpdateAppliedReply('https://app.example', 'co-1', 'exp-1', draftFixture);
const ambiguousLine = draftUpdateBlockedReply('ambiguous_line', 'https://app.example', 'co-1');
assert.equal(casual, casualFixture());
assert.match(capability, /ค่าใช้จ่ายและใบเสร็จ/);
assert.doesNotMatch(capability, /สินค้าและสต็อก|ภาษีที่ต้องยื่น/);
assert.match(explain, /1,789\.04/);
assert.match(previewText, /ยังไม่ได้บันทึกอะไรจนกว่าจะกดยืนยัน/);
assert.deepEqual(card.contents.footer.contents.map(button => button.action.label), ['ยืนยัน', 'ยกเลิก']);
assert.match(applied, /แก้ให้แล้วค่ะ: ค่าบริการ 152\.00/);
const result = {
  provenance: 'Current source functions invoked offline with fixtures extracted from repository tests. Not a captured live LINE conversation, no provider/ERP calls, no financial mutation.',
  capability: { fixture: composerSpec, question: 'ทำอะไรได้บ้าง', access, replyText: capability },
  casual: { fixture: composerSpec, question: 'วันนี้เหนื่อยจัง', replyText: casual },
  explain: { fixture: 'apps/ai-gateway/src/modules/line-ai/agents/expense-explain-record.spec.ts', question: literal('apps/ai-gateway/src/modules/line-ai/agents/expense-explain-record.spec.ts', 'E4_MESSAGE'), replyText: explain },
  command: { fixture: 'apps/api/src/modules/line-ai/domain/logic/line-draft-update-card.logic.spec.ts', preview: draftFixture, previewText, card, appliedText: applied, cancelledText: DRAFT_UPDATE_CANCELLED_REPLY, ambiguousLineText: ambiguousLine },
};
fs.writeFileSync(outputDir + '/source-answer-examples.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ verification: 'PASS', capability, casual, explain, previewText, applied, cancelled: DRAFT_UPDATE_CANCELLED_REPLY, ambiguousLine }, null, 2));
