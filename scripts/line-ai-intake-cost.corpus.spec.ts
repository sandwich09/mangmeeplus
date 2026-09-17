/**
 * Integrity spec for the frozen intake-cost corpus (spec §10.1 "ก่อน optimize ให้ freeze corpus
 * manifest, expected route/fields/permissions, baseline revision และจำนวน repetitions เดียวกัน").
 *
 * It does not call a provider. It proves the manifest is well formed, covers every case §10.1 names,
 * carries no realistic personal identifier, and still hashes to the value pinned below — so a
 * baseline run and an after-run can never be compared across two different corpora.
 *
 * Run: pnpm exec tsx --test scripts/line-ai-intake-cost.corpus.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asIntakeRouteIntent } from '@watchdog-bms/contracts';
import {
  INTAKE_COST_CAPTURE_INTENTS,
  INTAKE_COST_COVERAGE,
  LINE_AI_INTAKE_COST_CORPUS,
  intakeCostCorpusHash,
  intakeCostPermissionAllowed,
  type IntakeCostTask,
} from './line-ai-intake-cost.corpus';

/** The frozen hash. Changing the corpus REQUIRES updating this line in the same commit, which is
 *  exactly the review signal we want: a silent drift between baseline and after-run is impossible. */
const FROZEN_CORPUS_SHA256: string = 'cf9bce443b3012ef39a081670614b8651fa55483aa34043376978d4b13becce2';

/** Thai 13-digit national/tax id check digit: weights 13..2, remainder from 11, last digit (11-r)%10. */
function passesThaiIdChecksum(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

/** Every string this manifest would ever put in front of a model or a person. */
function allText(task: IntakeCostTask): string[] {
  return [
    task.id,
    task.messageText,
    ...(task.activeCategories ?? []).flatMap((c) => [c.id, c.name]),
    ...(task.conversationContext?.recentTurns ?? []).flatMap((t) => [t.userMessagePreview ?? '', t.assistantReplyPreview ?? '']),
    ...(task.openClarifications ?? []).flatMap((c) => [c.id, c.question, c.text, ...(c.candidateExpenseIds ?? [])]),
    ...(task.recentCapturedExpenses ?? []).flatMap((c) => [c.id, c.label]),
    ...(task.activeExpenseDrafts ?? []).flatMap((d) => [d.expenseId, d.label, ...d.questions.map((q) => q.prompt)]),
    ...(task.image?.lines ?? []).map((l) => l.text),
  ];
}

const TEXT_TASKS = LINE_AI_INTAKE_COST_CORPUS.filter((t) => t.kind === 'text');
const IMAGE_TASKS = LINE_AI_INTAKE_COST_CORPUS.filter((t) => t.kind === 'image');

describe('LINE intake cost corpus — manifest integrity', () => {
  it('has unique ids and the sizes spec §10.1 asks for', () => {
    const ids = LINE_AI_INTAKE_COST_CORPUS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate task id');
    assert.ok(TEXT_TASKS.length >= 24 && TEXT_TASKS.length <= 32, `text tasks out of range: ${TEXT_TASKS.length}`);
    assert.ok(IMAGE_TASKS.length >= 8 && IMAGE_TASKS.length <= 10, `image tasks out of range: ${IMAGE_TASKS.length}`);
  });

  it('covers every §10.1 category', () => {
    const seen = new Set(LINE_AI_INTAKE_COST_CORPUS.map((t) => t.coverage));
    for (const coverage of INTAKE_COST_COVERAGE) {
      assert.ok(seen.has(coverage), `corpus is missing coverage: ${coverage}`);
    }
  });

  it('gives every task a mechanical expectation', () => {
    for (const task of LINE_AI_INTAKE_COST_CORPUS) {
      assert.ok(task.expect.intents.length > 0, `${task.id}: no expected intent`);
      for (const intent of task.expect.intents) {
        assert.ok(asIntakeRouteIntent(intent), `${task.id}: ${intent} is not a contract intake intent`);
      }
      assert.equal(new Set(task.expect.intents).size, task.expect.intents.length, `${task.id}: duplicate expected intent`);
      // More than one allowed route must say WHY the contract permits both.
      if (task.expect.intents.length > 1) {
        assert.ok((task.expect.alternativesWhy ?? '').length > 40, `${task.id}: alternatives need a contract reason`);
      }
      assert.ok(task.permissions.length > 0, `${task.id}: permissions must be explicit`);
      assert.equal(
        task.expect.permissionOutcome === 'allowed',
        intakeCostPermissionAllowed(task),
        `${task.id}: permissionOutcome disagrees with the permission keys`,
      );
    }
  });

  it('keeps forbid-capture rows away from every expense-writing route', () => {
    for (const task of LINE_AI_INTAKE_COST_CORPUS.filter((t) => t.expect.forbidCapture)) {
      for (const intent of task.expect.intents) {
        assert.ok(!INTAKE_COST_CAPTURE_INTENTS.includes(intent), `${task.id}: ${intent} would capture`);
      }
    }
    // The bare-number-after-expiry row is the one §10.1 names explicitly; keep it honest.
    const expired = LINE_AI_INTAKE_COST_CORPUS.find((t) => t.coverage === 'expired_context');
    assert.ok(expired, 'no expired-context row');
    assert.equal(expired.expect.forbidCapture, true);
    assert.equal(expired.conversationContext, undefined, 'an expired context row must carry no context');
    assert.equal(expired.recentCapturedExpenses, undefined);
    assert.equal(expired.activeExpenseDrafts, undefined);
    assert.equal(expired.openClarifications, undefined);
  });

  it('pairs image rows with a renderable, deterministic page spec', () => {
    for (const task of TEXT_TASKS) assert.equal(task.image, undefined, `${task.id}: text row must carry no image`);
    for (const task of IMAGE_TASKS) {
      const image = task.image;
      assert.ok(image, `${task.id}: image row without a spec`);
      assert.ok(image.widthPx > 0 && image.heightPx > 0, `${task.id}: bad page size`);
      assert.ok(['jpeg', 'png'].includes(image.format), `${task.id}: bad format`);
      let previousY = 0;
      for (const line of image.lines) {
        assert.ok(line.y >= previousY, `${task.id}: line y values must ascend (${line.y} after ${previousY})`);
        assert.ok(line.y <= image.heightPx, `${task.id}: line at ${line.y} falls off a ${image.heightPx}px page`);
        previousY = line.y;
      }
      assert.ok(image.lines.length > 0 || (image.shapes?.length ?? 0) > 0, `${task.id}: empty page`);
    }
  });

  it('keeps receipt field expectations on receipt rows only, with parsable values', () => {
    for (const task of LINE_AI_INTAKE_COST_CORPUS) {
      const receipt = task.expect.receipt;
      if (!receipt) continue;
      assert.equal(task.kind, 'image', `${task.id}: receipt expectations belong to image rows`);
      assert.match(receipt.grandTotalAmount, /^\d+\.\d{2}$/, `${task.id}: total must be a plain decimal`);
      if (receipt.vatAmount) assert.match(receipt.vatAmount, /^\d+\.\d{2}$/, `${task.id}: vat must be a plain decimal`);
      assert.match(receipt.expenseDate, /^\d{4}-\d{2}-\d{2}$/, `${task.id}: date must be ISO`);
      assert.ok(receipt.vendorNameContains.length >= 4, `${task.id}: vendor fragment too short to be meaningful`);
      // A printed VAT amount is only expected when the page actually prints one.
      const pageText = (task.image?.lines ?? []).map((l) => l.text).join('\n');
      if (receipt.vatAmount) assert.match(pageText, /ภาษีมูลค่าเพิ่ม/u, `${task.id}: vat expected but never printed`);
    }
  });

  it('contains no realistic personal identifier', () => {
    for (const task of LINE_AI_INTAKE_COST_CORPUS) {
      for (const text of allText(task)) {
        for (const match of text.matchAll(/\d{13}/g)) {
          assert.ok(!passesThaiIdChecksum(match[0]), `${task.id}: "${match[0]}" passes the Thai id checksum`);
        }
        assert.ok(!/U[0-9a-f]{32}/.test(text), `${task.id}: looks like a LINE user id`);
        // Thai mobile/landline shapes, with or without separators.
        assert.ok(!/(?<!\d)0[689]\d[- ]?\d{3}[- ]?\d{4}(?!\d)/.test(text), `${task.id}: looks like a Thai mobile number`);
        assert.ok(!/(?<!\d)0[23457][- ]?\d{3}[- ]?\d{4}(?!\d)/.test(text), `${task.id}: looks like a Thai landline number`);
        assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(text), `${task.id}: looks like an email address`);
      }
    }
  });

  it('is frozen: the content hash still matches the pinned value', () => {
    const actual = intakeCostCorpusHash();
    if (FROZEN_CORPUS_SHA256 === '__PENDING__') {
      assert.fail(`corpus hash is unpinned; set FROZEN_CORPUS_SHA256 to ${actual}`);
    }
    assert.equal(actual, FROZEN_CORPUS_SHA256, 'corpus changed — update the pin in the same commit');
  });
});
