import { test, expect } from './harness/fixtures';
const proofApi = new URL(process.env['E2E_API_BASE_URL'] ?? 'http://invalid');
test.skip(process.env['EXPENSE_NUMBER_LIVE'] !== '1', 'Requires isolated local numbering fixture and draft issuance enabled');
import { writeFileSync } from 'node:fs';

test('Proof: linked source reject/reopen, finance return, payout retry/void and cancel through real API', async ({api, apiAs, authedPage: page, companyId}) => {
  test.setTimeout(120_000);
  expect(['localhost', '127.0.0.1']).toContain(proofApi.hostname);
  const base = `companies/${companyId}`;
  const sourceId = process.env['EXPENSE_NUMBER_SOURCE_ID'] ?? 'qa-exp-number-impl-linked1';
  const approver = await apiAs('MANAGER');
  const evidence: any[] = [];
  const read = async (response: any, stage: string) => {
    const body = await response.json();
    evidence.push({stage, http: response.status(), body});
    writeFileSync('/tmp/expense-number-impl-linked-api.json', JSON.stringify(evidence,null,2));
    expect(response.ok(), `${stage}: ${JSON.stringify(body)}`).toBe(true);
    return body;
  };
  const original = await read(await api.get(`${base}/reimbursement-policy`), 'original policy');
  await read(await api.put(`${base}/reimbursement-policy`,{data:{allowSelfApproval:true,requireReceipt:true,financeReviewRequired:true,expectedUpdatedAt:original.id === 'default' ? undefined : original.updatedAt}}),'test policy');
  try {
    const source = await read(await api.get(`${base}/expenses/${sourceId}`),'source before');
    const options = await read(await api.get(`${base}/reimbursements/source-options?branchId=${source.branchId}&expenseId=${sourceId}`),'source eligibility');
    const option = options.items.find((item:any)=>item.expenseId===sourceId);
    expect(option?.eligible).toBe(true);
    const draft = await read(await api.post(`${base}/reimbursements`,{data:{branchId:source.branchId,reason:'QA EXP proof reversal',currency:'THB',lines:[{lineNo:1,incurredDate:option.incurredDate,description:option.description,categoryKey:option.categoryKey,amount:option.amount,linkedExpenseId:sourceId,sourceExpenseUpdatedAt:option.updatedAt}]}}),'create linked draft');
    const url = `${base}/reimbursements/${draft.id}`;
    let current = await read(await api.post(`${url}/submit`,{data:{}}),'submit');
    const requestNo = current.requestNo;
    const locked = await api.patch(`${base}/expenses/${sourceId}/review-fields`,{data:{expectedUpdatedAt:source.updatedAt,vendorNameSnapshot:'SHOULD NOT SAVE'}});
    const lockBody = await locked.json();
    evidence.push({stage:'source edit locked',http:locked.status(),body:lockBody});
    expect(locked.ok()).toBe(false);
    expect(JSON.stringify(lockBody)).toContain('substitute_source_has_live_claim');
    await read(await approver.post(`${url}/reject`,{data:{reason:'QA ให้แก้คำอธิบาย'}}),'reject');
    current = await read(await api.post(`${url}/reopen`,{data:{}}),'reopen');
    expect(current.status).toBe('DRAFT');
    expect(current.requestNo).toBe(requestNo);
    if (process.env['EXP_PROOF_UI'] === '1') {
    await page.goto(`/companies/${companyId}/reimbursements/${draft.id}`);
    await page.getByRole('link',{name:'แก้ไขคำขอ',exact:true}).click();
    await expect(page.getByRole('button',{name:'โหลดข้อมูลต้นทางล่าสุดและตรวจใหม่',exact:true})).toBeVisible();
    await page.screenshot({path:'/tmp/expense-number-impl-reopen.png',fullPage:true});
    }
    await read(await api.patch(url,{data:{reason:'QA EXP proof corrected'}}),'correct reason');
    current = await read(await api.post(`${url}/submit`,{data:{}}),'resubmit');
    current = await read(await approver.post(`${url}/approve`,{data:{approvalSnapshotHash:current.approvalSnapshotHash}}),'approve');
    current = await read(await api.post(`${url}/finance-review`,{data:{decision:'NEEDS_INFO',note:'QA ขอรายละเอียดเพิ่มเติม'}}),'finance return');
    expect(current.status).toBe('DRAFT');
    expect(current.requestNo).toBe(requestNo);
    if (process.env['EXP_PROOF_UI'] === '1') {
    await page.goto(`/companies/${companyId}/reimbursements/${draft.id}`);
    await expect(page.getByRole('link',{name:'แก้ไขตามคำขอ',exact:true})).toBeVisible();
    await page.setViewportSize({width:390,height:900});
    await page.screenshot({path:'/tmp/expense-number-impl-finance-return-mobile.png',fullPage:true});
    }
    current = await read(await api.post(`${url}/submit`,{data:{}}),'resubmit after finance');
    current = await read(await approver.post(`${url}/approve`,{data:{approvalSnapshotHash:current.approvalSnapshotHash}}),'approve again');
    current = await read(await api.post(`${url}/finance-review`,{data:{decision:'APPROVED_FOR_PAYMENT',note:'QA ผ่าน'}}),'finance approve materialization');
    expect(current.status).toBe('READY_FOR_PAYMENT');
    const projections = await read(await api.get(`${base}/expenses?sourceReimbursementRequestId=${draft.id}&pageSize=100`), 'projection numbers');
    const own = (projections.items ?? projections.data ?? []).filter((r:any) => r.sourceReimbursementRequestId === draft.id);
    expect(own.length).toBeGreaterThan(0);
    for (const row of own) expect(row.expenseNumber).toMatch(/^EXP-202608-/);
    const payment = {paidAmount:'100',currency:'THB',paymentMethod:'CASH',paidAt:new Date().toISOString(),idempotencyKey:`proof-pay-${draft.id}`};
    current = await read(await api.post(`${url}/payments`,{data:payment}),'pay');
    expect(current.status).toBe('PAID');
    current = await read(await api.post(`${url}/payments`,{data:payment}),'retry pay');
    const detail = await read(await api.get(url),'paid detail');
    expect(detail.payments).toHaveLength(1);
    await read(await api.post(`${url}/payments/${detail.payments[0].id}/void`,{data:{reason:'QA กลับรายการ'}}),'void payment');
    await read(await api.post(`${url}/payments/${detail.payments[0].id}/void`,{data:{reason:'QA retry กลับรายการ'}}),'retry void');
    current = await read(await api.get(url),'unpaid detail');
    expect(current.requestNo).toBe(requestNo);
    expect(current.status).toBe('READY_FOR_PAYMENT');
    current = await read(await api.post(`${url}/cancel`,{data:{reason:'QA ยกเลิกหลังกลับรายการ'}}),'cancel projections');
    expect(current.status).toBe('CANCELLED');
    const after = await read(await api.get(`${base}/expenses/${sourceId}`),'source after');
    expect(after.status).toBe(source.status);
    expect(Number(after.paidAmount)).toBe(0);
    expect(after.expenseNumber).toBe(source.expenseNumber);
    expect(after.vendorNameSnapshot).toBe(source.vendorNameSnapshot);
    expect((await read(await api.get(url),'cancelled detail')).lines[0].linkedExpenseId).toBe(sourceId);
  } finally {
    const latestPolicy = await (await api.get(`${base}/reimbursement-policy`)).json();
    await read(await api.put(`${base}/reimbursement-policy`,{data:{allowSelfApproval:original.allowSelfApproval,requireReceipt:original.requireReceipt,financeReviewRequired:original.financeReviewRequired,expectedUpdatedAt:latestPolicy.updatedAt}}),'restore policy');
  }
});
