import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { scrubRecordText, type BillingCatalog, type BillingCheckoutResult, type BillingInterval, type BillingOffer, type BillingPurchaseMode, type BillingQuote, type RequestContext } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { absoluteWebLink } from '../../../common/http/web-link';
import { PrismaService } from '../../../common/database/prisma.service';
import { BillingService } from '../../billing/application/billing.service';
import { LineDraftPreviewStore } from '../../expenses/application/services/line-draft-preview.store';
import { asCompleteLineCard } from '../domain/logic/line-business-card.logic';
import { canonicalDeliveryJson } from '../domain/logic/line-delivery-plan.logic';
import type { LineReplyMessage } from '../infrastructure/line-reply.adapter';

export type PackagePurchaseControl = { action: 'package_purchase_confirm' | 'package_purchase_cancel'; token: string };
type Selection = { tier?: BillingOffer['offerKey']; interval?: BillingInterval; method?: 'CARD' | 'PROMPTPAY'; renewing?: boolean };
export type PackagePurchaseView = { token: string; expiresAt: string; lines: string[]; payment?: BillingCheckoutResult };
type StoredPurchase = { previewId: string; companyId: string; userId: string; membershipId: string; chatKeyHash: string;
  conversationId: string; ownerEpoch: number; expiresAt: string; selection: Selection; quote?: BillingQuote; view?: PackagePurchaseView };
const EXPIRED = 'การ์ดนี้หมดอายุหรือข้อมูลเปลี่ยนแล้วค่ะ กรุณาบอกแพ็กเกจที่ต้องการอีกครั้ง';
export const PACKAGE_PURCHASE_PERMISSION = 'ให้เจ้าของร้านหรือแอดมินที่มีสิทธิ์จัดการแพ็กเกจเป็นผู้ซื้อค่ะ';
const MODE_LABELS: Record<BillingPurchaseMode, string> = { CARD_AUTO: 'บัตร · ต่ออายุอัตโนมัติ', CARD_ONCE: 'บัตร · จ่ายครั้งเดียว',
  PROMPTPAY_ONCE: 'พร้อมเพย์ · จ่ายครั้งเดียว', PROMPTPAY_RENEW: 'พร้อมเพย์ · สแกนบิลทุกงวด' };
const money = (satang: number) => `${(satang / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`;
const paymentReply = (payment: BillingCheckoutResult) => `กดจ่ายได้เลยค่ะ${payment.expiresAt ? ` ลิงก์ใช้ได้ถึง ${new Date(payment.expiresAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })} น.` : ''}`;
const date = (value: string) => new Date(value).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });

export function parsePackagePurchaseControl(raw: unknown): PackagePurchaseControl | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Object.keys(obj).length !== 2 || typeof obj.action !== 'string' || typeof obj.token !== 'string') return null;
    raw = new URLSearchParams({ action: obj.action, token: obj.token }).toString();
  }
  if (typeof raw !== 'string' || raw.length > 400) return null;
  const p = new URLSearchParams(raw), keys = [...p.keys()], action = p.get('action'), token = p.get('token');
  if (keys.length !== 2 || new Set(keys).size !== 2 || keys.some(k => !['action', 'token'].includes(k))
    || !['package_purchase_confirm', 'package_purchase_cancel'].includes(action ?? '')
    || !token || !/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  return { action: action as PackagePurchaseControl['action'], token };
}

export function isPackagePurchaseIntent(text: string): boolean {
  if (/(?:ไม่(?:ต้อง|เอา|ซื้อ)|ราคาเท่า|เท่าไหร่|ต่างกัน|ซื้อ.*(?:ได้ไหม|ได้มั้ย|ยังไง|อย่างไร)|ถ้า.*ซื้อ)/u.test(text)) return false;
  return /(?:ซื้อ|อัปเกรด|อัพเกรด|upgrade|ต่ออายุ|เปลี่ยน)/iu.test(text)
    && /(?:แพ[็ก๊ค]+(?:เกจ)?|package|โปร|ธุรกิจ|starter|basic|pro|enterprise|เริ่มต้น|เติบโต|มืออาชีพ|(?:^|\D)(?:249|499|999|1999)(?:\D|$))/iu.test(text)
    || /^แพ[็ก๊ค]+(?:เกจ)?\s*(?:249|499|999|1999)(?:\s|บาท|ค่ะ|คะ|$)/u.test(text.trim());
}

export function isPackagePurchaseAnswer(text: string): boolean {
  return !/(?:ราคา|เท่าไหร่|เท่าไร|ได้ไหม|ได้มั้ย|เหลือ|ใช้ไป|ต่างกัน|พอไหม)/u.test(text)
    && /^(?:(?:จ่าย|ชำระ)(?:ด้วย)?|ใช้|เอา|ขอ)?\s*(?:บัตร|พร้อมเพย์|promptpay|card|รายเดือน|รายปี|เดือน|ปี|ไม่ทำ|ยกเลิก|แพ[็ก๊ค]|โปร|ธุรกิจ|เริ่มต้น|เติบโต|มืออาชีพ|starter|basic|pro|enterprise|\d)/iu.test(text.trim());
}

/** Names and prices are matched against today's catalog, never a hard-coded charge. */
export function resolvePackageOffer(text: string, catalog: BillingCatalog, interval: BillingInterval): BillingOffer | null {
  const candidates = catalog.offers.filter(o => o.interval === interval);
  const numbers = [...text.replace(/,/gu, '').matchAll(/\d+(?:\.\d+)?/gu)].map(m => Number(m[0]) * 100);
  const matches = candidates.filter(o => {
    const words = o.label.replace(/[()]/gu, ' ').trim().split(/\s+/u);
    const named = words.some(word => /^[A-Za-z]+$/u.test(word)
      ? new RegExp(`\\b${word}\\b`, 'iu').test(text) : text.includes(word));
    const monthly = catalog.offers.find(row => row.offerKey === o.offerKey && row.interval === 'month');
    return named || o.offerKey === 'PRO_999' && /โปร(?!โมชั่น)/u.test(text)
      || numbers.includes(o.priceSatang) || !!monthly && numbers.includes(monthly.priceSatang);
  });
  return matches.length === 1 ? matches[0]! : null;
}

export function buildPackagePurchaseCard(view: PackagePurchaseView): LineReplyMessage {
  const payment = view.payment?.checkoutUrl;
  const buttons = payment ? [{ type: 'button', style: 'primary', action: { type: 'uri', label: 'กดจ่าย', uri: payment } }]
    : (['package_purchase_confirm', 'package_purchase_cancel'] as const).map((action, i) => ({ type: 'button', style: i ? 'secondary' : 'primary',
      action: { type: 'postback', label: i ? 'ไม่ทำ' : 'สร้างลิงก์จ่าย', data: new URLSearchParams({ action, token: view.token }).toString() } }));
  return asCompleteLineCard({ type: 'flex', altText: view.lines[0]!, canonicalText: [...view.lines, ...(payment ? [`กดจ่าย: ${payment}`] : [])].join('\n'), contents: { type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: view.lines.map((text, i) => ({ type: 'text', text, wrap: true, ...(i === 0 ? { weight: 'bold' } : {}) })) },
    ...(!view.payment || payment ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } } : {}) } });
}

/** Deterministic private-chat purchase lane. Only a signed button can create Checkout. */
@Injectable()
export class LinePackagePurchaseService {
  constructor(private readonly prisma: PrismaService, private readonly billing: BillingService,
    private readonly store: LineDraftPreviewStore<StoredPurchase>, private readonly config: AppConfigService) {}
  private key(chat: string) { return `package-purchase:${chat}`; }
  private owner(ctx: RequestContext, chat: string) {
    return this.prisma.client.aiConversation.findFirst({ where: { companyId: ctx.companyId, userId: ctx.userId,
      membershipId: ctx.membershipId, chatKeyHash: chat, channelKind: 'USER', channel: 'line' } });
  }
  private sign(entry: StoredPurchase) {
    if (!this.config.aiGatewayInternalSecret) throw new ForbiddenException();
    const { view: _view, ...facts } = entry;
    return `${entry.previewId}.${createHmac('sha256', this.config.aiGatewayInternalSecret).update('line-package-purchase-v1\0').update(canonicalDeliveryJson(facts)).digest('base64url')}`;
  }
  private async bound(ctx: RequestContext, chat: string, entry: StoredPurchase, token?: string) {
    if (entry.companyId !== ctx.companyId || entry.userId !== ctx.userId || entry.membershipId !== ctx.membershipId
      || entry.chatKeyHash !== this.key(chat) || Date.parse(entry.expiresAt) <= Date.now()) return false;
    const owner = await this.owner(ctx, chat);
    if (!owner || owner.id !== entry.conversationId || owner.lifecycleEpoch !== entry.ownerEpoch) return false;
    if (!token) return true;
    const expected = this.sign(entry);
    return token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }
  async accepts(ctx: RequestContext, chat: string, text: string) {
    const entry = await this.store.load(ctx.companyId, this.key(chat));
    return !!entry && await this.bound(ctx, chat, entry) && isPackagePurchaseAnswer(text);
  }
  async prepare(ctx: RequestContext, chat: string, text: string): Promise<{ reply: string; view?: PackagePurchaseView; choices?: Array<{ label: string; text: string; uri?: string }> }> {
    try {
      await this.billing.assertOwner(ctx);
      const owner = await this.owner(ctx, chat);
      if (!owner || !this.store.available || !this.config.aiGatewayInternalSecret) return { reply: 'ยังเตรียมลิงก์จ่ายไม่ได้ค่ะ กรุณาลองอีกครั้ง' };
      const old = await this.store.load(ctx.companyId, this.key(chat));
      if (/^(?:ไม่ทำ|ยกเลิก)(?:ค่ะ|คะ)?$/u.test(text.trim())) {
        if (old && await this.bound(ctx, chat, old)) await this.store.discard(ctx.companyId, this.key(chat));
        return { reply: 'ไม่ทำรายการนี้ค่ะ' };
      }
      const status = await this.billing.status(ctx);
      if (status.attemptId) return this.existing(ctx, chat, status.attemptId, owner);
      const catalog = await this.billing.catalog();
      const selection: Selection = !isPackagePurchaseIntent(text) && old && await this.bound(ctx, chat, old) ? { ...old.selection } : {};
      if (/รายปี|ต่อปี|year/iu.test(text)) selection.interval = 'year';
      else if (/รายเดือน|ต่อเดือน|month/iu.test(text)) selection.interval = 'month';
      selection.interval ??= status.interval ?? 'month';
      if (/พร้อมเพย์|promptpay|\bqr\b/iu.test(text)) selection.method = 'PROMPTPAY';
      else if (/บัตร|\bcard\b/iu.test(text)) selection.method = 'CARD';
      if (/ครั้งเดียว|ไม่ต่ออายุ|ไม่อัตโนมัติ/u.test(text)) selection.renewing = false;
      else if (/อัตโนมัติ|ทุกงวด|สแกนบิล/u.test(text)) selection.renewing = true;
      const offered = resolvePackageOffer(text, catalog, selection.interval);
      if (offered) selection.tier = offered.offerKey;
      const offer = catalog.offers.find(o => o.interval === selection.interval && o.offerKey === selection.tier);
      const entry: StoredPurchase = { previewId: randomUUID(), companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId,
        chatKeyHash: this.key(chat), conversationId: owner.id, ownerEpoch: owner.lifecycleEpoch, expiresAt: new Date(Date.now() + 600_000).toISOString(), selection };
      if (offer && (offer.availability !== 'AVAILABLE' || !status.availablePurchaseModes?.length)) {
        const available = catalog.offers.filter(o => o.availability === 'AVAILABLE')
          .sort((a, b) => Number(b.interval === selection.interval) - Number(a.interval === selection.interval)
            || Math.abs(a.priceSatang - offer.priceSatang) - Math.abs(b.priceSatang - offer.priceSatang));
        delete entry.selection.tier;
        await this.store.save(entry);
        const choices = available.length ? available.slice(0, 4) : catalog.offers.filter(row => row.interval === selection.interval && row.availability !== 'COMING_SOON').slice(0, 4);
        const billingPath = `/companies/${encodeURIComponent(ctx.companyId)}/billing?channel=line`;
        return { reply: `${scrubRecordText(offer.label, 80).replace(/\s*\([A-Z_0-9]+\)/gu, '')} ${offer.availability !== 'AVAILABLE' ? 'ยังไม่เปิดขายค่ะ' : 'ยังซื้อผ่าน LINE ไม่ได้ค่ะ'}${available.length ? ' เลือกแพ็กเกจที่เปิดขายได้เลยค่ะ' : ' ดูแพ็กเกจอื่นและช่องทางซื้อบนเว็บได้ค่ะ'}`,
          choices: [...choices.map(row => ({ label: `${scrubRecordText(row.label, 40).replace(/\s*\([A-Z_0-9]+\)/gu, '')} ${money(row.priceSatang)}`,
            text: `ซื้อแพ็กเกจ ${scrubRecordText(row.label, 80).replace(/\s*\([A-Z_0-9]+\)/gu, '')} ${row.interval === 'year' ? 'รายปี' : 'รายเดือน'}`,
            ...(!available.length ? { uri: absoluteWebLink(this.config.webBaseUrl, `${billingPath}&offer=${row.offerKey}&interval=${row.interval}`) } : {}) })),
            ...(!available.length ? [{ label: 'จัดการแพ็กเกจ', text: 'จัดการแพ็กเกจ', uri: absoluteWebLink(this.config.webBaseUrl, billingPath) }] : [])] };
      }
      let question = !offer ? 'ต้องการแพ็กเกจไหนคะ' : '';
      const modes = status.availablePurchaseModes ?? [];
      const families = [...new Set(modes.map(m => m.startsWith('CARD') ? 'CARD' as const : 'PROMPTPAY' as const))];
      if (!question && !selection.method && families.length > 1) question = 'จ่ายด้วยบัตรหรือพร้อมเพย์คะ';
      selection.method ??= families.length === 1 ? families[0] : undefined;
      if (question) {
        if (!await this.store.save(entry)) return { reply: 'กำลังดำเนินการคำขอก่อนหน้าค่ะ กรุณาลองอีกครั้ง' };
        return { reply: question };
      }
      const mode = modes.find(m => m.startsWith(selection.method!) && (selection.renewing === undefined || (m === 'CARD_AUTO' || m === 'PROMPTPAY_RENEW') === selection.renewing));
      if (!mode) return { reply: 'วิธีจ่ายนี้ยังใช้กับแพ็กเกจของร้านไม่ได้ค่ะ กรุณาตรวจรายการต่ออายุเดิมก่อน' };
      // ponytail: let the same web quote derive recipient/profile, pricing, discount and all purchase guards.
      const promotion = status.promotions?.find(row => row.available && row.offerKey === offer!.offerKey && row.interval === selection.interval);
      const quote = await this.billing.quote(ctx, { offerKey: offer!.offerKey, interval: selection.interval, purchaseMode: mode,
        ...(promotion ? { benefitChoice: 'PROMOTION' as const, promotionCampaignId: promotion.campaignId, eventDiscountChoice: 'DECLINE' as const } : {}) });
      entry.quote = quote; entry.expiresAt = quote.expiresAt;
      entry.view = { token: this.sign(entry), expiresAt: entry.expiresAt, lines: this.quoteLines(quote, mode) };
      if (!await this.store.save(entry)) return { reply: 'กำลังดำเนินการคำขอก่อนหน้าค่ะ กรุณาลองอีกครั้ง' };
      return { reply: entry.view.lines[0]!, view: entry.view };
    } catch (error) { return { reply: this.refusal(error) }; }
  }
  private quoteLines(q: BillingQuote, mode: BillingPurchaseMode): string[] {
    const totals = q.eventDiscount?.applied ?? q;
    return ['ตรวจรายละเอียดแล้วกดสร้างลิงก์จ่ายค่ะ', scrubRecordText(q.companyName, 80), `${scrubRecordText(q.offer.label, 80)} · ${q.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}`,
      `ชำระ ${money(totals.totalSatang)} · ${MODE_LABELS[mode]}`, `ก่อนภาษี ${money(totals.subtotalSatang)} · ภาษี ${money(totals.taxSatang)}`,
      ...(q.promotion ? [`โปรโมชั่น ${scrubRecordText(q.promotion.displayName, 80)} · แถม ${q.promotion.bonusMonths} เดือนและใบเสร็จ ${q.promotion.bonusReceiptUnits} ใบ`,
        `ใช้สิทธิ์ได้ถึงประมาณ ${date(q.promotion.benefitEnd)}${q.promotion.expectedNextChargeAt ? ` · ต่ออายุรอบถัดไป ${date(q.promotion.expectedNextChargeAt)}` : ''}`] : []),
      ...(q.eventDiscount?.applied ? [`ใช้ส่วนลดจากงาน ${scrubRecordText(q.eventDiscount.eventName, 80)}`] : []),
      ...(q.purchase ? [`${q.purchase.kind === 'UPGRADE' ? 'จ่ายส่วนต่างอัปเกรด · ' : q.purchase.kind === 'SCHEDULED_CHANGE' ? `เริ่มแพ็กเกจใหม่ ${date(q.purchase.previousPaidThrough!)} · ` : ''}ใช้ได้ถึงประมาณ ${date(q.purchase.projectedPaidThrough)}`] : []),
      ...(q.upgrade ? [`ราคาเต็มรอบถัดไป ${money(q.upgrade.nextRenewalTotalSatang)}`] : []),
      mode === 'CARD_AUTO' ? 'กดสร้างลิงก์เพื่อยืนยันเงื่อนไขชำระเงินและต่ออายุด้วยบัตรอัตโนมัติค่ะ'
        : mode === 'PROMPTPAY_RENEW' ? 'กดสร้างลิงก์เพื่อยืนยันจ่ายด้วย QR ทุกงวด ต้องสแกนเอง ไม่มีการหักเงินอัตโนมัติค่ะ'
          : 'กดสร้างลิงก์เพื่อยืนยันจ่ายครั้งเดียว ไม่มีการตัดเงินงวดถัดไปค่ะ'];
  }
  private async existing(ctx: RequestContext, chat: string, attemptId: string, owner: { id: string; lifecycleEpoch: number }) {
    const payment = await this.billing.resume(ctx, attemptId);
    if (!payment.checkoutUrl) return { reply: 'มีรายการชำระเงินเดิมกำลังตรวจสอบอยู่ค่ะ ยังสร้างรายการใหม่ไม่ได้' };
    const entry: StoredPurchase = { previewId: randomUUID(), companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId,
      chatKeyHash: this.key(chat), conversationId: owner.id, ownerEpoch: owner.lifecycleEpoch, expiresAt: new Date(Date.now() + 600_000).toISOString(), selection: {} };
    entry.view = { token: this.sign(entry), expiresAt: entry.expiresAt, lines: [`มีรายการเดิมอยู่ค่ะ ${paymentReply(payment)}`], payment };
    if (!await this.store.save(entry)) return { reply: 'กำลังดำเนินการคำขอก่อนหน้าค่ะ กรุณาลองอีกครั้ง' };
    return { reply: entry.view.lines[0]!, view: entry.view };
  }
  async current(ctx: RequestContext, chat: string, token: string): Promise<PackagePurchaseView | null> {
    const entry = await this.store.load(ctx.companyId, this.key(chat)) ?? await this.store.loadApplied(ctx.companyId, this.key(chat));
    if (!entry?.view || !await this.bound(ctx, chat, entry, token)) return null;
    try {
      await this.billing.assertOwner(ctx);
      if (entry.view.payment?.checkoutUrl && (await this.billing.status(ctx)).attemptId !== entry.view.payment.attemptId) return null;
      return entry.view;
    } catch { return null; }
  }
  async apply(ctx: RequestContext, chat: string, control: PackagePurchaseControl): Promise<{ reply: string; view?: PackagePurchaseView }> {
    const applied = await this.store.loadApplied(ctx.companyId, this.key(chat));
    if (applied?.view?.payment && await this.bound(ctx, chat, applied, control.token)) {
      try {
        await this.billing.assertOwner(ctx);
        const payment = await this.billing.resume(ctx, applied.view.payment.attemptId);
        const reply = payment.checkoutUrl ? paymentReply(payment) : 'มีรายการชำระเงินเดิมกำลังตรวจสอบอยู่ค่ะ ยังสร้างรายการใหม่ไม่ได้';
        applied.view = { ...applied.view, payment, lines: [reply] };
        await this.store.remember(ctx.companyId, this.key(chat), applied);
        return { reply, view: applied.view };
      } catch (error) { return { reply: this.refusal(error) }; }
    }
    const claim = await this.store.claimCurrent(ctx.companyId, this.key(chat), control.token.split('.')[0]!);
    if (!claim) return { reply: EXPIRED };
    const entry = claim.entry;
    try {
      if (!await this.bound(ctx, chat, entry, control.token)) return { reply: EXPIRED };
      await this.billing.assertOwner(ctx);
      if (control.action === 'package_purchase_cancel') {
        await this.store.discard(ctx.companyId, this.key(chat)); return { reply: 'ไม่ทำรายการนี้ค่ะ' };
      }
      if (entry.view?.payment) {
        const payment = await this.billing.resume(ctx, entry.view.payment.attemptId);
        entry.view = { ...entry.view, payment, lines: [payment.checkoutUrl ? paymentReply(payment) : 'มีรายการชำระเงินเดิมกำลังตรวจสอบอยู่ค่ะ ยังสร้างรายการใหม่ไม่ได้'] };
      } else {
        if (!entry.quote || !entry.view) return { reply: EXPIRED };
        const payment = await this.billing.checkout(ctx, { quoteId: entry.quote.quoteId, consentRevision: entry.quote.consentRevision, accepted: true, channel: 'line' }, `line-package-${entry.previewId}`);
        entry.view = { ...entry.view, payment, lines: [payment.checkoutUrl ? paymentReply(payment) : payment.state === 'FAILED'
          ? 'ยังเปิดหน้าชำระเงินไม่ได้ค่ะ กรุณาบอกแพ็กเกจเพื่อตรวจราคาใหม่' : 'กำลังตรวจสอบหน้าชำระเงินค่ะ ยังไม่ต้องเริ่มรายการใหม่'] };
      }
      // Keep the same immutable signed facts and idempotency key; a second press resumes this attempt.
      await this.store.remember(ctx.companyId, this.key(chat), entry);
      await this.store.discard(ctx.companyId, this.key(chat));
      return { reply: entry.view.lines[0]!, view: entry.view };
    } catch (error) { return { reply: this.refusal(error) }; }
    finally {
      await this.store.releaseClaim(ctx.companyId, this.key(chat), claim.token);
    }
  }
  private refusal(error: unknown): string {
    if (!(error instanceof HttpException)) throw error;
    if (error instanceof ForbiddenException) return PACKAGE_PURCHASE_PERMISSION;
    const response = error.getResponse(), code = typeof response === 'object' ? String((response as any).code ?? '') : '';
    if (code === 'BILLING_EXISTING_SUBSCRIPTION') return 'มีรายการชำระเงินเดิมอยู่แล้วค่ะ กรุณาตรวจรายการเดิมก่อน';
    if (/CAPACITY/u.test(code)) return 'ต้องเลือกสาขาหรือผู้ใช้ที่จะคงไว้ก่อนซื้อแพ็กเกจนี้ค่ะ';
    if (/STALE|CHANGED/u.test(code)) return EXPIRED;
    // Billing's public Thai messages already explain authoritative holds; never expose provider/internal codes.
    const message = typeof response === 'object' ? (response as any).message : '';
    return typeof message === 'string' && /^[ก-๙\s\d.,()“”/ๆ–-]+$/u.test(message)
      ? `${message.replace(/[ค่ะคะ]+$/u, '')}ค่ะ` : 'ยังสร้างลิงก์จ่ายไม่ได้ค่ะ กรุณาตรวจรายการชำระเงินหรือต่ออายุที่ค้างอยู่ก่อน';
  }
}
