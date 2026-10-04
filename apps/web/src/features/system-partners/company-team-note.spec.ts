import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const load = () => import('./PartnerTeamNote');
const base = { note: { companyId: 'co-1', text: '', version: 0, updatedAt: null, updatedBy: null, canManage: true },
  loading: false, editing: false, draft: '', saving: false, error: null, conflict: false, saved: false };
const actions = { onEdit: () => {}, onSave: () => {}, onCancel: () => {}, onDraft: () => {}, onReload: () => {} };
async function render(overrides: Record<string, unknown> = {}) {
  const { PartnerTeamNoteView } = await load();
  return renderToStaticMarkup(createElement(PartnerTeamNoteView, { state: { ...base, ...overrides }, ...actions } as any));
}
test('card shows loading, empty, multiline note, and last editor/time without exposing actor ids', async () => {
  const { COMPANY_TEAM_NOTE_WORDS: W } = await import('@watchdog-bms/contracts');
  assert.ok((await render({ loading: true, note: null })).includes(W.loading));
  assert.ok((await render()).includes(W.empty));
  const html = await render({ note: { ...base.note, text: 'ติดต่อแล้ว\nรอโทรกลับ', version: 2,
    updatedAt: '2026-10-04T01:00:00Z', updatedBy: { userId: 'private-actor', displayName: 'ผู้ดูแล' } } });
  assert.ok(html.includes('ติดต่อแล้ว\nรอโทรกลับ')); assert.match(html, /white-space|whitespace-pre-wrap/);
  assert.match(html, /ผู้ดูแล/); assert.ok(!html.includes('private-actor')); assert.ok(html.includes('2569'));
});
test('read-only card has no edit action; editing has save/cancel/count and busy disables controls', async () => {
  const { COMPANY_TEAM_NOTE_WORDS: W, COMPANY_TEAM_NOTE_MAX_LENGTH } = await import('@watchdog-bms/contracts');
  const readonly = await render({ note: { ...base.note, canManage: false } });
  assert.ok(readonly.includes(W.readOnly)); assert.ok(!readonly.includes(W.edit));
  const editing = await render({ editing: true, draft: 'หมายเหตุ' });
  assert.ok(editing.includes(W.save)); assert.ok(editing.includes(W.cancel)); assert.ok(editing.includes(W.count('หมายเหตุ'.length)));
  assert.ok(editing.includes(`maxLength="${COMPANY_TEAM_NOTE_MAX_LENGTH}"`));
  assert.match(await render({ editing: true, draft: 'ก'.repeat(1001) }), /type="submit"[^>]*disabled/);
  assert.match(await render({ editing: true, saving: true, draft: 'ร่าง' }), /textarea[^>]*disabled/);
});
test('conflict/failure keeps draft, blocks save and offers explicit reload; forbidden never offers edit', async () => {
  const { COMPANY_TEAM_NOTE_WORDS: W } = await import('@watchdog-bms/contracts');
  const conflict = await render({ editing: true, draft: 'ร่างที่ยังไม่บันทึก', conflict: true, error: W.conflict });
  assert.ok(conflict.includes('ร่างที่ยังไม่บันทึก')); assert.ok(conflict.includes(W.conflict)); assert.ok(conflict.includes(W.reloadDiscard));
  assert.match(conflict, /type="submit"[^>]*disabled/);
  const failed = await render({ error: W.saveUnknown, editing: true, draft: 'ร่าง' });
  assert.ok(failed.includes(W.saveUnknown)); assert.match(failed, /type="submit"[^>]*disabled/);
  const forbidden = await render({ note: null, error: W.denied });
  assert.ok(forbidden.includes(W.denied)); assert.ok(!forbidden.includes(W.edit));
  assert.ok((await render({ saved: true })).includes(W.saved));
});
test('card is mounted in company overview and uses one API with its loaded version; stale responses are fenced', async () => {
  await load();
  const page = readFileSync(new URL('./PartnerDetailPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /<PartnerTeamNote key=\{companyId\} companyId=\{companyId\}/);
  const card = readFileSync(new URL('./PartnerTeamNote.tsx', import.meta.url), 'utf8');
  assert.match(card, /expectedVersion: state.note.version/);
  assert.match(card, /generation.current/);
  assert.match(card, /COMPANY_TEAM_NOTE_WORDS/);
});
test('note API encodes company id, uses PUT, and sends text/version only', async () => {
  const api: any = await import('./system-partners.api');
  const calls: Array<{ url: string; init?: RequestInit }> = []; const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as typeof fetch;
  try {
    await api.getPartnerTeamNote('co /1');
    await api.putPartnerTeamNote('co /1', { text: 'ทีม', expectedVersion: 4 });
    assert.equal(calls[0].url, '/api/v1/system/partners/co%20%2F1/team-note');
    assert.equal(calls[1].url, calls[0].url); assert.equal(calls[1].init?.method, 'PUT');
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { text: 'ทีม', expectedVersion: 4 });
  } finally { globalThis.fetch = original; }
});

test('shared error translator reuses the note words and never displays raw note codes', async () => {
  const { COMPANY_TEAM_NOTE_WORDS: W } = await import('@watchdog-bms/contracts');
  const { apiErrorMessage } = await import('../../common/api/api-error-message');
  const cases = { company_team_note_version_conflict: W.conflict, company_team_note_invalid: W.invalid,
    company_team_note_too_long: W.tooLong, company_team_note_read_denied: W.denied, company_team_note_edit_denied: W.editDenied,
    company_team_note_company_not_found: W.notFound, company_team_note_save_unconfirmed: W.saveUnknown };
  for (const [code, words] of Object.entries(cases)) assert.equal(apiErrorMessage({ code }), words);
});

test('every executive role including the note grant has a Thai label on admin user lookup', async () => {
  const { EXECUTIVE_ROLE_KEYS, THAI_SYSTEM_ROLE_NAMES } = await import('@watchdog-bms/contracts');
  const { roleKeyDisplayName } = await import('../employee-access/role-picker.logic');
  for (const key of EXECUTIVE_ROLE_KEYS) {
    const label = roleKeyDisplayName(key);
    assert.match(label, /[ก-๙]/); assert.doesNotMatch(label, /[A-Za-z_]/);
    assert.equal(label, (THAI_SYSTEM_ROLE_NAMES as Record<string, string>)[key]);
  }
});
