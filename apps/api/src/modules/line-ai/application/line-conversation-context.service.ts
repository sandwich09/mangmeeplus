import { parseLineAiTaskProjection, type LineAiTaskProjectionV2 } from '@watchdog-bms/contracts';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

export type LineConversationOwner = { companyId: string; userId: string; membershipId: string; channel: 'line'; channelKind: 'USER'; messagingChannelId: string; chatKeyHash: string };
export type LineTaskProjection = Pick<LineAiTaskProjectionV2, 'version' | 'tasks'>;
export type LinePreferenceValues = { language?: 'th' | 'en'; detail?: 'short' | 'normal' | 'detailed'; presentation?: 'prose' | 'bullets' | 'table' | 'steps' };
const preferenceChoices = { language: ['th', 'en'], detail: ['short', 'normal', 'detailed'], presentation: ['prose', 'bullets', 'table', 'steps'] } as const;
type Preferences = { [K in keyof LinePreferenceValues]?: { value: NonNullable<LinePreferenceValues[K]>; sourceRequestId: string; confirmedAt: string; expiresAt: string } };
export function lineConversationId(owner: LineConversationOwner): string {
  if (owner.channel !== 'line' || owner.channelKind !== 'USER' || Object.values(owner).some(v => typeof v !== 'string' || !v || v.length > 200)) throw new Error('LINE_CONTEXT_INVALID_OWNER');
  return 'line-v2:' + createHash('sha256').update(JSON.stringify([owner.companyId, owner.userId, owner.membershipId, owner.channel, owner.channelKind, owner.messagingChannelId, owner.chatKeyHash])).digest('hex');
}
export function validateTaskProjection(value: LineTaskProjection): void {
  if (!parseLineAiTaskProjection({ ...value, stateVersion: 0, lifecycleEpoch: 0, expiresAtMs: 0 })) throw new Error('LINE_CONTEXT_INVALID_PROJECTION');
}
/** Invalidates retained bound rows in the same lifecycle transaction; never resurrect by upsert. */
export async function invalidateLineConversationState(tx: Prisma.TransactionClient, scope: { companyId?: string; userId: string } | { companyId: string; userId?: string }, deletePreferences: boolean): Promise<number> {
  if (!scope.companyId && !scope.userId) throw new Error('LINE_CONTEXT_SCOPE_REQUIRED');
  const bound = await tx.aiConversation.findMany({ where: { ...scope, channelKind: { not: null } }, select: { id: true, companyId: true, membershipId: true } });
  if (bound.length) {
    await tx.aiConversation.updateMany({ where: { id: { in: bound.map(r => r.id) } }, data: { lifecycleEpoch: { increment: 1 }, stateVersion: { increment: 1 }, taskStateJson: Prisma.DbNull, stateExpiresAt: null,
      ...(deletePreferences ? { preferenceJson: Prisma.DbNull, preferenceExpiresAt: null, preferenceVersion: { increment: 1 } } : {}) } });
    await tx.aiTurn.deleteMany({ where: { conversationId: { in: bound.map(r => r.id) } } });
    await tx.lineIntakePendingMedia.updateMany({ where: { ...scope, status: 'PENDING' }, data: { status: 'EXPIRED', revision: { increment: 1 }, expiresAt: new Date() } });
    await tx.lineDeliveryPlan.updateMany({ where: { ...scope, status: { in: ['READY', 'UNKNOWN', 'WAITING_CONTINUATION'] } }, data: { status: 'REFUSED', cancelReason: 'AUTH_CHANGED' } });
  }
  const legacy = await tx.aiConversation.deleteMany({ where: { ...scope, channelKind: null } });
  return bound.length + legacy.count;
}
@Injectable()
export class LineConversationContextService {
  constructor(private readonly prisma: PrismaService) {}
  /** Admission is the only creator. Call only after current identity, membership and opt-in checks. */
  async admit(owner: LineConversationOwner) {
    const id = lineConversationId(owner);
    const row = await this.prisma.client.aiConversation.upsert({ where: { id }, create: { id, ...owner }, update: {} });
    if (Object.entries(owner).some(([k, v]) => row[k as keyof typeof row] !== v)) throw new Error('LINE_CONTEXT_SCOPE_MISMATCH');
    return row;
  }
  async load(owner: LineConversationOwner, now = new Date()) {
    const row = await this.prisma.client.aiConversation.findFirst({ where: { id: lineConversationId(owner), ...owner } });
    if (!row) return null;
    const state = row.stateExpiresAt && row.stateExpiresAt > now ? row.taskStateJson as LineTaskProjection | null : null;
    if (state) validateTaskProjection(state);
    return { row, state };
  }
  async projection(owner: LineConversationOwner, now = new Date()): Promise<LineAiTaskProjectionV2 | null> {
    const loaded = await this.load(owner, now); if (!loaded) return null;
    return { version: 2, stateVersion: loaded.row.stateVersion, lifecycleEpoch: loaded.row.lifecycleEpoch,
      expiresAtMs: loaded.row.stateExpiresAt?.getTime() ?? now.getTime() + 15 * 60_000, tasks: loaded.state?.tasks ?? [] };
  }
  async save(owner: LineConversationOwner, expectedVersion: number, epoch: number, projection: LineTaskProjection, now = new Date()): Promise<boolean> {
    validateTaskProjection(projection);
    return (await this.prisma.client.aiConversation.updateMany({ where: { id: lineConversationId(owner), ...owner, stateVersion: expectedVersion, lifecycleEpoch: epoch },
      data: { taskStateJson: projection as unknown as Prisma.InputJsonValue, stateVersion: { increment: 1 }, stateExpiresAt: new Date(now.getTime() + 15 * 60_000) } })).count === 1;
  }
  async createTurn(owner: LineConversationOwner, epoch: number, data: Prisma.AiTurnUncheckedCreateInput) {
    const id = lineConversationId(owner);
    if (data.conversationId !== id || data.companyId !== owner.companyId || data.userId !== owner.userId) throw new Error('LINE_CONTEXT_SCOPE_MISMATCH');
    return this.prisma.client.$transaction(async tx => {
      const fence = await tx.aiConversation.updateMany({ where: { id, ...owner, lifecycleEpoch: epoch }, data: { stateVersion: { increment: 0 } } });
      if (fence.count !== 1) throw new Error('LINE_CONTEXT_STALE_EPOCH');
      return tx.aiTurn.create({ data });
    });
  }
  async listPreferences(owner: LineConversationOwner, now = new Date(), retry = 0): Promise<{ version: number; epoch: number; values: LinePreferenceValues } | null> {
    const loaded = await this.load(owner, now); if (!loaded) return null;
    const entries = loaded.row.preferenceJson as Preferences | null, values: LinePreferenceValues = {};
    for (const key of ['language', 'detail', 'presentation'] as const) {
      const entry = entries?.[key];
      if (entry && (preferenceChoices[key] as readonly string[]).includes(entry.value) && typeof entry.sourceRequestId === 'string' && entry.sourceRequestId.length <= 200 && Number.isFinite(Date.parse(entry.confirmedAt)) && Date.parse(entry.expiresAt) > now.getTime()) Object.assign(values, { [key]: entry.value });
    }
    let version = loaded.row.preferenceVersion;
    if (entries && !Object.keys(values).length) {
      const cleaned = await this.prisma.client.aiConversation.updateMany({ where: { id: loaded.row.id, lifecycleEpoch: loaded.row.lifecycleEpoch, preferenceVersion: version },
        data: { preferenceJson: Prisma.DbNull, preferenceExpiresAt: null, preferenceVersion: { increment: 1 } } });
      if (cleaned.count === 1) version += 1;
      else return retry === 0 ? this.listPreferences(owner, now, 1) : null;
    }
    return { version, epoch: loaded.row.lifecycleEpoch, values };
  }
  async changePreferences(owner: LineConversationOwner, command: { requestId: string; expectedVersion: number; epoch: number; set?: LinePreferenceValues; delete?: Array<keyof LinePreferenceValues> | 'all' }, now = new Date()): Promise<'applied' | 'stale'> {
    if (!command.requestId || command.requestId.length > 200 || (!!command.set === !!command.delete)) throw new Error('LINE_PREFERENCE_INVALID_COMMAND');
    const choices = preferenceChoices;
    if (command.set && !Object.keys(command.set).length || Array.isArray(command.delete) && !command.delete.length) throw new Error('LINE_PREFERENCE_INVALID_COMMAND');
    for (const [key, value] of Object.entries(command.set ?? {})) if (!(key in choices) || !(choices[key as keyof typeof choices] as readonly string[]).includes(value)) throw new Error('LINE_PREFERENCE_INVALID_VALUE');
    if (command.delete && command.delete !== 'all' && command.delete.some(k => !(k in choices))) throw new Error('LINE_PREFERENCE_INVALID_VALUE');
    return this.prisma.client.$transaction(async tx => {
      const id = lineConversationId(owner);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-conversation:${id}`}))`;
      const row = await tx.aiConversation.findFirst({ where: { id, ...owner, lifecycleEpoch: command.epoch } });
      if (!row) return 'stale';
      if (row.preferenceRequestId === command.requestId) {
        const current = (row.preferenceJson ?? {}) as Preferences;
        const matching = command.set ? Object.entries(command.set).every(([key, value]) => current[key as keyof Preferences]?.value === value && current[key as keyof Preferences]?.sourceRequestId === command.requestId)
          : (command.delete === 'all' ? Object.keys(current).length === 0 : command.delete!.every(key => !current[key]));
        return matching ? 'applied' : 'stale';
      }
      if (row.preferenceVersion !== command.expectedVersion) return 'stale';
      const existing = (row.preferenceJson ?? {}) as Preferences, next: Preferences = {};
      for (const key of ['language', 'detail', 'presentation'] as const) if (existing[key] && Date.parse(existing[key]!.expiresAt) > now.getTime()) Object.assign(next, { [key]: existing[key] });
      const expiry = new Date(now.getTime() + 90 * 24 * 60 * 60_000);
      for (const [key, value] of Object.entries(command.set ?? {})) Object.assign(next, { [key]: { value, sourceRequestId: command.requestId, confirmedAt: now.toISOString(), expiresAt: expiry.toISOString() } });
      for (const key of command.delete === 'all' ? ['language', 'detail', 'presentation'] as const : command.delete ?? []) delete next[key];
      if (Buffer.byteLength(JSON.stringify(next), 'utf8') > 1024) throw new Error('LINE_PREFERENCE_TOO_LARGE');
      const expiresAt = Object.values(next).reduce((max, entry) => Math.max(max, Date.parse(entry.expiresAt)), 0);
      // Preference revision and expiry are separate from task state (spec §17.2): forgetting a style never drops the
      // chat's open work (NAT11 turn 5, "ไม่ลบเอกสารธุรกิจหรือ task เดิม"); the version bump above fences old readers.
      await tx.aiConversation.update({ where: { id }, data: { preferenceJson: Object.keys(next).length ? next as Prisma.InputJsonValue : Prisma.DbNull, preferenceVersion: { increment: 1 }, preferenceRequestId: command.requestId, preferenceExpiresAt: expiresAt ? new Date(expiresAt) : null } });
      return 'applied';
    });
  }
}
