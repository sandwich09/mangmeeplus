import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderSubstituteReceiptSvg } from '/tmp/mangmee-substitute-editable-navigation-20260910/apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.ts';

const snapshot = {
  documentNumber: 'SRC-202609-00040', version: 1,
  company: {name:'บริษัทตัวอย่าง',branchName:'สำนักงานใหญ่',taxId:'0000000000000'},
  expense: {id:'audit-fixture-only',expenseNumber:null as string|null,expenseDate:'2026-08-31T00:00:00.000Z',paymentDate:'2026-09-11T00:00:00.000Z',currency:'THB',grandTotalAmount:'1200.00',paymentMethod:'TRANSFER',paymentReference:null,category:'ค่าใช้จ่าย',businessPurpose:'ซื้อวัสดุ',lines:[{description:'วัสดุ',quantity:'1',amount:'1200.00'}]},
  originalSourceDocumentType:'EXPENSE_NOTE_TEXT',reasonCode:'PAYEE_CANNOT_ISSUE',missingReceiptReason:'ผู้ขายไม่ออกใบเสร็จ',
  payer:{userId:'audit-user',name:'ผู้รับรองตัวอย่าง',position:'',certifiedAt:'2026-09-11T00:00:00.000Z'},
  certificationText:'รับรองรายจ่ายตามข้อมูลที่ระบุ',evidence:[],note:null
};
const before = renderSubstituteReceiptSvg(snapshot,undefined,undefined,undefined,{paperForm:true}).toString('utf8');
snapshot.expense.expenseNumber='EXP-202608-00001';
const after = renderSubstituteReceiptSvg(snapshot,undefined,undefined,undefined,{paperForm:true}).toString('utf8');
assert.ok(before.includes(snapshot.documentNumber));
assert.ok(after.includes(snapshot.expense.expenseNumber));
assert.ok(!after.includes(snapshot.documentNumber));
fs.writeFileSync('/tmp/expense-number-audit-paper-with-exp.svg',after);
console.log(JSON.stringify({probe:'paper form contains SRC before EXP exists but loses SRC when EXP exists',reproduced:true,beforeContainsSRC:true,afterContainsSRC:false,afterContainsEXP:true,databaseWrites:0}));
