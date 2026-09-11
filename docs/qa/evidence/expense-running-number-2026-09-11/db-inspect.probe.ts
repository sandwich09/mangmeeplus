import { PrismaClient } from './src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { computeSnapshotHash } from './src/modules/reimbursements/domain/logic/reimbursement.logic';
async function main(){
if(!process.env.DATABASE_URL?.includes('/expense_number_proof_20260911')) throw new Error('Proof DB only');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
try {
const evidence=JSON.parse(readFileSync('/tmp/expense-number-proof-linked-api.json','utf8'));
const paid=evidence.find((r:any)=>r.stage==='paid detail').body;
const before=evidence.find((r:any)=>r.stage==='source before').body;
const request=await db.reimbursementRequest.findUniqueOrThrow({where:{id:paid.id},include:{lines:true,payments:true}});
const source=await db.expenseRecord.findUniqueOrThrow({where:{id:before.id}});
const projections=await db.expenseRecord.findMany({where:{companyId:request.companyId,sourceReimbursementRequestId:request.id}});
const duplicateExpensePayments=await db.expensePayment.count({where:{expenseId:{in:[source.id,...projections.map(p=>p.id)]}}});
const sourceSnapshot=request.lines[0].sourceExpenseSnapshotJson;
const fields:any={amount:request.amount,currency:request.currency,categoryKey:request.categoryKey,incurredDate:request.incurredDate.toISOString(),reason:request.reason,primaryAttachmentId:request.primaryAttachmentId,lines:request.lines.map(l=>({...l,sourceExpenseSnapshot:l.sourceExpenseSnapshotJson}))};
const oldHash=computeSnapshotHash(fields);
const changed=structuredClone(JSON.parse(JSON.stringify(fields)));
changed.lines[0].sourceExpenseSnapshot.expenseNumber='EXP-202608-00001';
const newHash=computeSnapshotHash(changed);
assert.notEqual(oldHash,newHash);
assert.equal(source.paidAmount.toString(),'0');
assert.equal(source.expenseNumber,null);
assert.equal(duplicateExpensePayments,0);
assert.equal(projections.length,1);
assert.equal(request.payments.length,1);
assert.equal(request.payments[0].status,'VOIDED');
assert.equal(request.lines[0].linkedExpenseId,source.id);
const out={baseline:'a3bfed76309a207d242b9aa27bc6b11b4f9077e4',database:'expense_number_proof_20260911',request:{id:request.id,requestNo:request.requestNo,status:request.status,paymentStatus:request.paymentStatus,postingStatus:request.postingStatus},source:{id:source.id,expenseNumber:source.expenseNumber,status:source.status,paidAmount:source.paidAmount},projections:projections.map(p=>({id:p.id,expenseNumber:p.expenseNumber,status:p.status,paidAmount:p.paidAmount,postingStatus:p.postingStatus,sourceReimbursementLineId:p.sourceReimbursementLineId})),payments:request.payments.map(p=>({id:p.id,status:p.status,paidAmount:p.paidAmount,postingStatus:p.postingStatus})),duplicateExpensePayments,snapshotMutationProbe:{oldHash,newHash,changesApprovalHash:oldHash!==newHash,retainedSnapshotSha256:createHash('sha256').update(JSON.stringify(sourceSnapshot)).digest('hex'),databaseWrites:0}};
writeFileSync('/tmp/expense-number-proof-db-inspection.json',JSON.stringify(out,null,2)); console.log(JSON.stringify(out,null,2));
}finally{await db.$disconnect();}}
main().catch(e=>{console.error(e.message);process.exitCode=1});
