import { HttpException } from '@nestjs/common';
import { BILLING_PAID_TIERS, billingOffer, type BillingConfigurationCheckItem as Item, type BillingPolicy } from '@watchdog-bms/contracts';
import { assertPolicyReady, assertStripePrice, assertStripePortalConfiguration, billingError } from '../domain/billing-policy';
import { stripeId, StripeRequestError } from '../infrastructure/stripe.client';
import type { BillingService } from './billing.service';

/** Observations only. Missing mappings stay unavailable; they never create an offer. */
export async function inspectBillingConfiguration(billing:BillingService, policy:BillingPolicy|null):Promise<Item[]> {
  const items:Item[]=[];
  const check=async(kind:Item['kind'],read:()=>Promise<unknown>,offerKey?:Item['offerKey']):Promise<Item>=>{
    try{await read();return {kind,offerKey,state:'MATCH',reason:'MATCH'};}catch(error){
      const different=error instanceof HttpException||(error instanceof StripeRequestError&&['account_mismatch','mode_mismatch'].includes(error.code));
      return {kind,offerKey,state:different?'DIFFERENT':'UNAVAILABLE',reason:different?(kind==='ACCOUNT'?'ACCOUNT_DIFFERENT':'MAPPING_DIFFERENT'):'PROVIDER_UNAVAILABLE'};
    }
  };
  if(!policy)return [{kind:'POLICY',state:'NOT_CONFIGURED',reason:'POLICY_NOT_READY'}];
  try{assertPolicyReady(policy);if(policy.paidStart!=='IMMEDIATE'||!Object.keys(policy.priceIds).length)throw Error('unsupported');}
  catch{return [{kind:'POLICY',state:'NOT_CONFIGURED',reason:'POLICY_NOT_READY'}];}
  items.push({kind:'POLICY',state:'MATCH',reason:'MATCH'});
  const account=await check('ACCOUNT',()=>billing.stripe.assertAccount());items.push(account);
  if(account.state!=='MATCH')return items;
  // At most six parallel pairs; each existing provider request has a15second timeout.
  const prices=await Promise.all(BILLING_PAID_TIERS.flatMap(tier=>(['month','year'] as const).map(async interval=>{
    const offerKey=`${tier}:${interval}` as const,priceId=policy.priceIds[offerKey],zeroId=policy.zeroPriceIds?.[offerKey],offer=billingOffer(tier,interval);
    let product:string|null=null;
    const paid:Item=priceId?await check('PRICE',async()=>{const price=await billing.stripe.request('GET',`/prices/${priceId}`);
      assertStripePrice(price,offer,policy,billing.stripe.livemode,priceId);product=stripeId(price.product);},offerKey):
      {kind:'PRICE',offerKey,state:'NOT_CONFIGURED',reason:'NOT_CONNECTED'};
    const prepaid:Item=!zeroId?{kind:'PREPAID_PRICE',offerKey,state:'NOT_CONFIGURED',reason:'NOT_CONNECTED'}:paid.state!=='MATCH'?
      {kind:'PREPAID_PRICE',offerKey,state:paid.state==='UNAVAILABLE'?'UNAVAILABLE':'DIFFERENT',reason:paid.state==='UNAVAILABLE'?'PROVIDER_UNAVAILABLE':'MAPPING_DIFFERENT'}:
      await check('PREPAID_PRICE',async()=>{const zero=await billing.stripe.request('GET',`/prices/${zeroId}`);
        if(stripeId(zero.product)!==product)throw billingError('BILLING_PRICE_MISMATCH','ข้อมูลราคาไม่ตรงกัน');
        assertStripePrice(zero,{...offer,priceSatang:0},policy,billing.stripe.livemode,zeroId);},offerKey);
    return [paid,prepaid];
  })));
  items.push(...prices.flat());
  items.push(await check('PORTAL',async()=>{const portal=await billing.stripe.request('GET',`/billing_portal/configurations/${policy.portalConfigurationId}`);
    assertStripePortalConfiguration(portal,policy.portalConfigurationId!,billing.stripe.livemode);}));
  items.push(await check('TAX',()=>billing.assertTaxSettings(policy)));
  return items;
}
