import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reconcileBatchInput,reconcileCommandData} from './billing-reconcile-command';
import {hashBilling} from '../domain/billing-policy';
import type {BillingAccount} from '../../../generated/prisma/client';
import type {RequestContext} from '../../auth/domain/models/request-context.model';
test('bounded batch input rejects duplicate, foreign fields and malformed versions before any queue write',()=>{
  const row={companyId:'company-1',expectedVersion:1},valid={companies:[row],reason:' ตรวจรายการ '};assert.equal(reconcileBatchInput(valid).reason,'ตรวจรายการ');
  for(const value of [null,{}, {...valid,companies:[]},{...valid,companies:Array(26).fill(row)},{...valid,companies:[row,row]}, {...valid,mode:'LIVE'},{...valid,companies:[{...row,providerId:'acct_Else'}]},
    {...valid,companies:[{...row,expectedVersion:NaN}]},{...valid,companies:[{...row,expectedVersion:-1}]},{...valid,companies:[{...row,companyId:'../foreign'}]}])assert.throws(()=>reconcileBatchInput(value));
  assert.deepEqual(reconcileBatchInput({...valid,companies:[{...row,companyId:'z'},row]}).companies.map(i=>i.companyId),['company-1','z']);
});
test('batch child construction keeps the existing single-company original-command hash and actor binding',()=>{
  const actor={companyId:'staff-company',membershipId:'member',userId:'user'} as RequestContext,account={id:'account',companyId:'company',stripeAccountId:'acct_Test',livemode:false,version:7} as BillingAccount;
  const row=reconcileCommandData(actor,account,' ตรวจรายการ '),proposed={accountId:account.id,membershipId:actor.membershipId,actorCompanyId:actor.companyId};
  assert.equal(row.requestHash,hashBilling(['RECONCILE',account.id,7,'ตรวจรายการ',proposed,null]));assert.equal(row.companyId,'company');assert.equal(row.initiatorUserId,'user');assert.equal(row.type,'RECONCILE');assert.equal(row.state,'PREVIEW');assert.equal(row.sourceVersion,7);
  assert.ok((row.expiresAt as Date).getTime()>Date.now()+599000);
});
