import { isLineAiRolloutAllowed } from '@watchdog-bms/config';
import { Injectable } from '@nestjs/common';
import { parsePublicLookupRequest, publicLookupPolicy, publicQueryNeedsRephrase, type ToolResult } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import type { ErpToolContext } from '../domain/ports/erp-read-tool.port';

/** API-owned public-query admission. The Gateway executes the approved request in its existing
 * serial provider-budget context. This tool never presents admission data as searched facts. */
@Injectable()
export class PublicLookupAdmissionTool {
  readonly toolName = 'public.lookup';
  constructor(private readonly config: AppConfigService, private readonly prisma: PrismaService) {}
  async execute(ctx: ErpToolContext, raw: unknown): Promise<ToolResult> {
    const base = { toolName: this.toolName, sourceRefs: [], asOf: new Date().toISOString() };
    const unavailable = (code: string): ToolResult => ({ ...base, status: 'unavailable', errorCode: code });
    if (!ctx.permissions.includes('ai.tool.invoke')) return { ...base, status: 'forbidden', errorCode: 'FORBIDDEN' };
    if (!this.config.lineAiPublicLookupEnabled || this.config.lineAiReliabilityV2Mode !== 'on'
      || !isLineAiRolloutAllowed(this.config.lineAiReliabilityV2CompanyIds, ctx.companyId)) return unavailable('PUBLIC_POLICY_UNAVAILABLE');
    const request = parsePublicLookupRequest(raw);
    if (!request) return unavailable('PUBLIC_QUERY_REQUIRES_REPHRASE');
    const policy = publicLookupPolicy(request);
    if (!policy) return unavailable('PUBLIC_POLICY_UNAVAILABLE');
    // Read only the current, already-authorized private actor's display names for a local egress
    // deny check. Group/general requests use their separate public admission, never this tool.
    const company = await this.prisma.client.company.findUnique({ where: { id: ctx.companyId }, select: { name: true, status: true } });
    if (!company || company.status !== 'ACTIVE') return unavailable('PUBLIC_POLICY_UNAVAILABLE');
    const privateValues = [ctx.companyId, ctx.userId, ctx.membershipId, ctx.chatKeyHash, company.name].filter((value): value is string => !!value);
    if (publicQueryNeedsRephrase(request.publicQuestion, privateValues)) return unavailable('PUBLIC_QUERY_REQUIRES_REPHRASE');
    return { ...base, status: 'ok', sourceRefs: [{ label: 'ตรวจสิทธิ์ค้นแหล่งข้อมูลสาธารณะแล้ว', module: 'public', entityType: 'public_lookup_admission', entityId: request.sourcePolicyId, permissionChecked: true }],
      data: { admissionOnly: true, approvedLookup: { request, policy } } };
  }
}
