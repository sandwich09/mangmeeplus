import { Injectable } from '@nestjs/common';
import { BILLING_PAID_TIERS, customerPackageName, lineCustomerWording, THAI_SYSTEM_ROLE_NAMES, addCivilDays, billingPlanLabel, civilDate, DEFAULT_CHAT_CREDIT_SATANG, packageMenuLabels, type BillingOffer, type BillingTaxTreatment,
  type SourceRef, type ToolResult } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { PrismaService } from '../../../../common/database/prisma.service';
import { BillingService } from '../../../billing/application/billing.service';
import { quoteTotals } from '../../../billing/domain/billing-policy';
import { baht } from '../../domain/logic/line-event-discount.logic';
import { isReceiptAddOnKind, visibleReceiptLots } from '../../../billing/application/billing-receipt-grants';
import { PLAN_MANAGE_PERMISSION_KEY } from '../../../access-control/domain/logic/plan-manager.logic';
import { effectivePlanCapacity } from '../../../system-partner-management/domain/logic/plan-capacity';
import { planCapacityUsed } from '../../../system-partner-management/application/plan-term-limit';
import { PACKAGE_PACE_FORMULA, packagePace, singlePaidCycle } from '../../domain/logic/package-usage-pace.logic';

/** Advisor spec §5.1 / P8: the typed refusal the gateway answers with the fixed "ask the owner" line. */
export const PACKAGE_MANAGER_REQUIRED = 'PACKAGE_MANAGER_REQUIRED';

/** Why there is no projection, in the words the answer may repeat. */
const PACE_NOTES = {
  too_early: 'รอบนี้เพิ่งเริ่มไม่ถึง 7 วัน ยังเร็วเกินไปที่จะคาดการณ์',
  unlimited: 'ใบเสร็จไม่จำกัดจำนวน จึงไม่ต้องคาดการณ์',
  no_single_cycle: 'ใบเสร็จที่ใช้ได้มาจากหลายรอบหรือมีส่วนที่ผู้ดูแลเพิ่มให้ จึงคาดการณ์จากอัตราการใช้รอบเดียวไม่ได้',
} as const;

const room = (used: number, limit: number | null) => ({ used, limit, remaining: limit === null ? null : Math.max(0, limit - used) });

/**
 * `billing.get_package_usage` (advisor spec §5.1, slice S2a). THIS company's package, branch and member
 * room, and receipt reads with an API-computed projection — the numbers the package page shows
 * (BillingService.usage, effectivePlanCapacity, the plan-limit counts). Read-only: never
 * BillingService.status() (it calls Stripe and throws for a non-manager) or capacity() (it locks the
 * company row), never a price, never another package. Every value is a number, a civil date or plain
 * Thai an answer may quote. No renewal mode: it is not among the figures the owner approved for chat
 * (spec §10 item 1), and in the 2026-09-30 eval it drew unasked renewal notes that became buy/change
 * nudges.
 */
@Injectable()
export class BillingGetPackageUsageTool implements ErpReadToolPort {
  toolName = 'billing.get_package_usage';

  constructor(private readonly prisma: PrismaService, private readonly billing: BillingService) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = new Date().toISOString();
    // Owner decision 2026-09-30 (§10 item 2): figures only for whoever may manage the package — the
    // permission canManagePlan and BillingService.assertOwner check. The registry offers this tool to
    // every assistant user so everyone else reaches this refusal instead of "the package lacks this".
    if (!ctx.permissions.includes(PLAN_MANAGE_PERMISSION_KEY)) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf, errorCode: PACKAGE_MANAGER_REQUIRED };
    }
    const now = new Date(asOf), today = civilDate(now);
    const [term, usage, branches, members] = await Promise.all([
      this.prisma.client.companyPlanTerm.findUnique({ where: { companyId: ctx.companyId }, select: { tierKey: true, branchLimit: true,
        employeeLimit: true, capacityOverride: true, billingReceiptAccountId: true, termEndsAt: true, termDisabledAt: true } }),
      this.billing.usage(ctx.companyId),
      planCapacityUsed.branches(this.prisma.client, ctx.companyId),
      planCapacityUsed.members(this.prisma.client, ctx.companyId),
    ]);
    const capacity = term ? effectivePlanCapacity(term, now) : null;
    const termEndsOn = term ? civilDate(term.termEndsAt) : null;
    const monthly = usage.cadence === 'LEGACY_MONTH';
    // A monthly allowance counts the calendar month (a team gift beside it keeps its own expiry, so that
    // mix has no single cycle); a paid one counts the period of the lots it spends, the same lots
    // BillingService.usage() counts.
    let cycle: { startOn: string; endOn: string } | null = null;
    if (monthly && !usage.monthlyAllowance && usage.resetsAt) cycle = { startOn: `${today.slice(0, 7)}-01`, endOn: civilDate(new Date(usage.resetsAt)) };
    if (!monthly) {
      const lots = await this.prisma.client.billingReceiptGrant.findMany({
        where: visibleReceiptLots(ctx.companyId, term?.billingReceiptAccountId ?? null, now), select: { kind: true, serviceStart: true, serviceEnd: true } });
      cycle = singlePaidCycle(lots.filter((lot) => !isReceiptAddOnKind(lot.kind)));
    }
    const pace = usage.limit === null ? 'unlimited' as const
      : cycle ? packagePace({ used: usage.used, limit: usage.limit, ...cycle, today }) : 'no_single_cycle' as const;
    // The package page's own notes: when the monthly allowance restarts, and paid receipts that expire
    // before the package does.
    const resetsOn = monthly && usage.resetsAt && term && Date.parse(usage.resetsAt) < term.termEndsAt.getTime()
      ? civilDate(new Date(usage.resetsAt)) : null;
    const expiresOn = usage.expiresAt ? civilDate(new Date(usage.expiresAt)) : null;
    const paidTier = BILLING_PAID_TIERS.find(tier => tier === term?.tierKey);
    const sourceRefs: SourceRef[] = [{
      label: 'แพ็กเกจของร้าน', module: 'billing', entityType: 'package_usage',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/billing`,
    }];
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        package: { label: paidTier ? customerPackageName({ offerKey: paidTier }, ctx.locale?.startsWith('en') ? 'en' : 'th') : lineCustomerWording(billingPlanLabel(term?.tierKey)), termEndsOn },
        capacity: { branches: room(branches, capacity?.branchLimit ?? null), members: room(members, capacity?.employeeLimit ?? null) },
        receipts: {
          used: usage.used, limit: usage.limit, remaining: usage.remaining, cadence: monthly ? 'รายเดือน เริ่มนับใหม่ทุกต้นเดือน' : 'ตามรอบที่ชำระ',
          // A month ends on its last day; a paid period on the day it runs until, as the package page prints it.
          periodStartOn: cycle?.startOn ?? null, periodEndsOn: cycle && (monthly ? addCivilDays(cycle.endOn, -1) : cycle.endOn),
          resetsOn, expiresOn: expiresOn !== termEndsOn ? expiresOn : null,
          additional: usage.monthlyAllowance ? { remaining: usage.monthlyAllowance.additionalRemaining,
            expiresOn: usage.monthlyAllowance.additionalExpiresAt ? civilDate(new Date(usage.monthlyAllowance.additionalExpiresAt)) : null } : null,
          pace: typeof pace === 'object' ? pace : null,
          paceNote: typeof pace === 'string' ? PACE_NOTES[pace] : null,
        },
      },
      sourceRefs,
      asOf,
      basisVersion: PACKAGE_PACE_FORMULA,
      queryApplied: { timezone: 'Asia/Bangkok', dateBasis: 'bangkok_civil_day', statusBasis: 'current_package_term',
        dataset: 'billing.package_usage', accessScope: 'company' },
    };
  }
}

/** What the answer may say about VAT, from the ACTIVE billing policy — the same treatment every quote charges. */
const VAT_NOTES: Record<BillingTaxTreatment | 'UNKNOWN', string> = {
  INCLUSIVE_VAT_7: 'ราคานี้รวม VAT 7% แล้ว ยอดที่ชำระคือราคานี้',
  EXCLUSIVE_VAT_7: 'ราคานี้ยังไม่รวม VAT 7% ยอดที่ชำระสุทธิคือราคารวม VAT',
  NOT_VAT_REGISTERED: 'ราคานี้ไม่มี VAT บวกเพิ่ม ยอดที่ชำระเท่ากับราคา',
  UNKNOWN: 'ยังไม่มีข้อมูลว่าราคานี้มี VAT หรือไม่',
};
const NOT_ON_SALE: Record<Exclude<BillingOffer['availability'], 'AVAILABLE'>, string> = {
  UNAVAILABLE: 'ยังไม่เปิดให้ซื้อตอนนี้',
  COMING_SOON: 'เร็ว ๆ นี้ ยังไม่เปิดให้ซื้อ',
};

/** A selling price and what the buyer pays for it: `quoteTotals` is the purchase quote's own VAT arithmetic. */
function sellingPrice(offer: BillingOffer, tax: BillingTaxTreatment | null) {
  const totals = quoteTotals(offer.priceSatang, tax);
  return { price: baht(offer.priceSatang), ...(totals.taxSatang ? { vat: baht(totals.taxSatang) } : {}), payable: baht(totals.totalSatang),
    receiptReads: offer.receiptAllowance, ...(offer.availability === 'AVAILABLE' ? {} : { notOnSale: NOT_ON_SALE[offer.availability] }) };
}

/**
 * `billing.get_package_catalog` (advisor spec §5.1a, owner decision 2026-09-30 ~16:00). The packages on
 * sale, read from `BillingService.catalog()` — the public package-page catalog (GET /v1/billing/catalog),
 * so ACTIVE-policy prices and VAT treatment follow the policy with no second price list. The same for
 * every shop and every caller: anyone who talks to the assistant may ask. Selling prices only: the
 * catalog's AI safety budget, its revision stamps and anything else that is not a price a customer pays
 * never leave this function (the whitelist below). Every value is a number or plain Thai an answer may quote.
 */
@Injectable()
export class BillingGetPackageCatalogTool implements ErpReadToolPort {
  toolName = 'billing.get_package_catalog';

  constructor(private readonly billing: BillingService) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = new Date().toISOString();
    const catalog = await this.billing.catalog();
    const offers = new Map(catalog.offers.map((offer) => [`${offer.offerKey}:${offer.interval}`, offer]));
    const packages = [...new Set(catalog.offers.map((offer) => offer.offerKey))].flatMap((tier) => {
      const month = offers.get(`${tier}:month`), year = offers.get(`${tier}:year`);
      if (!month || !year) return [];
      const saving = month.priceSatang * 12 - year.priceSatang;
      const pricedAsMonths = year.priceSatang / month.priceSatang;
      return [{
        name: customerPackageName(month, ctx.locale?.startsWith('en') ? 'en' : 'th'), branches: month.branchLimit, users: month.employeeLimit,
        monthly: sellingPrice(month, catalog.taxTreatment),
        yearly: { ...sellingPrice(year, catalog.taxTreatment), months: 12, averagePerMonth: baht(Math.round(year.priceSatang / 12)),
          ...(saving > 0 ? { savingVersusMonthly: baht(saving) } : {}), ...(Number.isInteger(pricedAsMonths) ? { pricedAsMonths } : {}) },
        menus: packageMenuLabels(month.featureKeys),
      }];
    });
    // The package page is where a package is bought, so only someone who may buy gets its link (spec §2.2).
    const sourceRefs: SourceRef[] = [{
      label: 'แพ็กเกจที่เปิดขาย', module: 'billing', entityType: 'package_catalog', asOf, permissionChecked: true,
      ...(ctx.permissions.includes(PLAN_MANAGE_PERMISSION_KEY) ? { webPath: `/companies/${ctx.companyId}/billing` } : {}),
    }];
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        packages,
        vatNote: VAT_NOTES[catalog.taxTreatment ?? 'UNKNOWN'],
        usersNote: `จำนวนผู้ใช้รวม${THAI_SYSTEM_ROLE_NAMES.OWNER}`,
        yearlyReceiptsNote: 'แบบรายปีได้สิทธิ์อ่านใบเสร็จของทั้งปีทันทีเมื่อชำระสำเร็จ',
        // The package page's own line on every package card ("เครดิต AI 50 เครดิต/เดือน").
        aiCreditPerMonth: DEFAULT_CHAT_CREDIT_SATANG / 100,
      },
      sourceRefs,
      asOf,
      queryApplied: { timezone: 'Asia/Bangkok', dateBasis: 'current_catalog', statusBasis: 'selling_price', dataset: 'billing.package_catalog' },
    };
  }
}
