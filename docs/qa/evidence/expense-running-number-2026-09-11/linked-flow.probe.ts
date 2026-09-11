import { test, expect } from './harness/fixtures';
const proofApi = new URL(process.env['E2E_API_BASE_URL'] ?? 'http://invalid');
if (proofApi.hostname !== '127.0.0.1' || proofApi.port !== '3011') throw new Error('Isolated proof API on 127.0.0.1:3011 only');
import { readFileSync, writeFileSync } from 'node:fs';

test('Proof: linked source reject/reopen, finance return, payout retry/void and cancel through real API', async ({api, apiAs, authedPage: page, companyId}) => {
  test.setTimeout(120_000);
  const base = `companies/${companyId}`;
  const sourceId = 'qa-exp-number-proof-reversal3';
  const approver = await apiAs('MANAGER');
  const evidence: any[] = [];
  const read = async (response: any, stage: string) => {
    const body = await response.json();
    evidence.push({stage, http: response.status(), body});
    writeFileSync('/tmp/expense-number-proof-linked-api.json', JSON.stringify(evidence,null,2));
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
    await page.screenshot({path:'/tmp/expense-number-proof-reopen.png',fullPage:true});
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
    await page.screenshot({path:'/tmp/expense-number-proof-finance-return-mobile.png',fullPage:true});
    }
    current = await read(await api.post(`${url}/submit`,{data:{}}),'resubmit after finance');
    current = await read(await approver.post(`${url}/approve`,{data:{approvalSnapshotHash:current.approvalSnapshotHash}}),'approve again');
    current = await read(await api.post(`${url}/finance-review`,{data:{decision:'APPROVED_FOR_PAYMENT',note:'QA ผ่าน'}}),'finance approve materialization');
    expect(current.status).toBe('READY_FOR_PAYMENT');
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
    expect(current.lines[0].linkedExpenseId).toBe(sourceId);
  } finally {
    const latestPolicy = await (await api.get(`${base}/reimbursement-policy`)).json();
    await read(await api.put(`${base}/reimbursement-policy`,{data:{allowSelfApproval:original.allowSelfApproval,requireReceipt:original.requireReceipt,financeReviewRequired:original.financeReviewRequired,expectedUpdatedAt:latestPolicy.updatedAt}}),'restore policy');
  }
});

test('Recovery proof: refresh after already-voided response then cancel the same request', async ({api, companyId}) => {
  const evidence = JSON.parse(readFileSync('/tmp/expense-number-proof-linked-api.json','utf8'));
  const paid = evidence.find((row:any)=>row.stage==='paid detail').body;
  const url = `companies/${companyId}/reimbursements/${paid.id}`;
  const read = async(response:any,stage:string)=> {
    const body=await response.json();
    evidence.push({stage,http:response.status(),body});
    writeFileSync('/tmp/expense-number-proof-linked-api-recovery.json',JSON.stringify(evidence,null,2));
    expect(response.ok(),`${stage}: ${JSON.stringify(body)}`).toBe(true);
    return body;
  };
  const detail=await read(await api.get(url),'recovery refresh');
  expect(['READY_FOR_PAYMENT','CANCELLED']).toContain(detail.status);
  expect(detail.payments).toHaveLength(1);
  expect(detail.payments[0].status).toBe('VOIDED');
  if (detail.status !== 'CANCELLED') await read(await api.post(`${url}/cancel`,{data:{reason:'QA recovery after lost void response'}}),'recovery cancel');
  const cancelled=await read(await api.get(url),'recovery cancelled detail');
  expect(cancelled.status).toBe('CANCELLED');
  expect(cancelled.requestNo).toBe(paid.requestNo);
  const after=await read(await api.get(`companies/${companyId}/expenses/qa-exp-number-proof-reversal3`),'recovery original source');
  const before=evidence.find((row:any)=>row.stage==='source before').body;
  expect(after.status).toBe(before.status);
  expect(Number(after.paidAmount)).toBe(0);
  expect(after.expenseNumber).toBe(before.expenseNumber);
  expect(after.vendorNameSnapshot).toBe(before.vendorNameSnapshot);
  expect(cancelled.lines[0].linkedExpenseId).toBe(after.id);
});
