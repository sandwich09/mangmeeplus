import { BadRequestException, ConflictException } from '@nestjs/common';
import { BILLING_ACTIONS, BILLING_PAID_TIERS, billingOffer, type BillingAction, type BillingPolicy, type BillingOffer, type BillingQuote, type PaidTier, type BillingInterval } from '@watchdog-bms/contracts';
import { createHash } from 'node:crypto';
import { stripeId, type StripeObject } from '../infrastructure/stripe.client';

export function billingError(code: string, message: string): ConflictException { return new ConflictException({ code, message }); }
// PostgreSQL JSONB may reorder object keys; compare semantic snapshots, not insertion order.
export function configurationHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : item;
  return hashBilling(canonical(value));
}
export function hashBilling(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
// Trusted stored gates only: native Portal plan changes have never been supported by pack accounting.
export function effectiveBillingGates(value: unknown): Record<BillingAction, boolean> {
  const gates = value as Record<string, unknown> | null;
  return Object.fromEntries(BILLING_ACTIONS.map(action => [action, action !== 'portal_change_plan' && gates?.[action] === true])) as Record<BillingAction, boolean>;
}
export function assertKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new BadRequestException('Invalid billing fields');
}
export function paidVariant(tier: unknown, interval: unknown, policy?:BillingPolicy|null): { tier: PaidTier; interval: BillingInterval; offer: BillingOffer } {
  if (!BILLING_PAID_TIERS.includes(tier as PaidTier) || !['month', 'year'].includes(interval as string)) {
    throw billingError('BILLING_OFFER_UNAVAILABLE', 'แพ็กเกจนี้ยังไม่เปิดรับชำระเงิน');
  }
  return { tier: tier as PaidTier, interval: interval as BillingInterval, offer: billingOffer(tier as PaidTier, interval as BillingInterval, policy) };
}

export function parseBillingPolicy(value: unknown): BillingPolicy {
  assertKeys(value, ['schemaVersion', 'paidStart', 'taxTreatment', 'graceDays', 'cancellation', 'planChanges', 'debtRecovery', 'refundPolicy', 'priceIds', 'zeroPriceIds', 'taxRateId', 'portalConfigurationId', 'consentRevision', 'issuer', 'salesCompanyIds', 'supportSlaMinutes', 'refundLimitSatang', 'offerTerms']);
  const p = value as unknown as BillingPolicy;
  if (p.schemaVersion !== 1 || ![null, 'IMMEDIATE', 'AFTER_TRIAL'].includes(p.paidStart) ||
      ![null, 'INCLUSIVE_VAT_7', 'EXCLUSIVE_VAT_7', 'NOT_VAT_REGISTERED'].includes(p.taxTreatment) ||
      !(p.graceDays === null || (Number.isInteger(p.graceDays) && p.graceDays >= 0 && p.graceDays <= 30)) ||
      ![null, 'PERIOD_END'].includes(p.cancellation) || ![null, 'UPGRADE_PRORATED_DOWNGRADE_PERIOD_END'].includes(p.planChanges) ||
      ![null, 'MANUAL_REVIEW'].includes(p.debtRecovery) || ![null, 'MANUAL_REVIEW'].includes(p.refundPolicy) ||
      typeof p.consentRevision !== 'string' || !/^[a-zA-Z0-9_.-]{1,80}$/.test(p.consentRevision) ||
      !(p.taxRateId === null || /^txr_[a-zA-Z0-9]+$/.test(p.taxRateId)) ||
      !(p.portalConfigurationId === null || /^bpc_[a-zA-Z0-9]+$/.test(p.portalConfigurationId))) throw new BadRequestException('Invalid billing policy');
  if(p.refundLimitSatang!=null&&(!Number.isSafeInteger(p.refundLimitSatang)||p.refundLimitSatang<1||p.refundLimitSatang>2147483647))throw new BadRequestException('Invalid refund limit');
  if(p.offerTerms!=null){
    assertKeys(p.offerTerms,BILLING_PAID_TIERS);
    for(const terms of Object.values(p.offerTerms)){
      assertKeys(terms,['monthlyPriceSatang','annualPriceSatang','monthlyReceiptAllowance','branchLimit','employeeLimit']);
      if(('branchLimit' in terms||'employeeLimit' in terms)&&[terms.branchLimit,terms.employeeLimit].some(limit=>!Number.isInteger(limit)||Number(limit)<1||Number(limit)>1000))
        throw new BadRequestException({code:'CONTROL_OFFER_CAPACITY_INVALID',message:'Invalid package capacity'});
      if(!Number.isSafeInteger(terms.monthlyReceiptAllowance)||terms.monthlyReceiptAllowance<1||terms.monthlyReceiptAllowance>Math.floor(2147483647/12))
        throw new BadRequestException({code:'CONTROL_OFFER_RECEIPTS_INVALID',message:'Invalid purchased receipt allowance'});
      for(const amount of [terms.monthlyPriceSatang,terms.annualPriceSatang])
        if(!Number.isSafeInteger(amount)||amount<1000||quoteTotals(amount,p.taxTreatment).totalSatang>99999999)
          throw new BadRequestException({code:'CONTROL_OFFER_PRICE_INVALID',message:'Invalid paid offer price'});
    }
  }
  const variants = BILLING_PAID_TIERS.flatMap((tier) => [`${tier}:month`, `${tier}:year`]);
  assertKeys(p.priceIds, variants);
  if (Object.values(p.priceIds).some((id) => typeof id !== 'string' || !/^price_[a-zA-Z0-9]+$/.test(id))) throw new BadRequestException('Invalid price mapping');
  if (new Set(Object.values(p.priceIds)).size !== Object.values(p.priceIds).length) throw new BadRequestException('Price mappings must be unique');
  if (p.zeroPriceIds !== undefined) {
    assertKeys(p.zeroPriceIds, variants);
    const ids = Object.values(p.zeroPriceIds);
    if (ids.some(id => typeof id !== 'string' || !/^price_[a-zA-Z0-9]+$/.test(id) || Object.values(p.priceIds).includes(id)) ||
        new Set(ids).size !== ids.length) throw new BadRequestException('Invalid prepaid price mapping');
  }
  if (p.taxTreatment === 'NOT_VAT_REGISTERED' && p.taxRateId !== null) throw new BadRequestException('VAT OFF must not attach a tax rate');
  if (p.issuer !== undefined) {
    assertKeys(p.issuer, ['legalName', 'address', 'thaiTaxId', 'stripeTaxId']);
    if (typeof p.issuer.legalName !== 'string' || !p.issuer.legalName.trim() || p.issuer.legalName.length > 250 ||
      typeof p.issuer.address !== 'string' || !p.issuer.address.trim() || p.issuer.address.length > 1000 ||
      typeof p.issuer.thaiTaxId !== 'string' || !/^\d{13}$/.test(p.issuer.thaiTaxId) || typeof p.issuer.stripeTaxId !== 'string' ||
      !/^txi_[a-zA-Z0-9]+$/.test(p.issuer.stripeTaxId)) throw new BadRequestException('Invalid billing issuer');
  }
  if (p.salesCompanyIds != null && (!Array.isArray(p.salesCompanyIds) || p.salesCompanyIds.length > 100 ||
      p.salesCompanyIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) ||
      new Set(p.salesCompanyIds).size !== p.salesCompanyIds.length)) throw new BadRequestException('Invalid sales companies');
  if(p.supportSlaMinutes!=null&&!validSupportSla(p.supportSlaMinutes))throw new BadRequestException('Invalid case follow-up minutes');
  return {...p,...p.salesCompanyIds?{salesCompanyIds:[...p.salesCompanyIds].sort()}:{},...p.supportSlaMinutes?{supportSlaMinutes:{
    NORMAL:p.supportSlaMinutes.NORMAL,HIGH:p.supportSlaMinutes.HIGH,CRITICAL:p.supportSlaMinutes.CRITICAL}}:{}};
}

export function assertRefundControlPolicy(policy:BillingPolicy|null,enabled:boolean):void {
  if(enabled&&(!policy||policy.refundPolicy!=='MANUAL_REVIEW'||!Number.isSafeInteger(policy.refundLimitSatang)||policy.refundLimitSatang!<1||policy.refundLimitSatang!>2147483647))
    throw billingError('CONTROL_REFUND_CONFIG_REQUIRED','กำหนดวงเงินคืนเงินและขออนุมัตินโยบายก่อนเปิดการคืนเงิน');
}

export function validSupportSla(value:unknown): value is NonNullable<BillingPolicy['supportSlaMinutes']> {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const row=value as Record<string,unknown>;
  return Object.keys(row).length===3&&['NORMAL','HIGH','CRITICAL'].every(key=>Number.isInteger(row[key])&&(row[key] as number)>=1&&(row[key] as number)<=525600);
}

export function companyCanBuy(policy: BillingPolicy | null, companyId: string): boolean {
  return Boolean(policy && (policy.salesCompanyIds == null || policy.salesCompanyIds.includes(companyId)));
}
export function assertCompanyCanBuy(policy: BillingPolicy | null, companyId: string): void {
  if (!companyCanBuy(policy, companyId)) throw billingError('BILLING_COMPANY_SALES_CLOSED', 'ยังไม่เปิดรับรายการซื้อใหม่สำหรับบริษัทนี้ กรุณาติดต่อทีมงาน');
}

export function assertPolicyReady(policy: BillingPolicy): void {
  if (!policy.paidStart || !policy.taxTreatment || policy.graceDays === null || !policy.cancellation ||
      !policy.planChanges || !policy.debtRecovery || !policy.refundPolicy || !policy.portalConfigurationId ||
      (policy.taxTreatment !== 'NOT_VAT_REGISTERED' && !policy.taxRateId)) {
    throw billingError('CONTROL_POLICY_NOT_READY', 'นโยบายการชำระเงินยังรอการยืนยันจากผู้ดูแล');
  }
}

export function assertStripePrice(price: StripeObject, offer: BillingOffer, policy: BillingPolicy, livemode: boolean, expectedId: string): void {
  const behavior = policy.taxTreatment === 'EXCLUSIVE_VAT_7' ? 'exclusive' : 'inclusive';
  if (price.id !== expectedId || !stripeId(price.product) || price.object !== 'price' || price.livemode !== livemode || price.active !== true || price.type !== 'recurring' ||
      price.currency !== 'thb' || price.unit_amount !== offer.priceSatang || price.recurring?.interval !== offer.interval ||
      price.recurring?.interval_count !== 1 || price.recurring?.usage_type !== 'licensed' || price.billing_scheme !== 'per_unit' ||
      (policy.taxTreatment !== 'NOT_VAT_REGISTERED' && price.tax_behavior !== behavior)) {
    throw billingError('BILLING_PRICE_MISMATCH', 'ข้อมูลราคาไม่ตรงกัน กรุณาติดต่อทีมงาน');
  }
}

export function assertStripePortalConfiguration(portal: StripeObject, expectedId: string, livemode: boolean): void {
  if (portal.id !== expectedId || portal.object !== 'billing_portal.configuration' || portal.livemode !== livemode || portal.active !== true ||
      portal.features?.payment_method_update?.enabled !== true || portal.features?.subscription_update?.enabled !== false ||
      portal.features?.subscription_cancel?.enabled !== false ||
      (portal.features?.customer_update?.enabled === true && portal.features?.customer_update?.allowed_updates?.includes('email'))) {
    throw billingError('BILLING_PORTAL_CONFIG_MISMATCH', 'กำลังตรวจสอบการตั้งค่าหน้าแก้บัตร กรุณาลองใหม่หรือติดต่อทีมงาน');
  }
}

export function quoteTotals(priceSatang: number, tax: BillingPolicy['taxTreatment']): Pick<BillingQuote, 'subtotalSatang' | 'taxSatang' | 'totalSatang'> {
  const taxSatang = tax === 'EXCLUSIVE_VAT_7' ? Math.round(priceSatang * 7 / 100) : tax === 'INCLUSIVE_VAT_7' ? priceSatang - Math.round(priceSatang * 100 / 107) : 0;
  return { subtotalSatang: tax === 'INCLUSIVE_VAT_7' ? priceSatang - taxSatang : priceSatang, taxSatang,
    totalSatang: priceSatang + (tax === 'EXCLUSIVE_VAT_7' ? taxSatang : 0) };
}

export function billingMonth(now = new Date()): { monthKey: string; resetsAt: string } {
  const local = new Date(now.getTime() + 7 * 3600000);
  const year = local.getUTCFullYear(), month = local.getUTCMonth();
  return { monthKey: `${year}-${String(month + 1).padStart(2, '0')}`, resetsAt: new Date(Date.UTC(year, month + 1, 1) - 7 * 3600000).toISOString() };
}
