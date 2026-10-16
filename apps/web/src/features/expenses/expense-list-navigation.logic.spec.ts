import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readExpenseListState, expenseListUrl, expenseDetailUrl, expenseListBackTarget, scrollExpenseListRow } from './expense-list-navigation.logic';
const path = '/companies/co/expenses';
test('list query round trips every filter and preserves existing entry keys only', () => {
  const query = new URLSearchParams('month=2026-09&chip=confirmed&query=ร้าน+ก&dateOrder=oldest&page=3&view=confirmed&fromDate=2026-09-01&toDate=2026-09-30&day=2026-09-05&branchId=b&highlight=old&foreign=x');
  const state = readExpenseListState(query, '2026-10');
  assert.deepEqual(state, { month: '2026-09', chip: 'confirmed', query: 'ร้าน ก', dateOrder: 'oldest', page: 3 });
  const url = expenseListUrl(path, query, state);
  const restored = new URLSearchParams(url.split('?')[1]);
  assert.deepEqual(readExpenseListState(restored, '2026-12'), state);
  for (const key of ['view','fromDate','toDate','day','branchId','highlight']) assert.equal(restored.get(key), query.get(key));
  assert.equal(restored.has('foreign'), false);
});
test('old day links and invalid list values have safe defaults', () => {
  assert.equal(readExpenseListState(new URLSearchParams('day=2026-08-03'), '2026-10').month, '2026-08');
  assert.deepEqual(readExpenseListState(new URLSearchParams('month=no&chip=no&page=-2&dateOrder=no'), '2026-10'), { month: '2026-10', chip: 'all', query: '', dateOrder: 'newest', page: 1 });
  assert.equal(readExpenseListState(new URLSearchParams('chip=draft'), '2026-10').chip, 'pending');
});
test('row encodes one local back URL and returning highlights this expense', () => {
  const list = `${path}?month=2026-09&query=ร้าน+ก&page=3&highlight=old&foreign=x`;
  const detail = expenseDetailUrl(path, 'e/1', list);
  const params = new URLSearchParams(detail.split('?')[1]);
  assert.equal(params.getAll('back').length, 1);
  assert.ok(detail.startsWith(`${path}/e%2F1?back=`));
  const target = expenseListBackTarget(path, params.get('back'), 'e/1');
  const returned = new URLSearchParams(target.split('?')[1]);
  assert.equal(returned.get('page'), '3'); assert.equal(returned.get('query'), 'ร้าน ก');
  assert.equal(returned.get('highlight'), 'e/1'); assert.equal(returned.has('foreign'), false);
});
test('foreign, absolute, child and malformed back paths are ignored; no back stays plain', () => {
  for (const back of [null, '', 'https://evil.test'+path, '//evil.test'+path, '/companies/other/expenses', path+'/upload', path+'-other', path+'/../settings', path+'#other', path+'\\evil']) {
    assert.equal(expenseListBackTarget(path, back, 'e'), path, String(back));
  }
});

test('a visible highlighted row stays still; an off-screen row scrolls smoothly by the shortest distance', () => {
  for (const [top, bottom, count] of [[20, 80, 0], [-20, 80, 1], [700, 820, 1]]) {
    const scrollIntoView = mock.fn();
    scrollExpenseListRow({ getBoundingClientRect: () => ({ top, bottom } as DOMRect), scrollIntoView }, 800);
    assert.equal(scrollIntoView.mock.callCount(), count);
    if (count) assert.deepEqual(scrollIntoView.mock.calls[0].arguments, [{ block: 'nearest', behavior: 'smooth' }]);
  }
});


test('evidence rows return to the same safe list with every filter and page', () => {
  const back = `${path}/evidence?yearMonth=&dateField=uploadedAt&documentStatus=VOIDED&sourceDocumentType=RECEIPT&taxEvidenceStatus=NEEDS_REVIEW&flagFilter=attention&order=oldest&page=3&foreign=x`;
  const url = expenseDetailUrl(path, 'e1', back);
  const query = new URLSearchParams(url.split('?')[1]);
  const returned = expenseListBackTarget(path, query.get('back'), 'e1');
  assert.ok(returned.startsWith(`${path}/evidence?`));
  const state = new URLSearchParams(returned.split('?')[1]);
  for (const key of ['yearMonth', 'dateField', 'documentStatus', 'sourceDocumentType', 'taxEvidenceStatus', 'flagFilter', 'order', 'page']) assert.equal(state.get(key), new URLSearchParams(back.split('?')[1]).get(key));
  assert.equal(state.get('highlight'), 'e1'); assert.equal(state.has('foreign'), false);
});

test('counterparty detail is a safe same-company back destination; sibling, nested and encoded paths are refused', () => {
  const back = '/companies/co/counterparties/cp-1';
  assert.equal(expenseDetailUrl('/companies/co/expenses', 'e1', back), '/companies/co/expenses/e1?back=%2Fcompanies%2Fco%2Fcounterparties%2Fcp-1');
  assert.equal(expenseListBackTarget('/companies/co/expenses', back, 'e1'), back);
  for (const bad of ['/companies/other/counterparties/cp-1', '/companies/co/counterparties/cp-1/edit', '/companies/co/counterparties/..', '/companies/co/counterparties/%2f..', `${back}?redirect=evil`, `${back}#x`, `${back}\\x`]) {
    assert.equal(expenseListBackTarget('/companies/co/expenses', bad, 'e1'), '/companies/co/expenses');
  }
});
