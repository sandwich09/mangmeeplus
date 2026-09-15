import { NotFoundException } from '@nestjs/common';
import type { BillingAccount, Prisma } from '../../../generated/prisma/client';
import { hashBilling } from '../domain/billing-policy';

export type InvoiceObservation={accountId:string;customerId:string;providerInvoiceId:string;created:number;status:string;currency:string;total:number;paid:number;classification:'MATCHED'|'LOCAL_MISSING'|'DIFFERENT'};
export async function invoiceFindingSource(tx:Prisma.TransactionClient,account:BillingAccount,id:string) {
  const scope={companyId:account.companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode};
  const row=await tx.billingOperation.findFirst({where:{...scope,id,type:'OBSERVE_PROVIDER_INVOICE',state:'SUCCEEDED'}});
  if(!row?.referenceId)throw new NotFoundException();
  const observation=row.proposedJson as InvoiceObservation;
  const run=await tx.billingOperation.findFirst({where:{...scope,id:row.referenceId,type:'SCAN_PROVIDER_INVOICES'}});
  // JSONB reorders object keys; reconstruct the original observation shape before checking its stored hash.
  const original={accountId:observation.accountId,customerId:observation.customerId,providerInvoiceId:observation.providerInvoiceId,created:observation.created,status:observation.status,currency:observation.currency,total:observation.total,paid:observation.paid,classification:observation.classification};
  const source=run?.proposedJson as {accountId?:string;customerId?:string}|undefined;
  if(!run||source?.accountId!==account.id||observation.accountId!==account.id||source.customerId!==observation.customerId||
    !/^in_[a-zA-Z0-9]{1,120}$/.test(observation.providerInvoiceId)||row.requestHash!==hashBilling([run.id,original]))throw new NotFoundException();
  return {row,observation,scanId:run.id,bound:Boolean(account.customerId&&account.customerId===observation.customerId),
    sourceHash:hashBilling([row.id,row.requestHash,account.id,account.customerId,account.stripeAccountId,account.livemode])};
}
