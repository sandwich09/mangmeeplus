import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ALL_BRANCH_ROLE_KEYS, scrubRecordText, type RequestContext, type ToolResult } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { CreateEmployeeUseCase } from '../../employee-access/application/use-cases/create-employee.use-case';
import { UpdateEmployeeUseCase } from '../../employee-access/application/use-cases/update-employee.use-case';
import { SetEmployeeStatusUseCase } from '../../employee-access/application/use-cases/set-employee-status.use-case';
import { IssueEmployeeLineLinkTokenUseCase } from '../../employee-access/application/use-cases/issue-employee-line-link-token.use-case';
import { ListRolesUseCase } from '../../employee-access/application/use-cases/list-roles.use-case';
import { CreateEmployeeDto, UpdateEmployeeDto } from '../../employee-access/presentation/http/employee-access.dtos';
import { CreateBranchDto, UpdateBranchDto } from '../../data-model-core/presentation/http/data-model-core.dtos';
import { CreateBranchUseCase } from '../../data-model-core/application/use-cases/create-branch.use-case';
import { UpdateBranchUseCase } from '../../data-model-core/application/use-cases/update-branch.use-case';
import { BILLING_PAID_TIERS, billingOffer } from '@watchdog-bms/contracts';
import { assertBranchLimit, assertEmployeeLimit, planCapacityUsed } from '../../system-partner-management/application/plan-term-limit';
import { LineDraftPreviewStore, LINE_DRAFT_PREVIEW_TTL_SECONDS } from '../../expenses/application/services/line-draft-preview.store';
import { canonicalDeliveryJson, deliveryHash } from '../domain/logic/line-delivery-plan.logic';
import type { ErpReadToolPort, ErpToolContext } from '../domain/ports/erp-read-tool.port';
import { lineTeamRoleName } from './use-cases/erp-team-tools.use-case';
import type { ExpenseActionControl, ExpenseActionPreview, ExpenseActionResult } from './line-expense-action.service';

export const TEAM_ACTION_LABELS = { EMPLOYEE_CREATE: 'เพิ่มพนักงาน', EMPLOYEE_UPDATE: 'แก้ไขพนักงาน', EMPLOYEE_DISABLE: 'ปิดใช้งาน', EMPLOYEE_ENABLE: 'เปิดใช้งาน', BRANCH_CREATE: 'เพิ่มสาขา', BRANCH_UPDATE: 'แก้ไขสาขา' } as const;
export type TeamAction = keyof typeof TEAM_ACTION_LABELS;
type Payload = { action: TeamAction; employeeId?: string; branchId?: string; roleId?: string; roleKey?: string; fields: Record<string, any>; scope?: Record<string, any> };
type TeamInput = { previewId: string; companyId: string; userId: string; membershipId: string; chatKeyHash: string; conversationId: string; epoch: number; input: Record<string, unknown>; field: string };
type Entry = { previewId: string; companyId: string; userId: string; membershipId: string; chatKeyHash: string; conversationId: string; epoch: number;
  requestId: string; expiresAt: string; payload: Payload; digest: string; preview: ExpenseActionPreview;
  progress?: { employeeId: string; scoped?: boolean; completed?: boolean }; applied?: { reply: string; preview: ExpenseActionPreview; source: Payload; digest: string } };
const EXPIRED = 'การ์ดนี้ใช้ไม่ได้แล้วค่ะ ขอเตรียมการ์ดใหม่อีกครั้ง';
const CHANGED = 'ข้อมูลเปลี่ยนไปแล้วค่ะ ขอเตรียมการ์ดใหม่ก่อนยืนยันอีกครั้ง';
const PERMISSION: Record<TeamAction, string[]> = { EMPLOYEE_CREATE: ['access.employee.create', 'access.employee.update', 'access.employee.line_link.issue'], EMPLOYEE_UPDATE: ['access.employee.update'], EMPLOYEE_DISABLE: ['access.employee.disable'], EMPLOYEE_ENABLE: ['access.employee.disable'], BRANCH_CREATE: ['company.branch.manage'], BRANCH_UPDATE: ['company.branch.manage'] };

export function teamActionRefusal(error: unknown): string {
  if (!(error instanceof HttpException)) throw error;
  const response = error.getResponse();
  const code = typeof response === 'object' && response ? String((response as any).code ?? '') : '';
  const message = error.message;
  if (code === 'plan_branch_limit_exceeded' || /แพ็กเกจ.*พนักงาน/u.test(message)) return 'แพ็กเกจปัจจุบันใช้จำนวนสาขาหรือพนักงานครบแล้วค่ะ พิมพ์ “อัปเกรดแพ็กเกจ” เพื่อเลือกแพ็กเกจได้ค่ะ';
  if (/own role/u.test(message)) return 'เปลี่ยนหน้าที่ของตัวเองไม่ได้ค่ะ';
  if (/Owner and platform/u.test(message)) return 'เปลี่ยนหน้าที่หรือปิดสิทธิ์เจ้าของกิจการไม่ได้ค่ะ';
  if (/requires access to all branches/u.test(message)) return 'หน้าที่นี้ต้องเข้าถึงทุกสาขาค่ะ';
  if (/branch scope|branches are invalid/u.test(message)) return 'จัดการได้เฉพาะพนักงานและสาขาที่คุณมีสิทธิ์ค่ะ';
  if (code === 'employee_existing_user') return 'ชื่อบัญชีนี้มีผู้ใช้อยู่แล้วค่ะ ขอชื่อบัญชีใหม่สำหรับพนักงานคนนี้';
  if (code.includes('conflict') || /already exists/u.test(message)) return 'ข้อมูลนี้มีอยู่แล้วค่ะ กรุณาตรวจชื่อบัญชี เบอร์โทร อีเมล หรือรหัสสาขาอีกครั้ง';
  if (error instanceof ForbiddenException) return 'คุณยังไม่มีสิทธิ์ทำรายการนี้ค่ะ';
  if (error instanceof ConflictException) return 'สถานะปัจจุบันยังทำรายการนี้ไม่ได้ค่ะ';
  if (error instanceof BadRequestException && /[ก-๙]/u.test(message)) return message;
  return 'ไม่พบข้อมูลที่คุณจัดการได้ค่ะ';
}

/** Reuses the web wizard and confirm-card transport; no model-reachable apply endpoint. */
@Injectable()
export class LineTeamActionService {
  constructor(private readonly prisma: PrismaService, private readonly store: LineDraftPreviewStore<Entry>, private readonly config: AppConfigService,
    private readonly createEmployee: CreateEmployeeUseCase, private readonly updateEmployee: UpdateEmployeeUseCase,
    private readonly statusEmployee: SetEmployeeStatusUseCase, private readonly issueLink: IssueEmployeeLineLinkTokenUseCase,
    private readonly roles: ListRolesUseCase, private readonly createBranch: CreateBranchUseCase, private readonly updateBranch: UpdateBranchUseCase) {}
  private get inputs() { return this.store as unknown as LineDraftPreviewStore<TeamInput>; }
  private key(chat: string) { return `team-action:${chat}`; }
  private owner(ctx: RequestContext, chat: string) {
    return this.prisma.client.aiConversation.findFirst({ where: { companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId, chatKeyHash: chat, channelKind: 'USER', channel: 'line' } });
  }
  private authorize(ctx: RequestContext, action: TeamAction) {
    if (!PERMISSION[action].every(key => ctx.permissions.includes(key))) throw new ForbiddenException();
  }
  private sign(entry: Entry) {
    const { preview: _preview, progress: _progress, applied: _applied, ...facts } = entry;
    return `${entry.previewId}.${createHmac('sha256', this.config.aiGatewayInternalSecret!).update('line-team-action-v1\0').update(canonicalDeliveryJson({ ...facts, preview: { ...entry.preview, token: '' } })).digest('base64url')}`;
  }
  private async bound(ctx: RequestContext, chat: string, entry: Entry, token: string) {
    if (!this.config.aiGatewayInternalSecret || entry.companyId !== ctx.companyId || entry.userId !== ctx.userId || entry.membershipId !== ctx.membershipId
      || entry.chatKeyHash !== this.key(chat) || Date.parse(entry.expiresAt) <= Date.now()) return false;
    const owner = await this.owner(ctx, chat), expected = this.sign(entry);
    return owner?.id === entry.conversationId && owner.lifecycleEpoch === entry.epoch && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }
  private command(ctx: RequestContext) {
    return { companyId: ctx.companyId, requestingUserId: ctx.userId, requestId: ctx.requestId, requesterPermissions: ctx.permissions,
      requesterEntitlementDeniedPermissions: ctx.entitlementDeniedPermissions, requesterRoles: ctx.roles, requesterBranchIds: ctx.scopes.branchIds };
  }
  private async employee(ctx: RequestContext, id: string) {
    const row = await this.prisma.client.employeeAccessProfile.findFirst({ where: { companyId: ctx.companyId, id }, include: { membership: { include: { roles: { include: { role: true } }, branchScopes: true } } } });
    if (!row) throw new ForbiddenException();
    const m = row.membership, allowed = ctx.scopes.branchIds, ids = [...m.branchScopes.map(s => s.branchId), ...(m.defaultBranchId ? [m.defaultBranchId] : [])];
    if (allowed !== undefined && (m.branchScopeMode === 'ALL_BRANCHES' || !ids.length || ids.some(id => !allowed.includes(id)))) throw new ForbiddenException();
    return row;
  }
  private async snapshot(ctx: RequestContext, payload: Payload) {
    this.authorize(ctx, payload.action);
    const allowed = ctx.scopes.branchIds;
    if (allowed !== undefined && payload.scope && (payload.scope.branchScopeMode === 'ALL_BRANCHES' || [...(payload.scope.branchIds ?? []), ...(payload.scope.defaultBranchId ? [payload.scope.defaultBranchId] : [])].some(id => !allowed.includes(id)))) throw new ForbiddenException();
    const employee = payload.employeeId ? await this.employee(ctx, payload.employeeId) : undefined;
    const branch = payload.branchId ? await this.prisma.client.branch.findFirst({ where: { companyId: ctx.companyId, id: payload.branchId, ...(ctx.scopes.branchIds !== undefined && payload.action !== 'BRANCH_CREATE' ? { id: { in: ctx.scopes.branchIds, equals: payload.branchId } } : {}) } }) : undefined;
    if (payload.branchId && (!branch || payload.action !== 'BRANCH_UPDATE' && branch.status !== 'ACTIVE')) throw new ForbiddenException();
    const role = payload.roleId ? (await this.roles.execute(ctx.companyId, { permissions: ctx.permissions, entitlementDeniedPermissions: ctx.entitlementDeniedPermissions, isOwner: ctx.roles.includes('OWNER') })).find(r => r.id === payload.roleId) : undefined;
    if (payload.roleId && (!role?.assignableByCurrentUser || role.status !== 'ACTIVE')) throw new ForbiddenException();
    return deliveryHash({ employee, branch, role });
  }
  private async dto<T extends object>(ctor: new () => T, fields: Record<string, unknown>): Promise<T> {
    const dto = plainToInstance(ctor, fields);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) throw new BadRequestException('ขอข้อมูลให้ครบและถูกต้องตามแบบฟอร์มค่ะ');
    return dto;
  }
  async capacityReply(ctx: RequestContext, action: 'BRANCH_CREATE' | 'EMPLOYEE_CREATE', language: 'th' | 'en' = 'th'): Promise<string | null> {
    try {
      if (action === 'BRANCH_CREATE') await assertBranchLimit(this.prisma, ctx.companyId);
      else await assertEmployeeLimit(this.prisma, ctx.companyId);
      return null;
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() !== 422) throw error;
      const response = error.getResponse();
      const code = typeof response === 'object' && response ? String((response as any).code ?? '') : '';
      if (code !== 'plan_branch_limit_exceeded' && !/แพ็กเกจ.*พนักงาน/u.test(error.message)) throw error;
      const used = action === 'BRANCH_CREATE' ? await planCapacityUsed.branches(this.prisma.client, ctx.companyId) : await planCapacityUsed.members(this.prisma.client, ctx.companyId);
      const offer = BILLING_PAID_TIERS.map(tier => billingOffer(tier, 'month')).find(item => action === 'BRANCH_CREATE' ? item.branchLimit > used : item.employeeLimit > used);
      const price = offer ? (offer.priceSatang / 100).toLocaleString('en-US') : '';
      const pack = offer && (language === 'en' ? `${offer.offerKey.split('_')[0]} ${price} baht` : `${offer.label.replace(/\s*\(.*\)$/u, '')} ${price} บาท`);
      return language === 'en' ? `Your current package has reached its ${action === 'BRANCH_CREATE' ? 'branch' : 'employee'} limit; ${pack ? `choose ${pack} for more capacity` : 'contact the team for more capacity'}.`
        : `แพ็กเกจปัจจุบันใช้จำนวน${action === 'BRANCH_CREATE' ? 'สาขา' : 'พนักงาน'}ครบแล้วค่ะ ${pack ? `เลือกแพ็กเกจ ${pack} เพื่อเพิ่มได้ค่ะ` : 'ติดต่อทีมงานเพื่อเพิ่มจำนวนได้ค่ะ'}`;
    }
  }
  async preview(ctx: RequestContext, chat: string | undefined, input: Record<string, unknown>): Promise<{ reply: string; preview?: ExpenseActionPreview }> {
    if (!chat || !ctx.membershipId || !this.config.aiGatewayInternalSecret || !this.store.available) return { reply: 'กรุณาทำรายการในแชตส่วนตัวค่ะ' };
    const owner = await this.owner(ctx, chat);
    if (!owner) return { reply: 'กรุณาทำรายการในแชตส่วนตัวค่ะ' };
    const action = input.action as TeamAction;
    if (!Object.hasOwn(TEAM_ACTION_LABELS, action)) return { reply: 'ต้องการจัดการพนักงานหรือสาขาอย่างไรคะ' };
    try {
      this.authorize(ctx, action);
      if (action === 'BRANCH_CREATE' || action === 'EMPLOYEE_CREATE') {
        const limit = await this.capacityReply(ctx, action);
        if (limit) return { reply: limit };
      }
      // Flat named inputs only: model-provided commands, ids and context never reach a use-case.
      const text = (key: string) => typeof input[key] === 'string' ? (input[key] as string).trim() : '';
      const payload: Payload = { action, fields: {} }, details: string[] = [];
      const ask = async (field: string, reply: string) => {
        await this.store.discard(ctx.companyId, this.key(chat));
        const saved = await this.inputs.save({ previewId: randomUUID(), companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId!, chatKeyHash: `team-input:${chat}`, conversationId: owner.id, epoch: owner.lifecycleEpoch, input, field });
        return { reply: saved ? reply : 'ยังเตรียมรายการไม่ได้ค่ะ กรุณาลองอีกครั้ง' };
      };
      let name = text('displayName') || text('name');
      if (action.startsWith('EMPLOYEE_') && action !== 'EMPLOYEE_CREATE') {
        if (!text('employeeName')) return ask('employeeName', 'ต้องการจัดการพนักงานชื่ออะไรคะ');
        const matches = await this.prisma.client.employeeAccessProfile.findMany({ where: { companyId: ctx.companyId, displayName: text('employeeName') }, select: { id: true }, take: 2 });
        if (matches.length !== 1) return ask('employeeName', 'ขอชื่อพนักงานเต็มเพื่อเลือกให้ตรงคนค่ะ');
        payload.employeeId = matches[0]!.id;
        const employee = await this.employee(ctx, payload.employeeId);
        name = employee.displayName;
        if (action === 'EMPLOYEE_ENABLE' && employee.status !== 'ACTIVE') await assertEmployeeLimit(this.prisma, ctx.companyId);
      }
      if (action === 'EMPLOYEE_CREATE' || action === 'EMPLOYEE_UPDATE' && text('roleName')) {
        if (!text('roleName')) return ask('roleName', 'ให้พนักงานทำหน้าที่อะไรคะ');
        const roles = (await this.roles.execute(ctx.companyId, { permissions: ctx.permissions, entitlementDeniedPermissions: ctx.entitlementDeniedPermissions, isOwner: ctx.roles.includes('OWNER') })).filter(r => lineTeamRoleName(r) === text('roleName'));
        if (roles.length !== 1) return ask('roleName', 'ขอชื่อหน้าที่ให้ตรงกับหน้าที่ที่ตั้งไว้ค่ะ');
        const role = roles[0]!;
        if (!role.assignableByCurrentUser) throw new ForbiddenException();
        payload.roleId = role.id; payload.roleKey = role.key; payload.fields.roleIds = [role.id];
        details.push(`หน้าที่: ${scrubRecordText(text('roleName'), 120)}`);
      }
      if (text('branchName')) {
        const rows = await this.prisma.client.branch.findMany({ where: { companyId: ctx.companyId, name: text('branchName'), ...(action.startsWith('EMPLOYEE_') ? { status: 'ACTIVE' as const } : {}), ...(ctx.scopes.branchIds !== undefined ? { id: { in: ctx.scopes.branchIds } } : {}) }, take: 2 });
        if (rows.length !== 1) return ask('branchName', 'ขอชื่อสาขาให้ตรงกับสาขาที่คุณจัดการได้ค่ะ');
        payload.branchId = rows[0]!.id;
        details.push(`สาขา: ${scrubRecordText(rows[0]!.name, 120)}`);
        if (action.startsWith('EMPLOYEE_')) payload.scope = { branchScopeMode: 'SELECTED_BRANCHES', branchIds: [payload.branchId], defaultBranchId: payload.branchId };
        if (action === 'BRANCH_UPDATE') name = rows[0]!.name;
      }
      if (action === 'EMPLOYEE_CREATE') {
        await assertEmployeeLimit(this.prisma, ctx.companyId);
        const required = { displayName: 'ชื่อพนักงาน', username: 'ชื่อบัญชี', dateOfBirth: 'วันเกิดเป็นปี-เดือน-วัน เช่น 1990-01-31', identityType: 'ประเภทบัตร', identityNumber: 'เลขบัตรหรือพาสปอร์ต', phoneNumber: 'เบอร์โทร' };
        for (const [key, label] of Object.entries(required)) if (!text(key)) return ask(key, `ขอ${label}ของพนักงานค่ะ`);
        if (payload.roleKey && ALL_BRANCH_ROLE_KEYS.includes(payload.roleKey)) {
          if (ctx.scopes.branchIds !== undefined) throw new ForbiddenException();
          payload.scope = { branchScopeMode: 'ALL_BRANCHES', branchIds: [], defaultBranchId: null };
          details.push('เข้าถึงทุกสาขาตามหน้าที่ค่ะ');
        } else if (!payload.scope) return ask('branchName', 'ให้พนักงานประจำสาขาไหนคะ');
        for (const key of [...Object.keys(required), 'email']) if (text(key)) payload.fields[key] = text(key);
        payload.fields = { ...await this.dto(CreateEmployeeDto, payload.fields) };
        details.push(`วันเกิด: ${new Date(text('dateOfBirth')).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}`, `เลขบัตรหรือพาสปอร์ตลงท้าย ${text('identityNumber').slice(-4)}`, `ชื่อบัญชี: ${scrubRecordText(text('username'), 40)}`, `เบอร์โทร: ${scrubRecordText(text('phoneNumber'), 20)}`, ...(text('email') ? [`อีเมล: ${scrubRecordText(text('email'), 254)}`] : []), 'สร้างบัญชี กำหนดสาขา เปิดใช้งาน และออกลิงก์เชื่อม LINE ค่ะ');
      } else if (action === 'EMPLOYEE_UPDATE') {
        if (!payload.roleId && !payload.scope) return { reply: 'ต้องการเปลี่ยนหน้าที่หรือสาขาเป็นอะไรคะ' };
        payload.fields = { ...await this.dto(UpdateEmployeeDto, { ...payload.fields, ...payload.scope }) };
      } else if (action === 'BRANCH_CREATE' || action === 'BRANCH_UPDATE') {
        if (action === 'BRANCH_UPDATE' && !payload.branchId) return ask('branchName', 'ต้องการแก้ไขสาขาชื่ออะไรคะ');
        if (action === 'BRANCH_UPDATE' && (text('code') || text('type'))) return { reply: 'รหัสและประเภทสาขาเปลี่ยนหลังสร้างไม่ได้ค่ะ' };
        if (action === 'BRANCH_CREATE') {
          await assertBranchLimit(this.prisma, ctx.companyId);
          for (const [key, label] of Object.entries({ name: 'ชื่อสาขา', code: 'รหัสสาขา', type: 'ประเภทสาขา' })) if (!text(key)) return ask(key, `ขอ${label}ค่ะ`);
        }
        for (const key of ['name', 'code', 'type']) if (text(key)) payload.fields[key] = text(key);
        if (text('address')) payload.fields.addressJson = { addressLine: text('address') };
        if (!Object.keys(payload.fields).length) return { reply: 'ต้องการเปลี่ยนชื่อหรือที่อยู่สาขาเป็นอะไรคะ' };
        payload.fields = { ...await (action === 'BRANCH_CREATE' ? this.dto(CreateBranchDto, payload.fields) : this.dto(UpdateBranchDto, payload.fields)) };
        details.push(...(text('code') ? [`รหัสสาขา: ${scrubRecordText(text('code'), 40)}`] : []), ...(text('name') ? [`ชื่อสาขา: ${scrubRecordText(text('name'), 200)}`] : []), ...(text('type') ? [`ประเภท: ${{ HEAD_OFFICE: 'สำนักงานใหญ่', BRANCH: 'สาขา', ONLINE: 'ออนไลน์', WAREHOUSE: 'คลังสินค้า' }[text('type')] ?? ''}`] : []), ...(text('address') ? [`ที่อยู่: ${scrubRecordText(text('address'), 300)}`] : []));
      }
      const digest = await this.snapshot(ctx, payload), previewId = `team_${randomUUID()}`, expiresAt = new Date(Date.now() + LINE_DRAFT_PREVIEW_TTL_SECONDS * 1000).toISOString();
      const preview: ExpenseActionPreview = { previewId, expiresAt, token: '', action, details, summary: 'กรุณาตรวจรายละเอียดแล้วกดยืนยันค่ะ', record: { vendorName: scrubRecordText(name, 160), amount: '', currency: '', date: '', status: 'รอยืนยัน', nextStatus: TEAM_ACTION_LABELS[action] } };
      const entry: Entry = { previewId, companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId, chatKeyHash: this.key(chat), conversationId: owner.id, epoch: owner.lifecycleEpoch, requestId: ctx.requestId, expiresAt, payload, digest, preview };
      preview.token = this.sign(entry);
      await this.inputs.discard(ctx.companyId, `team-input:${chat}`);
      return await this.store.save(entry) ? { reply: preview.summary, preview } : { reply: 'กำลังดำเนินการคำขอก่อนหน้าค่ะ กรุณาลองอีกครั้ง' };
    } catch (error) { return { reply: teamActionRefusal(error) }; }
  }
  async answer(ctx: RequestContext, chat: string, text: string): Promise<{ reply: string; preview?: ExpenseActionPreview } | null> {
    const entry = await this.inputs.load(ctx.companyId, `team-input:${chat}`);
    if (!entry || entry.userId !== ctx.userId || entry.membershipId !== ctx.membershipId) return null;
    const owner = await this.owner(ctx, chat);
    if (!owner || owner.id !== entry.conversationId || owner.lifecycleEpoch !== entry.epoch) return null;
    if (/^(?:ไม่ทำ|ยกเลิก)(?:ค่ะ|คะ)?$/u.test(text.trim())) { await this.inputs.discard(ctx.companyId, entry.chatKeyHash); return { reply: 'ไม่ทำรายการนี้ค่ะ' }; }
    if (!text.trim() || text.length > 500) return { reply: 'ขอข้อมูลสั้น ๆ ตามช่องที่ถามค่ะ' };
    let value = text.trim();
    if (entry.field === 'identityType') value = /^(?:บัตรประชาชน|บัตร|ไทย|THAI_NATIONAL_ID)$/iu.test(value) ? 'THAI_NATIONAL_ID' : /^(?:พาสปอร์ต|หนังสือเดินทาง|PASSPORT)$/iu.test(value) ? 'PASSPORT' : value;
    if (entry.field === 'type') value = ({ 'สาขา': 'BRANCH', 'สำนักงานใหญ่': 'HEAD_OFFICE', 'ออนไลน์': 'ONLINE', 'คลังสินค้า': 'WAREHOUSE' } as Record<string, string>)[value] ?? value;
    return this.preview(ctx, chat, { ...entry.input, [entry.field]: value });
  }
  async pending(ctx: RequestContext, chat: string, requestId?: string) {
    const entry = await this.store.load(ctx.companyId, this.key(chat));
    if (!entry || requestId && requestId !== entry.requestId || !await this.bound(ctx, chat, entry, entry.preview.token)) return null;
    try { return await this.snapshot(ctx, entry.payload) === entry.digest ? entry.preview : null; } catch { return null; }
  }
  async appliedPreview(ctx: RequestContext, chat: string, token: string) {
    const entry = await this.store.loadApplied(ctx.companyId, this.key(chat));
    if (!entry?.applied || !await this.bound(ctx, chat, entry, token)) return null;
    try { return await this.snapshot(ctx, entry.applied.source) === entry.applied.digest ? entry.applied.preview : null; } catch { return null; }
  }
  async apply(ctx: RequestContext, chat: string, control: ExpenseActionControl): Promise<ExpenseActionResult> {
    const previous = await this.store.loadApplied(ctx.companyId, this.key(chat));
    if (previous?.applied && await this.bound(ctx, chat, previous, control.token)) {
      try { if (await this.snapshot(ctx, previous.applied.source) !== previous.applied.digest) return { status: 'blocked', reply: CHANGED }; return { status: 'replayed', reply: previous.applied.reply, preview: previous.applied.preview }; } catch (error) { return { status: 'blocked', reply: teamActionRefusal(error) }; }
    }
    const claim = await this.store.claimCurrent(ctx.companyId, this.key(chat), control.token.split('.')[0]!);
    if (!claim) return { status: 'blocked', reply: EXPIRED };
    const entry = claim.entry;
    if (previous?.previewId === entry.previewId) entry.progress = previous.progress;
    try {
      if (!await this.bound(ctx, chat, entry, control.token)) return { status: 'blocked', reply: EXPIRED };
      if (control.action === 'expense_action_cancel') { await this.store.discard(ctx.companyId, this.key(chat)); return { status: 'cancelled', reply: 'ไม่ทำรายการนี้ค่ะ' }; }
      if (control.action !== 'expense_action_confirm') return { status: 'blocked', reply: EXPIRED };
      if (await this.snapshot(ctx, entry.payload) !== entry.digest) return { status: 'blocked', reply: CHANGED };
      const p = entry.payload, cmd = this.command(ctx);
      let reply = `${TEAM_ACTION_LABELS[p.action]}แล้วค่ะ`;
      let details = entry.preview.details;
      const source = { ...p };
      switch (p.action) {
        case 'EMPLOYEE_CREATE': {
          const origin = this.config.publicApiBaseUrl;
          const apiBaseUrl = origin ? `${origin.replace(/\/+$/, '')}/v1` : undefined;
          if (!apiBaseUrl) return { status: 'blocked', reply: 'ยังออกลิงก์เชื่อม LINE ไม่ได้ค่ะ กรุณาลองอีกครั้ง' };
          if (!entry.progress) {
            const result = await this.createEmployee.execute({ ...cmd, ...(p.fields as unknown as CreateEmployeeDto), apiBaseUrl });
            entry.progress = { employeeId: result.employeeId };
            await this.store.remember(ctx.companyId, this.key(chat), entry);
          }
          const employeeId = entry.progress.employeeId;
          source.employeeId = employeeId;
          if (!entry.progress.scoped) { await this.updateEmployee.execute({ ...cmd, employeeId, ...p.scope }); entry.progress.scoped = true; await this.store.remember(ctx.companyId, this.key(chat), entry); }
          if (!entry.progress.completed) { await this.createEmployee.completeDraft({ ...cmd, employeeId }); entry.progress.completed = true; await this.store.remember(ctx.companyId, this.key(chat), entry); }
          const link = await this.issueLink.execute({ ...cmd, employeeId, apiBaseUrl });
          reply = 'เพิ่มพนักงานแล้วค่ะ ส่งต่อลิงก์เชื่อม LINE นี้ให้พนักงานได้เลยค่ะ';
          details = [`ลิงก์เชื่อม LINE: ${link.linkUrl}`, `ลิงก์ใช้ได้ถึง ${new Date(link.expiresAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} ค่ะ`];
          break;
        }
        case 'EMPLOYEE_UPDATE': await this.updateEmployee.execute({ ...cmd, employeeId: p.employeeId!, ...p.fields }); break;
        case 'EMPLOYEE_DISABLE': case 'EMPLOYEE_ENABLE': await this.statusEmployee.execute({ ...cmd, employeeId: p.employeeId!, status: p.action === 'EMPLOYEE_ENABLE' ? 'ACTIVE' : 'DISABLED' }); break;
        case 'BRANCH_CREATE': source.branchId = (await this.createBranch.execute(ctx, p.fields as Parameters<CreateBranchUseCase['execute']>[1])).id; break;
        case 'BRANCH_UPDATE': await this.updateBranch.execute(ctx, { ...p.fields, branchId: p.branchId! }); break;
      }
      const preview = { ...entry.preview, details, record: { ...entry.preview.record, status: 'ดำเนินการแล้ว' } };
      entry.applied = { reply, preview, source, digest: await this.snapshot(ctx, source) };
      await this.store.remember(ctx.companyId, this.key(chat), entry);
      await this.store.discard(ctx.companyId, this.key(chat));
      return { status: 'applied', reply, preview };
    } catch (error) { return { status: 'blocked', reply: teamActionRefusal(error) }; }
    finally { await this.store.releaseClaim(ctx.companyId, this.key(chat), claim.token); }
  }
}

@Injectable()
export class CompanyActionPreviewTool implements ErpReadToolPort {
  readonly toolName = 'company.action.preview';
  constructor(private readonly actions: LineTeamActionService) {}
  async execute(ctx: ErpToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.actions.preview({ requestId: ctx.requestId ?? '', authSubject: ctx.userId, userId: ctx.userId, companyId: ctx.companyId, membershipId: ctx.membershipId ?? '', roles: ctx.roles ?? [], permissions: ctx.permissions, entitlementDeniedPermissions: ctx.entitlementDeniedPermissions, scopes: { branchIds: ctx.branchIds }, authProvider: 'line' }, ctx.chatKeyHash, input);
    return { toolName: this.toolName, status: 'ok', data: result, sourceRefs: [{ module: 'employee-access', entityType: 'company_action_preview', label: 'คำขอจัดการพนักงานและสาขา', permissionChecked: true, sourceType: 'ACTION' }], asOf: new Date().toISOString() };
  }
}
