import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUGGESTION_TABS,
  aiActionLabel,
  aiActionStatusLabel,
  aiDraftPayloadSummary,
  aiNeedsDataReason,
  aiRiskLabel,
  aiSuggestionSummaryText,
  aiSuggestionStatusLabel,
  aiValidationResultLabel,
  aiVisibleDetailSummary,
  canCreateSourceDraft,
  filterSuggestionsForTab,
  formatConfidencePct,
} from './ai-suggestions.logic';

const items = [
  { id: 'a', needsData: false },
  { id: 'b', needsData: true },
  { id: 'c', needsData: false },
];

describe('filterSuggestionsForTab', () => {
  it('the New tab excludes needs-data items', () => {
    const tab = SUGGESTION_TABS.find((t) => t.key === 'new')!;
    assert.deepEqual(filterSuggestionsForTab(items, tab).map((i) => i.id), ['a', 'c']);
  });
  it('the Needs data tab keeps only needs-data items', () => {
    const tab = SUGGESTION_TABS.find((t) => t.key === 'needs_data')!;
    assert.deepEqual(filterSuggestionsForTab(items, tab).map((i) => i.id), ['b']);
  });
  it('other tabs pass items through', () => {
    const tab = SUGGESTION_TABS.find((t) => t.key === 'dismissed')!;
    assert.equal(filterSuggestionsForTab(items, tab).length, 3);
  });
});

describe('formatConfidencePct', () => {
  it('formats a 0..1 confidence as a percent', () => {
    assert.equal(formatConfidencePct(0.65), '65%');
    assert.equal(formatConfidencePct(undefined), '0%');
  });
});

describe('human-readable AI labels', () => {
  it('does not expose internal action, status, and risk codes as the primary copy', () => {
    assert.equal(aiActionLabel('CREATE_REVIEW_CHECKLIST'), 'สร้างเช็กลิสต์สำหรับตรวจสอบ');
    assert.equal(aiActionStatusLabel('PROPOSED'), 'รอตรวจสอบ');
    assert.equal(aiSuggestionStatusLabel('NEW'), 'ใหม่');
    assert.equal(aiRiskLabel('MEDIUM'), 'ควรตรวจสอบ');
  });

  it('explains the no-citation safety downgrade in plain Thai', () => {
    assert.equal(
      aiNeedsDataReason('Recommendation has no source citations; downgraded to needs-data'),
      'ยังไม่มีข้อมูลอ้างอิงเพียงพอ ระบบจึงเก็บไว้ให้ตรวจสอบโดยไม่สร้างร่างอัตโนมัติ',
    );
    assert.equal(aiNeedsDataReason('unexpected-provider-detail'), 'ระบบยังมีข้อมูลไม่พอ กรุณาตรวจสอบข้อมูลต้นทางก่อนดำเนินการต่อ');
    assert.equal(
      aiNeedsDataReason('Operational CRM customer fields are not permitted for this role'),
      'บัญชีนี้ยังไม่มีสิทธิ์ดูข้อมูลลูกค้าที่จำเป็น',
    );
  });

  it('extracts a checklist without assuming every draft payload has that shape', () => {
    assert.deepEqual(aiDraftPayloadSummary({ title: 'ตรวจรายการ', items: ['ข้อหนึ่ง', 2, 'ข้อสอง'], customerId: 'hidden', unknown: true }), {
      title: 'ตรวจรายการ',
      items: ['ข้อหนึ่ง', 'ข้อสอง'],
    });
    assert.deepEqual(aiDraftPayloadSummary(null), { items: [] });
  });

  it('keeps useful AI-authored summaries but removes duplicated technical needs-data copy', () => {
    const reason = 'Recommendation has no source citations; downgraded to needs-data';
    assert.equal(aiSuggestionSummaryText(reason, true), 'ยังไม่มีข้อมูลอ้างอิงเพียงพอ ระบบจึงเก็บไว้ให้ตรวจสอบโดยไม่สร้างร่างอัตโนมัติ');
    assert.equal(aiSuggestionSummaryText('สรุปที่อ่านง่าย', true), 'สรุปที่อ่านง่าย');
    assert.equal(aiSuggestionSummaryText('unexpected-provider-detail', true), 'ระบบยังมีข้อมูลไม่พอ กรุณาตรวจสอบข้อมูลต้นทางก่อนดำเนินการต่อ');
    assert.equal(aiVisibleDetailSummary(reason, [reason]), undefined);
    assert.equal(aiVisibleDetailSummary('สรุปที่อ่านง่าย', [reason]), 'สรุปที่อ่านง่าย');
  });

  it('summarizes validation without exposing its raw object', () => {
    assert.equal(aiValidationResultLabel({ ok: true, editableFields: ['title'] }), 'ข้อมูลพร้อมสำหรับสร้างร่าง');
    assert.equal(aiValidationResultLabel({ ok: false, errors: ['customerId'] }), 'ยังมีข้อมูลที่ต้องแก้ไขก่อนสร้างร่าง');
    assert.equal(aiValidationResultLabel(undefined), undefined);
  });
});

describe('canCreateSourceDraft', () => {
  it('allows creation for an actionable suggestion with a real action', () => {
    assert.equal(canCreateSourceDraft('NEW', 'CREATE_CRM_FOLLOW_UP_DRAFT', 'PROPOSED'), true);
  });
  it('blocks NO_SOURCE_DRAFT_AVAILABLE and already-created actions', () => {
    assert.equal(canCreateSourceDraft('NEW', 'NO_SOURCE_DRAFT_AVAILABLE', 'PROPOSED'), false);
    assert.equal(canCreateSourceDraft('NEW', 'CREATE_CRM_FOLLOW_UP_DRAFT', 'SOURCE_DRAFT_CREATED'), false);
  });
  it('blocks when the suggestion is no longer actionable', () => {
    assert.equal(canCreateSourceDraft('DISMISSED', 'CREATE_CRM_FOLLOW_UP_DRAFT', 'PROPOSED'), false);
  });
  it('blocks needs-data even when the candidate action would otherwise be draftable', () => {
    assert.equal(canCreateSourceDraft('NEW', 'CREATE_CRM_FOLLOW_UP_DRAFT', 'PROPOSED', true), false);
  });
});


it('shows usage guidance only for permitted actions', async () => {
  const { permittedUsageGuidance } = await import('./ai-suggestions.logic');
  assert.deepEqual(permittedUsageGuidance([]), []);
  const own = permittedUsageGuidance(['expense.create']);
  assert.deepEqual(own.map((g) => g.path), ['expenses/manual']);
  assert.ok(!JSON.stringify(own).includes('CRM'));
});

// manual-expense-web-entry-flag spec §9.1: the "บันทึกค่าใช้จ่ายด้วยมือ" card follows the one predicate.
it('leaves the manual-expense guidance out when the company does not show that page', async () => {
  const { permittedUsageGuidance } = await import('./ai-suggestions.logic');
  const permissions = ['expense.receipt.upload', 'expense.create', 'expense.review'];
  const paths = (canOpenManualExpense?: boolean) => permittedUsageGuidance(permissions, canOpenManualExpense).map((g) => g.path);
  assert.deepEqual(paths(true), ['expenses/upload', 'expenses/manual', 'expenses']);
  assert.deepEqual(paths(false), ['expenses/upload', 'expenses']);
  // Said nothing: the permission decides, as before.
  assert.deepEqual(paths(), ['expenses/upload', 'expenses/manual', 'expenses']);
  // The setting never offers the card to a session that may not create.
  assert.deepEqual(permittedUsageGuidance(['expense.review'], true).map((g) => g.path), ['expenses']);
});

it('direct AI entry checks the shared route gate before loading the hub and provides a way back', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../../../app/(workspace)/companies/[companyId]/ai-suggestions/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /!canSeeRoute\('\/ai-suggestions', session\?\.permissions \?\? \[\]\)/);
  assert.match(page, /<ForbiddenState titleAs="h1"[\s\S]*action=\{<BackLink/);
  assert.match(page, /packageAvailable=\{session\?\.availablePermissions \? canSeeRoute/);
  assert.match(page, /isOwner=\{session\?\.roles.includes\('OWNER'\)\}/);
  assert.match(page, /label="กลับไปหน้าแรก"/);
  assert.ok(page.indexOf('return <ForbiddenState') < page.indexOf('return <AiSuggestionsHubPage'));
});
