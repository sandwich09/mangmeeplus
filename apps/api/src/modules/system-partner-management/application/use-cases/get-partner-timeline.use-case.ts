import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PLAN_TIER_PRESETS,
  type PartnerTimelineDto,
  type PartnerTimelineEntryDto,
  type PlanTierKey,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { receiptQuotaSnapshot } from '../../../line-ai/application/company-ocr-governance';
import { bangkokMonthKey, resolvePlatformAiBudget } from '../../../line-ai/application/company-ai-usage-meter';
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
    } | null,
    now: Date,
  ): Promise<{label:string;detail:string} | null> {
    const all=(detail:string)=>({label:'ตอนนี้ AI ยังทำงานให้ร้านไม่ได้',detail});
    const receipt=(detail:string)=>({label:'ตอนนี้ยังอ่านใบเสร็จด้วย AI ไม่ได้',detail});
    if(companyStatus!=='ACTIVE')return all(companyStatus==='DISABLED'?'ร้านถูกพักใช้งาน':companyStatus==='ARCHIVED'?'ร้านถูกเก็บเข้าประวัติแล้ว':'ร้านยังไม่พร้อมใช้งาน');
    if(term&&term.termEndsAt<=now)return all('แพ็กเกจหมดอายุแล้ว');
    const channelId=this.config.lineMessagingChannelId;
    if(!channelId)return {label:'ยังใช้ AI ผ่าน LINE ไม่ได้',detail:'ยังไม่ได้ตั้งค่าการเชื่อมต่อ LINE ของระบบ'};
    const linked=await this.prisma.client.externalIdentity.findFirst({where:{provider:'LINE',providerChannelId:channelId,status:'ACTIVE',
      user:{status:'ACTIVE',memberships:{some:{companyId,status:'ACTIVE'}}}},select:{id:true}});
    if(!linked)return {label:'ยังใช้ AI ผ่าน LINE ไม่ได้',detail:'ยังไม่มีสมาชิกคนไหนผูก LINE ปัจจุบัน'};
    const entitled=await loadEntitledFeatureKeys(this.prisma,companyId);
    if(entitled!==null&&!entitled.has('ai_line_assistant'))return {label:'ยังคุยกับ AI ผ่าน LINE ไม่ได้',detail:'ร้านยังไม่ได้เปิดสิทธิ์ผู้ช่วย AI'};
    const monthKey=bangkokMonthKey(now);
    const [quota,aiUsage,aiConfig,ocrUsage,platform]=await Promise.all([
      receiptQuotaSnapshot(this.prisma,companyId,monthKey,now),
      this.prisma.client.companyAiMonthlyUsage.findUnique({where:{companyId_monthKey:{companyId,monthKey}},select:{costSatang:true}}),
      this.prisma.client.companyAiConfiguration.findUnique({where:{companyId},select:{monthlyBudgetSatang:true,ocrEnabled:true,ocrMonthlyLimit:true,receiptQuotaEnforced:true}}),
      this.prisma.client.companyOcrMonthlyUsage.findUnique({where:{companyId_monthKey:{companyId,monthKey}},select:{usedCount:true}}),
      resolvePlatformAiBudget(this.prisma,this.config,true),
    ]);
    const budget=aiConfig?.monthlyBudgetSatang??platform.monthlyBudgetSatang;
    if((aiUsage?.costSatang??0)>=budget)return all('ใช้งบ AI ของเดือนนี้ครบแล้ว');
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

function latest(...dates: Array<Date | undefined>): Date | undefined {
  return dates.filter((date): date is Date => date !== undefined)
    .sort((a, b) => b.getTime() - a.getTime())[0];
}
