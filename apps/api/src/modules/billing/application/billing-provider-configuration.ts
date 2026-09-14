import { HttpException } from '@nestjs/common';
import { BILLING_PAID_TIERS, billingOffer, type BillingConfigurationCheckItem as Item, type BillingPolicy } from '@watchdog-bms/contracts';
import { assertPolicyReady, assertStripePrice, billingError } from '../domain/billing-policy';
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
      if(price.id!==priceId)throw billingError('BILLING_PRICE_MISMATCH','ข้อมูลราคาไม่ตรงกัน');
      assertStripePrice(price,offer,policy,billing.stripe.livemode);product=stripeId(price.product);if(!product)throw billingError('BILLING_PRICE_MISMATCH','ไม่พบสินค้าที่ผูกราคา');},offerKey):
      {kind:'PRICE',offerKey,state:'NOT_CONFIGURED',reason:'NOT_CONNECTED'};
    const prepaid:Item=!zeroId?{kind:'PREPAID_PRICE',offerKey,state:'NOT_CONFIGURED',reason:'NOT_CONNECTED'}:paid.state!=='MATCH'?
      {kind:'PREPAID_PRICE',offerKey,state:paid.state==='UNAVAILABLE'?'UNAVAILABLE':'DIFFERENT',reason:paid.state==='UNAVAILABLE'?'PROVIDER_UNAVAILABLE':'MAPPING_DIFFERENT'}:
      await check('PREPAID_PRICE',async()=>{const zero=await billing.stripe.request('GET',`/prices/${zeroId}`);
        if(zero.id!==zeroId||stripeId(zero.product)!==product)throw billingError('BILLING_PRICE_MISMATCH','ข้อมูลราคาไม่ตรงกัน');
        assertStripePrice(zero,{...offer,priceSatang:0},policy,billing.stripe.livemode);},offerKey);
    return [paid,prepaid];
  })));
  items.push(...prices.flat());
  items.push(await check('PORTAL',async()=>{const portal=await billing.stripe.request('GET',`/billing_portal/configurations/${policy.portalConfigurationId}`);
    if(portal.id!==policy.portalConfigurationId||portal.object!=='billing_portal.configuration'||portal.livemode!==billing.stripe.livemode||portal.active!==true||
      portal.features?.payment_method_update?.enabled!==true||portal.features?.subscription_update?.enabled!==false||portal.features?.subscription_cancel?.enabled!==false)
      throw billingError('BILLING_PORTAL_CONFIG_MISMATCH','การตั้งค่าหน้าแก้บัตรไม่ตรงกัน');}));
  items.push(await check('TAX',()=>billing.assertTaxSettings(policy)));
  return items;
}
