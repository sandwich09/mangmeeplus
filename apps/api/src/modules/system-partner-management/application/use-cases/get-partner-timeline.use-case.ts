import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PLAN_TIER_PRESETS,
  planTermLockReason,
  type PartnerTimelineDto,
  type PartnerTimelineEntryDto,
  type PlanTierKey,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { receiptQuotaSnapshot } from '../../../line-ai/application/company-ocr-governance';
import { bangkokMonthKey, resolvePlatformAiBudget } from '../../../line-ai/application/company-ai-usage-meter';
import { readAiBudgetReadiness, type AiBudgetScopeReadiness } from '../../../line-ai/application/company-ai-budget-readiness';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';

/** The audit rows that mean "somebody actually got into the web app for this shop" (§8). */
const WEB_ENTRY_ACTIONS = [AuditAction.AUTH_LINE_LIFF_SESSION, AuditAction.AUTH_LINE_HANDOFF_EXCHANGE];

/**
 * P10-L §8 — one shop's story, assembled from rows that already exist.
 *
 * Deliberately NO new log table: every line below is read from the signup application, the audit
 * trail, the OCR/AI meters or the package-change queue. A support call is answered by facts the
 * system was already keeping, which also means the timeline cannot drift away from them.
 *
 * The last line is the exception in kind: "why the assistant is not answering" has never been
 * written down anywhere, so it is DERIVED from the shop's state right now rather than invented as
 * history. That is the question support is actually asked, and the honest answer to it is present
 * tense.
 */
@Injectable()
export class GetPartnerTimelineUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(companyId: string, now = new Date()): Promise<PartnerTimelineDto> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, status: true, createdAt: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${companyId}" not found.`);

    const [signup, webEntry, firstRead, lastRead, lastAi, packageChanges, term] = await Promise.all([
      this.prisma.client.companySignupRequest.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
        select: {
          source: true, createdAt: true, approvedAt: true, autoApproved: true,
          legalAcceptedAt: true, legalDocumentVersion: true, phoneNumber: true,
        },
      }),
      this.prisma.client.auditLog.findFirst({
        where: { companyId, action: { in: WEB_ENTRY_ACTIONS } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.client.companyOcrUsageEvent.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, sourceRoute: true },
      }),
      this.prisma.client.companyOcrUsageEvent.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.client.aiUsageEvent.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.client.packageChangeRequest.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { requestedTierKey: true, status: true, createdAt: true, paymentState:true },
      }),
      this.prisma.client.companyPlanTerm.findUnique({
        where: { companyId },
        select: {
          tierKey: true, monthlySlipLimit: true, warmupUntil: true,
          warmupSlipLimit: true, termEndsAt: true,
          termStartAt: true, renewCount: true, termDisabledAt: true,
        },
      }),
    ]);

    const entries: PartnerTimelineEntryDto[] = [];
    entries.push({
      kind: 'signup_submitted',
      label: signup ? sourceLabel(signup.source) : 'แอดมินเปิดร้านให้',
      at: (signup?.createdAt ?? company.createdAt).toISOString(),
      ...(signup?.phoneNumber ? { detail: `เบอร์ติดต่อ ${signup.phoneNumber}` } : {}),
    });
    if (signup?.approvedAt) {
      entries.push({
        kind: 'signup_approved',
        label: signup.autoApproved ? 'อนุมัติอัตโนมัติ' : 'แอดมินอนุมัติ',
        at: signup.approvedAt.toISOString(),
      });
    }
    if (signup?.legalAcceptedAt) {
      entries.push({
        kind: 'legal_accepted',
        label: 'ยอมรับข้อกำหนด',
        at: signup.legalAcceptedAt.toISOString(),
        ...(signup.legalDocumentVersion ? { detail: `เวอร์ชัน ${signup.legalDocumentVersion}` } : {}),
      });
    }
    if (webEntry) {
      entries.push({ kind: 'first_web_entry', label: 'เข้าหน้าเว็บครั้งแรก', at: webEntry.createdAt.toISOString() });
    }
    if (firstRead) {
      entries.push({
        kind: 'first_receipt',
        label: 'ให้ AI อ่านรูปครั้งแรก',
        at: firstRead.createdAt.toISOString(),
        detail: firstRead.sourceRoute === 'receipt-ocr-line' ? 'ส่งมาทาง LINE' : 'อัปโหลดจากเว็บ',
      });
    }
    const lastActivity = latest(lastRead?.createdAt, lastAi?.createdAt);
    if (lastActivity) {
      entries.push({ kind: 'last_activity', label: 'ใช้งานล่าสุด', at: lastActivity.toISOString() });
    }
    for (const change of packageChanges) {
      const label = PLAN_TIER_PRESETS[change.requestedTierKey as PlanTierKey]?.labelTh ?? change.requestedTierKey;
      entries.push({
        kind: 'package_change',
        label: `ขอเปลี่ยนแพ็กเกจเป็น ${label}`,
        at: change.createdAt.toISOString(),
        detail: change.status==='APPROVED'&&change.paymentState==='STRIPE_APPLIED'?'ซื้อแพ็กเกจและเปิดสิทธิ์แล้ว':PACKAGE_CHANGE_STATUS_TH[change.status] ?? change.status,
      });
    }

    const refusal = await this.currentAiRefusal(companyId, company.status, term, now);
    if (refusal) entries.push({ kind: 'ai_refusal', ...refusal });

    // Oldest first; the derived refusal has no time and belongs at the end, where it reads as
    // "and this is where the shop stands now".
    entries.sort((a, b) => (a.at ?? '9999').localeCompare(b.at ?? '9999'));
    return { entries };
  }

  /**
   * The reasons the assistant refuses, in the order a customer meets them. Returns the first that
   * applies — support wants the thing to fix, not a list.
   */
  private async currentAiRefusal(
    companyId: string,
    companyStatus: string,
    term: {
      tierKey: string; monthlySlipLimit: number; warmupUntil: Date | null;
      warmupSlipLimit: number | null; termEndsAt: Date;
      termStartAt: Date; renewCount: number; termDisabledAt: Date | null;
    } | null,
    now: Date,
  ): Promise<{label:string;detail:string} | null> {
    const all=(detail:string)=>({label:'ตอนนี้ AI ยังทำงานให้ร้านไม่ได้',detail});
    const chat=(detail:string)=>({label:'ตอนนี้ยังคุยกับ AI ไม่ได้',detail});
    const receipt=(detail:string)=>({label:'ตอนนี้ยังอ่านใบเสร็จด้วย AI ไม่ได้',detail});
    if(companyStatus!=='ACTIVE')return all(companyStatus==='DISABLED'
      ? (term?.termDisabledAt ? (planTermLockReason(term)==='no_package' ? 'ยังไม่มีแพ็กเกจ ลูกค้าเลือกซื้อเองได้จากหน้าแพ็กเกจ' : 'แพ็กเกจหมดอายุแล้ว') : 'ร้านถูกพักใช้งานโดยผู้ดูแล')
      : companyStatus==='ARCHIVED'?'ร้านถูกเก็บเข้าประวัติแล้ว':'ร้านยังไม่พร้อมใช้งาน');
    // item 10: a placeholder (never-purchased) term also has termEndsAt<=now, but that is "no
    // package" — the same lock-reason split line 165 already makes for the DISABLED/sweep case.
    if(term&&term.termEndsAt<=now)return all(planTermLockReason(term)==='no_package'?'ยังไม่มีแพ็กเกจ ลูกค้าเลือกซื้อเองได้จากหน้าแพ็กเกจ':'แพ็กเกจหมดอายุแล้ว');
    const channelId=this.config.lineMessagingChannelId;
    if(!channelId)return {label:'ยังใช้ AI ผ่าน LINE ไม่ได้',detail:'ยังไม่ได้ตั้งค่าการเชื่อมต่อ LINE ของระบบ'};
    const linked=await this.prisma.client.externalIdentity.findFirst({where:{provider:'LINE',providerChannelId:channelId,status:'ACTIVE',
      user:{status:'ACTIVE',memberships:{some:{companyId,status:'ACTIVE'}}}},select:{id:true}});
    if(!linked)return {label:'ยังใช้ AI ผ่าน LINE ไม่ได้',detail:'ยังไม่มีสมาชิกคนไหนผูก LINE ปัจจุบัน'};
    const entitled=await loadEntitledFeatureKeys(this.prisma,companyId);
    if(entitled!==null&&!entitled.has('ai_line_assistant'))return {label:'ยังคุยกับ AI ผ่าน LINE ไม่ได้',detail:'ร้านยังไม่ได้เปิดสิทธิ์ผู้ช่วย AI'};
    const monthKey=bangkokMonthKey(now);
    const [quota,aiConfig,ocrUsage,platform]=await Promise.all([
      receiptQuotaSnapshot(this.prisma,companyId,monthKey,now),
      this.prisma.client.companyAiConfiguration.findUnique({where:{companyId},select:{monthlyBudgetSatang:true,ocrEnabled:true,ocrMonthlyLimit:true,receiptQuotaEnforced:true,
        budgetMode:true,chatMonthlyBudgetSatang:true,ocrMonthlyBudgetSatang:true,salesDealChatCreditSatang:true,
        salesDealChatCreditEndsAt:true,budgetConfigVersion:true,pendingBudgetPolicy:true}}),
      this.prisma.client.companyOcrMonthlyUsage.findUnique({where:{companyId_monthKey:{companyId,monthKey}},select:{usedCount:true}}),
      resolvePlatformAiBudget(this.prisma,this.config,true),
    ]);
    // §11.4: the SAME projection admission uses, never `monthlyBudgetSatang` + total spend. Under
    // SHARED, CHAT has its own cap while OCR remains inside TOTAL.
    const money=await readAiBudgetReadiness(this.prisma.client,{companyId,monthKey,row:aiConfig,
      totalSatang:aiConfig?.monthlyBudgetSatang??platform.monthlyBudgetSatang});
    // The reason can be any of three (`SPLIT_CAPS_MISSING`, `SPLIT_EXCEEDS_TOTAL`,
    // `POLICY_MALFORMED`), so this line must not assert one of them. The exact red notice with what
    // to fix lives on the partner page, which is where the operator is going anyway.
    if(money.policyInvalid)return all('การตั้งค่าเครดิต AI ของร้านไม่ถูกต้อง ระบบจึงปฏิเสธการเรียก AI ทุกช่องทาง ดูเหตุผลและแก้ได้ที่หมวด AI และโควตา ของร้านนี้');
    if(money.total!=='OK')return all('เครดิต AI ของเดือนนี้หมดแล้ว');
    // Both shares gone while the total still has money: neither a chat-only nor a receipt-only line
    // is true, and saying "the other share is still there" would be a lie.
    if(money.chat!=='OK'&&money.ocr!=='OK')return all('ใช้ AI ทั้งส่วนแชตและส่วนอ่านเอกสารของเดือนนี้ไม่ได้แล้ว แม้เครดิตรวมจะยังเหลือ ดูเพดานแต่ละส่วนได้ที่หมวด AI และโควตา');
    if(money.chat!=='OK')return chat(shareDetail(money.chat,'แชต','ส่วนอ่านเอกสารยังเหลือ'));
    if(money.ocr!=='OK')return receipt(shareDetail(money.ocr,'อ่านเอกสาร','ส่วนแชตยังเหลือ'));
    if(entitled!==null&&!entitled.has('expenses.upload'))return receipt('ร้านยังไม่ได้เปิดสิทธิ์อัปโหลดใบเสร็จ');
    if(aiConfig?.ocrEnabled===false)return receipt('ผู้ดูแลปิดการอ่านเอกสารด้วย AI ไว้');
    if(aiConfig?.ocrMonthlyLimit!=null&&(ocrUsage?.usedCount??0)>=aiConfig.ocrMonthlyLimit)return receipt('ใช้จำนวนครั้งอ่านเอกสารของเดือนนี้ครบแล้ว');
    const enforced=quota.cadence==='PAID_GRANTS'||(aiConfig?.receiptQuotaEnforced??this.config.receiptQuotaEnforced)===true;
    if(enforced&&quota.planLimit!==null&&quota.usedCount>=quota.planLimit)return receipt(quota.cadence==='PAID_GRANTS'||quota.monthlyAllowance
      ?'ใช้จำนวนใบเสร็จที่มีอยู่ครบแล้ว':`อ่านใบเสร็จครบ ${quota.planLimit} ใบของเดือนนี้แล้ว`);
    return null;
  }

}

const PACKAGE_CHANGE_STATUS_TH: Record<string, string> = {
  OPEN: 'รอแอดมิน',
  APPROVED: 'เปลี่ยนให้แล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

function sourceLabel(source: string): string {
  return source === 'line-oa' ? 'สมัครจาก LINE' : 'สมัครจากเว็บ';
}

/**
 * One share of a SPLIT budget, in the customer's terms. `CLOSED` is a cap of 0 that an operator
 * chose — saying "หมดแล้ว" for it would send support hunting for spend that never happened.
 */
function shareDetail(state: AiBudgetScopeReadiness, share: string, rest: string): string {
  return state === 'CLOSED'
    ? `ผู้ดูแลตั้งเพดานเครดิต AI ส่วน${share}ไว้ 0 บาท จึงยังใช้ส่วนนี้ไม่ได้`
    : `เครดิต AI ส่วน${share}ของเดือนนี้หมดแล้ว แต่${rest}`;
}

function latest(...dates: Array<Date | undefined>): Date | undefined {
  return dates.filter((date): date is Date => date !== undefined)
    .sort((a, b) => b.getTime() - a.getTime())[0];
}
