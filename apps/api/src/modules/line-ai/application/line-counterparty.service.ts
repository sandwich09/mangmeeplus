import { lineControlData, type LineReplyLanguage } from '../domain/logic/line-language.logic';
import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { BUYER_ENTITY_KINDS, hasToolFeature, scrubRecordIdentifier, scrubRecordText, thaiTaxIdChecksumValid, type BuyerEntityKind, type RequestContext, type ToolResult } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { CreateCounterpartyUseCase, GetCounterpartyUseCase, ListCounterpartiesUseCase, UpdateCounterpartyUseCase } from '../../accounting-documents/application/use-cases/counterparty.use-case';
import { counterpartyAddressText, normalizeBranchCode } from '../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import { loadEntitledFeatureKeys } from '../../employee-access/application/entitlement.helper';
import { LineDraftPreviewStore } from '../../expenses/application/services/line-draft-preview.store';
import type { ErpReadToolPort, ErpToolContext } from '../domain/ports/erp-read-tool.port';
import { asCompleteLineCard } from '../domain/logic/line-business-card.logic';
import { drawLineSystemCard } from '../domain/logic/line-system-card-limits.logic';
import { absoluteWebLink } from '../../../common/http/web-link';
import { canonicalDeliveryJson } from '../domain/logic/line-delivery-plan.logic';
import type { LineReplyMessage } from '../infrastructure/line-reply.adapter';

export const COUNTERPARTY_FEATURES = ['expenses', 'sales_documents'] as const;
// Same admission keys as CounterpartyController; the web use-case still checks the originator relation.
export const COUNTERPARTY_DETAIL_PERMISSIONS = ['accounting.counterparty.read', 'accounting.counterparty.manage',
  'expense.read_related', 'accounting.document.read_related', 'expense.create', 'expense.update', 'expense.review',
  'expense.receipt.upload', 'expense.receipt.line_upload'] as const;
type Patch = { displayName?: string; legalName?: string; taxId?: string; addressText?: string; branchCode?: string; entityKind?: BuyerEntityKind };
export type CounterpartyControl = { action: 'counterparty_confirm' | 'counterparty_cancel'; token: string };
export type CounterpartyPreview = { language?: LineReplyLanguage; token: string; expiresAt: string; lines: string[] };
type StoredCounterparty = { previewId: string; companyId: string; userId: string; membershipId: string; chatKeyHash: string;
  conversationId: string; ownerEpoch: number; requestId: string; expiresAt: string; counterpartyId?: string; revision?: string;
  patch: Patch; preview: CounterpartyPreview; applied?: { id: string; revision: string } };
const EXPIRED = 'ข้อมูลหรือการ์ดเปลี่ยนแล้วค่ะ กรุณาเตรียมการ์ดคู่ค้าใหม่';
const LABELS: Record<keyof Patch, string> = { displayName: 'ชื่อคู่ค้า', legalName: 'ชื่อตามกฎหมาย', taxId: 'เลขผู้เสียภาษี', addressText: 'ที่อยู่', branchCode: 'สาขาภาษี', entityKind: 'ประเภทผู้รับเงิน' };
const display = (value: unknown, key: string, language: LineReplyLanguage = 'th') => language === 'en' ? value === 'JURISTIC' ? 'Company' : value === 'INDIVIDUAL' ? 'Individual' : (key === 'taxId' || key === 'branchCode' ? scrubRecordIdentifier(String(value ?? '')) : scrubRecordText(String(value ?? ''), 500)) || 'Not provided' : value === 'JURISTIC' ? 'นิติบุคคล' : value === 'INDIVIDUAL' ? 'บุคคลธรรมดา'
  : (key === 'taxId' || key === 'branchCode' ? scrubRecordIdentifier(String(value ?? '')) : scrubRecordText(String(value ?? ''), 500)) || 'ยังไม่มี';

export function isLineCounterpartyCommand(text: string): boolean {
  return /^(?:ช่วย\s*)?(?:เพิ่ม|แก้(?:ไข)?|อัปเดต|อัพเดต)(?:ข้อมูล)?\s*(?:ผู้ขาย|คู่ค้า|ผู้รับเงิน|ซัพพลายเออร์)(?!\s*(?:ได้ไหม|ได้มั้ย|อย่างไร|ยังไง|ได้บ้าง))/u.test(text.trim());
}

export function parseCounterpartyControl(raw: unknown): CounterpartyControl | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Object.keys(obj).length !== 2 || typeof obj.action !== 'string' || typeof obj.token !== 'string') return null;
    raw = new URLSearchParams({ action: obj.action, token: obj.token }).toString();
  }
  if (typeof raw !== 'string' || raw.length > 400) return null;
  const params = new URLSearchParams(raw), keys = [...params.keys()], action = params.get('action'), token = params.get('token');
  if (keys.length !== 2 || new Set(keys).size !== 2 || keys.some(key => !['action', 'token'].includes(key))
    || !['counterparty_confirm', 'counterparty_cancel'].includes(action ?? '') || !token || !/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  return { action: action as CounterpartyControl['action'], token };
}
export function buildCounterpartyCard(preview: CounterpartyPreview, language: LineReplyLanguage = preview.language ?? 'th'): LineReplyMessage {
  return asCompleteLineCard({ type: 'flex', altText: preview.lines[0]!, canonicalText: preview.lines.join('\n'), contents: { type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: preview.lines.map((text, i) => ({ type: 'text', text, wrap: true, ...(i === 0 ? { weight: 'bold' } : {}) })) },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: (['counterparty_confirm', 'counterparty_cancel'] as const).map((action, i) => ({
      type: 'button', style: i ? 'secondary' : 'primary', action: { type: 'postback', label: language === 'en' ? i ? 'Cancel action' : 'Confirm save' : i ? 'ไม่ทำ' : 'ยืนยันบันทึก', data: lineControlData(new URLSearchParams({ action, token: preview.token }).toString(), language) },
    })) } } });
}
/** Demo 2026-11-06: the saved supplier on the locked System OA card — what was saved, and a button that
 *  opens it on the web. No https base or a row the card cannot hold is no card; the reply stays its text. */
export function buildCounterpartySavedCard(reply: string, saved: { id: string; rows: Array<{ label: string; value: string }> },
  webBaseUrl: string | undefined, companyId: string, language: LineReplyLanguage = 'th'): LineReplyMessage | undefined {
  const uri = absoluteWebLink(webBaseUrl, `/companies/${encodeURIComponent(companyId)}/counterparties/${encodeURIComponent(saved.id)}`);
  const label = language === 'en' ? 'Open supplier' : 'เปิดคู่ค้าในเว็บ';
  const contents = uri.startsWith('https://') ? drawLineSystemCard({ mascot: 'general', header: { lines: language === 'en' ? ['Supplier', 'Saved'] : ['คู่ค้า', 'บันทึกแล้ว'] },
    rows: saved.rows, button: { action: { type: 'uri', label, uri }, icon: 'list' } }, webBaseUrl) : undefined;
  return contents && asCompleteLineCard({ type: 'flex', altText: reply, contents,
    canonicalText: [reply, ...saved.rows.map(row => `${row.label}: ${row.value}`), `${label}: ${uri}`].join('\n') });
}
function savedRows(patch: Patch, language: LineReplyLanguage): Array<{ label: string; value: string }> {
  return (Object.keys(LABELS) as Array<keyof Patch>).filter(key => patch[key] !== undefined && patch[key] !== '')
    .map(key => ({ label: language === 'en' ? ({ displayName: 'Name', legalName: 'Legal name', taxId: 'Tax ID', addressText: 'Address', branchCode: 'Tax branch', entityKind: 'Payee type' } as const)[key] : LABELS[key], value: display(patch[key], key, language) }));
}
function context(ctx: ErpToolContext): RequestContext {
  return { requestId: ctx.requestId ?? '', authSubject: ctx.userId, userId: ctx.userId, companyId: ctx.companyId,
    membershipId: ctx.membershipId ?? '', roles: ctx.roles ?? [], permissions: ctx.permissions,
    scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds }, authProvider: 'line' };
}
function result(ctx: ErpToolContext, toolName: string, data: unknown, id?: string): ToolResult {
  return { toolName, status: 'ok', data, asOf: new Date().toISOString(), sourceRefs: [{ module: 'accounting-documents',
    entityType: toolName === 'counterparty.action.preview' ? 'counterparty_action_preview' : 'counterparty', ...(id ? { entityId: id } : {}),
    label: 'คู่ค้า/ผู้รับเงิน', permissionChecked: true, webPath: `/companies/${ctx.companyId}/accounting/counterparties` }] };
}
function failure(toolName: string, error: unknown): ToolResult {
  return { toolName, status: error instanceof ForbiddenException || error instanceof NotFoundException ? 'forbidden' : 'error',
    asOf: new Date().toISOString(), sourceRefs: [], errorCode: 'COUNTERPARTY_UNAVAILABLE' };
}
@Injectable()
export class CounterpartySearchTool implements ErpReadToolPort {
  readonly toolName = 'counterparty.search';
  constructor(private readonly list: ListCounterpartiesUseCase) {}
  async execute(ctx: ErpToolContext, input: Record<string, unknown> = {}): Promise<ToolResult> {
    try {
      if (!ctx.permissions.includes('accounting.counterparty.read')) throw new ForbiddenException();
      const search = typeof input.search === 'string' ? input.search.trim().slice(0, 160) : '';
      const page = await this.list.execute(context(ctx), 1, 10, search ? { search } : {});
      return result(ctx, this.toolName, { total: page.total, items: page.data.map(row => ({ id: row.id, displayName: row.displayName,
        taxId: row.taxId ?? null, branchCode: row.branchCode ?? null, entityKind: row.entityKind ?? null, status: row.status })) });
    } catch (error) { if (!(error instanceof HttpException)) throw error; return failure(this.toolName, error); }
  }
}
@Injectable()
export class CounterpartyGetDetailTool implements ErpReadToolPort {
  readonly toolName = 'counterparty.get_detail';
  constructor(private readonly get: GetCounterpartyUseCase) {}
  async execute(ctx: ErpToolContext, input: Record<string, unknown> = {}): Promise<ToolResult> {
    try {
      if (!COUNTERPARTY_DETAIL_PERMISSIONS.some(permission => ctx.permissions.includes(permission))) throw new ForbiddenException();
      if (typeof input.counterpartyId !== 'string' || !input.counterpartyId.trim() || input.counterpartyId.length > 200) throw new BadRequestException();
      const row = await this.get.execute(context(ctx), input.counterpartyId);
      // Registry rows are company-wide, like the web; tax branchCode is not an ABAC branchId. No bank fields exist on this web record.
      return result(ctx, this.toolName, { id: row.id, displayName: row.displayName, legalName: row.legalName ?? null,
        taxId: row.taxId ?? null, addressText: counterpartyAddressText(row.billingAddressJson), branchCode: row.branchCode ?? null,
        entityKind: row.entityKind ?? null, status: row.status, canEdit: row.canEdit }, row.id);
    } catch (error) { if (!(error instanceof HttpException)) throw error; return failure(this.toolName, error); }
  }
}

@Injectable()
export class LineCounterpartyService {
  constructor(private readonly prisma: PrismaService, private readonly get: GetCounterpartyUseCase,
    private readonly create: CreateCounterpartyUseCase, private readonly update: UpdateCounterpartyUseCase,
    private readonly store: LineDraftPreviewStore<StoredCounterparty>, private readonly config: AppConfigService) {}
  private key(chat: string) { return `counterparty:${chat}`; }
  private owner(ctx: RequestContext, chat: string) {
    return this.prisma.client.aiConversation.findFirst({ where: { companyId: ctx.companyId, userId: ctx.userId,
      membershipId: ctx.membershipId, chatKeyHash: chat, channelKind: 'USER', channel: 'line' } });
  }
  private async authorize(ctx: RequestContext, id?: string) {
    if (!hasToolFeature({ featureKeys: COUNTERPARTY_FEATURES, sourceModule: 'accounting-documents' }, await loadEntitledFeatureKeys(this.prisma, ctx.companyId))) throw new ForbiddenException();
    if (!id) { if (!ctx.permissions.includes('accounting.counterparty.manage')) throw new ForbiddenException(); return null; }
    if (!COUNTERPARTY_DETAIL_PERMISSIONS.some(permission => ctx.permissions.includes(permission))) throw new ForbiddenException();
    const row = await this.get.execute(ctx, id);
    if (!row.canEdit) throw new ForbiddenException();
    return row;
  }
  private sign(entry: StoredCounterparty) {
    if (!this.config.aiGatewayInternalSecret) throw new ForbiddenException();
    const { preview: _preview, applied: _applied, ...facts } = entry;
    return `${entry.previewId}.${createHmac('sha256', this.config.aiGatewayInternalSecret).update('line-counterparty-v1\0').update(canonicalDeliveryJson({ ...facts, lines: entry.preview.lines })).digest('base64url')}`;
  }
  private async bound(ctx: RequestContext, chat: string, entry: StoredCounterparty, token?: string) {
    if (entry.companyId !== ctx.companyId || entry.userId !== ctx.userId || entry.membershipId !== ctx.membershipId
      || entry.chatKeyHash !== this.key(chat) || Date.parse(entry.expiresAt) <= Date.now()) return false;
    const owner = await this.owner(ctx, chat);
    if (!owner || owner.id !== entry.conversationId || owner.lifecycleEpoch !== entry.ownerEpoch) return false;
    const expected = this.sign(entry), supplied = token ?? entry.preview.token;
    return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  }
  async preview(ctx: RequestContext, chat: string | undefined, input: Record<string, unknown>, language: LineReplyLanguage = 'th'): Promise<{ reply: string; preview?: CounterpartyPreview }> {
    const en = language === 'en';
    try {
      if (!chat || !this.store.available || !this.config.aiGatewayInternalSecret) return { reply: (en ? 'Please prepare the supplier in a private chat.' : 'กรุณาเตรียมคู่ค้าในแชตส่วนตัวอีกครั้งค่ะ') };
      const owner = await this.owner(ctx, chat);
      if (!owner) return { reply: en ? 'This proposal expired; please prepare a new supplier card.' : EXPIRED };
      if (!['CREATE', 'UPDATE'].includes(String(input.action))) throw new BadRequestException('เลือกเพิ่มหรือแก้ไขคู่ค้าค่ะ');
      const id = input.action === 'UPDATE' && typeof input.counterpartyId === 'string' ? input.counterpartyId.trim() : undefined;
      if (input.action === 'UPDATE' && (!id || id.length > 200)) return { reply: (en ? 'Which supplier would you like to edit?' : 'ต้องการแก้ไขคู่ค้ารายไหนคะ') };
      const old = await this.authorize(ctx, id);
      const patch: Patch = {};
      for (const key of Object.keys(LABELS) as Array<keyof Patch>) {
        if (input[key] === undefined) continue;
        if (typeof input[key] !== 'string') throw new BadRequestException('กรุณาตรวจข้อมูลคู่ค้าอีกครั้งค่ะ');
        const value = (input[key] as string).trim();
        const max = key === 'addressText' ? 500 : key === 'taxId' ? 32 : key === 'branchCode' ? 16 : 255;
        if (value.length > max || key === 'displayName' && !value) throw new BadRequestException('กรุณาตรวจชื่อและความยาวข้อมูลคู่ค้าอีกครั้งค่ะ');
        if (key === 'entityKind' && !(BUYER_ENTITY_KINDS as readonly string[]).includes(value)) throw new BadRequestException('ประเภทผู้รับเงินต้องเป็นบุคคลธรรมดาหรือนิติบุคคลค่ะ');
        if (key === 'branchCode' && (!value || !normalizeBranchCode(value))) throw new BadRequestException('รหัสสาขาภาษีต้องเป็นตัวเลขห้าหลักค่ะ');
        // Same web rule: foreign tax IDs are allowed (32 chars). Check Thai digit-only input with the existing checksum validator, as a warning.
        if (key === 'taxId' && value && /^[\d\s-]+$/u.test(value) && !/^\d{13}$/u.test(value.replace(/[\s-]/gu, ''))) throw new BadRequestException('เลขผู้เสียภาษีไทยต้องมีสิบสามหลักค่ะ');
        Object.assign(patch, { [key]: key === 'taxId' && /^[\d\s-]+$/u.test(value) ? value.replace(/[\s-]/gu, '') : key === 'branchCode' && value ? normalizeBranchCode(value)! : value });
      }
      if (!id && !patch.displayName) return { reply: (en ? 'What is the new supplier’s name?' : 'คู่ค้าที่จะเพิ่มชื่ออะไรคะ') };
      if (!Object.keys(patch).length) return { reply: (en ? 'Which supplier details would you like to change?' : 'ต้องการแก้ไขข้อมูลส่วนไหนของคู่ค้าคะ') };
      const before = old ? { ...old, addressText: counterpartyAddressText(old.billingAddressJson) } : {};
      const lines = [id ? (en ? 'Review the changes before confirming.' : 'ตรวจข้อมูลที่จะแก้ไขแล้วกดยืนยันค่ะ') : (en ? 'Review the new supplier before confirming.' : 'ตรวจคู่ค้าที่จะเพิ่มแล้วกดยืนยันค่ะ'),
        ...Object.entries(patch).map(([key, value]) => `${en ? ({ displayName: 'Supplier name', legalName: 'Legal name', taxId: 'Tax ID', addressText: 'Address', branchCode: 'Tax branch', entityKind: 'Payee type' } as Record<string, string>)[key] : LABELS[key as keyof Patch]}: ${display((before as Record<string, unknown>)[key], key, language)} → ${display(value, key, language)}`),
        ...(patch.taxId && /^\d{13}$/u.test(patch.taxId) && !thaiTaxIdChecksumValid(patch.taxId) ? [(en ? 'The tax ID checksum differs; review it before confirming.' : 'เลขท้ายไม่ตรงตามสูตร ตรวจอีกครั้ง หรือกดบันทึกถ้าแน่ใจค่ะ')] : [])];
      const entry: StoredCounterparty = { previewId: randomUUID(), companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId,
        chatKeyHash: this.key(chat), conversationId: owner.id, ownerEpoch: owner.lifecycleEpoch, requestId: ctx.requestId,
        expiresAt: new Date(Date.now() + 600_000).toISOString(), ...(id ? { counterpartyId: id, revision: old!.updatedAt.toISOString() } : {}), patch,
        preview: { language, token: '', expiresAt: '', lines } };
      entry.preview = { language, token: this.sign(entry), expiresAt: entry.expiresAt, lines };
      if (!await this.store.save(entry)) return { reply: (en ? 'A previous request is still saving; please try again.' : 'กำลังบันทึกคำขอก่อนหน้าค่ะ กรุณาลองอีกครั้ง') };
      return { reply: lines[0]!, preview: entry.preview };
    } catch (error) { if (!(error instanceof HttpException)) throw error; return { reply: en ? error instanceof ForbiddenException ? 'Ask the shop owner or an authorized administrator to manage this supplier.' : 'Please check the supplier details and try again.' : this.refusal(error) }; }
  }
  async pending(ctx: RequestContext, chat: string, requestId?: string): Promise<CounterpartyPreview | null> {
    const entry = await this.store.load(ctx.companyId, this.key(chat));
    if (!entry || requestId && entry.requestId !== requestId || !await this.bound(ctx, chat, entry)) return null;
    try { const old = await this.authorize(ctx, entry.counterpartyId); return (!old || old.updatedAt.toISOString() === entry.revision) ? entry.preview : null; } catch { return null; }
  }
  async source(ctx: RequestContext, id: string, revision: string) {
    const row = await this.authorize(ctx, id);
    if (!row || row.updatedAt.toISOString() !== revision) throw new NotFoundException();
    return { id: row.id, name: row.displayName, taxId: row.taxId ?? null, address: counterpartyAddressText(row.billingAddressJson), entityKind: row.entityKind ?? null };
  }
  async apply(ctx: RequestContext, chat: string, control: CounterpartyControl, language: LineReplyLanguage = 'th'): Promise<{ status: 'applied' | 'replayed' | 'blocked' | 'cancelled'; reply: string; source?: { id: string; revision: string }; saved?: { id: string; rows: Array<{ label: string; value: string }> } }> {
    const previous = await this.store.loadApplied(ctx.companyId, this.key(chat));
    if (previous?.applied && await this.bound(ctx, chat, previous, control.token)) {
      try { const row = await this.authorize(ctx, previous.applied.id); return row?.updatedAt.toISOString() === previous.applied.revision
        ? { status: 'replayed', reply: language === 'en' ? 'This supplier has already been saved.' : 'บันทึกคู่ค้ารายการนี้แล้วค่ะ', source: previous.applied, saved: { id: previous.applied.id, rows: savedRows(previous.patch, language) } } : { status: 'blocked', reply: language === 'en' ? 'This supplier proposal expired or changed; please prepare a new card.' : EXPIRED }; } catch { return { status: 'blocked', reply: language === 'en' ? 'This supplier proposal expired or changed; please prepare a new card.' : EXPIRED }; }
    }
    const claim = await this.store.claimCurrent(ctx.companyId, this.key(chat), control.token.split('.')[0]!);
    if (!claim) return { status: 'blocked', reply: language === 'en' ? 'This supplier proposal expired or changed; please prepare a new card.' : EXPIRED };
    const entry = claim.entry;
    try {
      if (!await this.bound(ctx, chat, entry, control.token)) return { status: 'blocked', reply: language === 'en' ? 'This supplier proposal expired or changed; please prepare a new card.' : EXPIRED };
      if (control.action === 'counterparty_cancel') { await this.store.discard(ctx.companyId, this.key(chat)); return { status: 'cancelled', reply: language === 'en' ? 'Supplier changes cancelled.' : 'ไม่บันทึกการแก้ไขคู่ค้าค่ะ' }; }
      const old = await this.authorize(ctx, entry.counterpartyId);
      if (old && old.updatedAt.toISOString() !== entry.revision) return { status: 'blocked', reply: language === 'en' ? 'This supplier proposal expired or changed; please prepare a new card.' : EXPIRED };
      const row = entry.counterpartyId ? await this.update.execute(ctx, entry.counterpartyId, { ...entry.patch, expectedUpdatedAt: entry.revision })
        : await this.create.execute(ctx, { ...entry.patch, displayName: entry.patch.displayName! });
      entry.applied = { id: row.id, revision: row.updatedAt.toISOString() };
      await this.store.remember(ctx.companyId, this.key(chat), entry);
      await this.store.discard(ctx.companyId, this.key(chat));
      return { status: 'applied', reply: language === 'en' ? 'Supplier details saved.' : 'บันทึกข้อมูลคู่ค้าแล้วค่ะ', source: entry.applied, saved: { id: row.id, rows: savedRows(entry.patch, language) } };
    } catch (error) { if (!(error instanceof HttpException)) throw error; return { status: 'blocked', reply: language === 'en' ? error instanceof ForbiddenException || error instanceof NotFoundException ? 'Ask the shop owner or an authorized administrator to manage this supplier.' : 'Please review the supplier details and prepare a new card.' : this.refusal(error) }; }
    finally { await this.store.releaseClaim(ctx.companyId, this.key(chat), claim.token); }
  }
  private refusal(error: HttpException) {
    return error instanceof ForbiddenException || error instanceof NotFoundException ? 'คุณยังไม่มีสิทธิ์จัดการคู่ค้ารายนี้ค่ะ'
      : error instanceof BadRequestException && /[ก-๙]/u.test(error.message) ? error.message : EXPIRED;
  }
}
@Injectable()
export class CounterpartyActionPreviewTool implements ErpReadToolPort {
  readonly toolName = 'counterparty.action.preview';
  constructor(private readonly service: LineCounterpartyService) {}
  async execute(ctx: ErpToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    return result(ctx, this.toolName, await this.service.preview(context(ctx), ctx.chatKeyHash, input, ctx.locale.startsWith('en') ? 'en' : 'th'));
  }
}
