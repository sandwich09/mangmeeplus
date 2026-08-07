import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  RequestContext,
  ConnectMessagingChannelInput,
  RotateMessagingChannelCredentialInput,
  DisableMessagingChannelInput,
  MessagingChannelSummary,
  TestMessagingChannelResult,
  RevealMessagingChannelCredentialResult,
  UpdateMessagingChannelSettingsRequest,
  UpdateMessagingChannelSettingsResponse,
} from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { encryptCredential, decryptCredential } from '../../../system-partner-management/domain/logic/credential-cipher.logic';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { LineMessagingAdapter } from '../../infrastructure/line-messaging.adapter';
import type { CompanyMessagingChannelRecord } from '../../domain/models/crm-inbox.model';
import {
  credentialLast4,
  normalizeConnectInput,
  validateChannelCredentialInput,
} from '../../domain/logic/crm-inbox.logic';
import { WEBHOOK_KEY_BYTES } from '../../domain/crm-inbox.constants';
import { toChannelSummary } from '../dto/crm-inbox.mapper';

function requirePermission(ctx: RequestContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}

type ChannelSecrets = { channelId: string; channelSecret: string; accessToken: string };

function normalizeOptionalId(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${field} must be a non-empty string or null`);
  return value.trim();
}

function channelSettings(record: CompanyMessagingChannelRecord) {
  return {
    autoReplyEnabled: record.autoReplyEnabled,
    autoReplyDailyCap: record.autoReplyDailyCap,
    defaultBookingStaffUserId: record.defaultBookingStaffUserId,
    defaultBookingBranchId: record.defaultBookingBranchId,
  };
}

/** Shared helpers for the channel use-cases. */
@Injectable()
export class MessagingChannelSecretsService {
  constructor(private readonly config: AppConfigService) {}

  encrypt(secrets: ChannelSecrets): string {
    return encryptCredential(JSON.stringify(secrets), this.config.credentialEncryptionKey);
  }

  decrypt(record: CompanyMessagingChannelRecord): ChannelSecrets {
    return JSON.parse(decryptCredential(record.encryptedSecretJson, this.config.credentialEncryptionKey)) as ChannelSecrets;
  }

  channelDtoOptions(ctx: RequestContext | null): { includeWebhook: boolean; publicBaseUrl?: string } {
    return {
      includeWebhook: ctx?.permissions.includes('crm.channel.manage') ?? false,
      // Webhook URLs must point at the API's public origin, not the web app.
      publicBaseUrl: this.config.publicApiBaseUrl,
    };
  }
}

@Injectable()
export class ListMessagingChannelsUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly secrets: MessagingChannelSecretsService,
  ) {}

  async execute(ctx: RequestContext): Promise<MessagingChannelSummary[]> {
    requirePermission(ctx, 'crm.channel.read');
    const channels = await this.repo.listChannels(ctx.companyId);
    const opts = this.secrets.channelDtoOptions(ctx);
    return channels.map((c) => toChannelSummary(c, opts));
  }
}

@Injectable()
export class UpdateMessagingChannelSettingsUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly secrets: MessagingChannelSecretsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(
    ctx: RequestContext,
    channelId: string,
    input: UpdateMessagingChannelSettingsRequest,
  ): Promise<UpdateMessagingChannelSettingsResponse> {
    requirePermission(ctx, 'crm.channel.manage');
    if (typeof input?.autoReplyEnabled !== 'boolean') {
      throw new BadRequestException('autoReplyEnabled must be a boolean');
    }
    if (!Number.isInteger(input.autoReplyDailyCap) || input.autoReplyDailyCap < 0) {
      throw new BadRequestException('autoReplyDailyCap must be an integer greater than or equal to 0');
    }
    const defaultBookingStaffUserId = normalizeOptionalId(input.defaultBookingStaffUserId, 'defaultBookingStaffUserId');
    const defaultBookingBranchId = normalizeOptionalId(input.defaultBookingBranchId, 'defaultBookingBranchId');

    const channel = await this.repo.findChannelById(ctx.companyId, channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const effectiveStaffUserId = defaultBookingStaffUserId === undefined
      ? channel.defaultBookingStaffUserId
      : defaultBookingStaffUserId;
    const effectiveBranchId = defaultBookingBranchId === undefined
      ? channel.defaultBookingBranchId
      : defaultBookingBranchId;
    if (effectiveStaffUserId && !await this.repo.hasActiveCompanyMember(ctx.companyId, effectiveStaffUserId)) {
      throw new BadRequestException('defaultBookingStaffUserId must be an active company member');
    }
    if (defaultBookingBranchId && !await this.repo.hasCompanyBranch(ctx.companyId, defaultBookingBranchId)) {
      throw new BadRequestException('defaultBookingBranchId must belong to the company');
    }
    if (Boolean(effectiveStaffUserId) !== Boolean(effectiveBranchId)) {
      throw new BadRequestException('Default booking staff and branch must be configured together');
    }
    if (
      effectiveBranchId &&
      defaultBookingBranchId === undefined &&
      !await this.repo.hasCompanyBranch(ctx.companyId, effectiveBranchId)
    ) {
      throw new BadRequestException('defaultBookingBranchId must belong to the company');
    }
    if (
      effectiveStaffUserId &&
      effectiveBranchId &&
      !await this.repo.hasActiveBookingStaffBranch(ctx.companyId, effectiveStaffUserId, effectiveBranchId)
    ) {
      throw new BadRequestException('Default booking staff cannot access the selected active branch');
    }

    const updated = await this.repo.updateChannel(channel.id, {
      autoReplyEnabled: input.autoReplyEnabled,
      autoReplyDailyCap: input.autoReplyDailyCap,
      ...(defaultBookingStaffUserId !== undefined ? { defaultBookingStaffUserId } : {}),
      ...(defaultBookingBranchId !== undefined ? { defaultBookingBranchId } : {}),
    });
    const before = channelSettings(channel);
    const after = channelSettings(updated);

    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'crm.channel.settings.update',
      targetType: 'company_messaging_channel',
      targetId: channel.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { before, after },
    });
    await this.outbox.append('crm.channel.settings.updated', 'company_messaging_channel', channel.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'company_messaging_channel',
      aggregateId: channel.id,
      occurredAt: new Date().toISOString(),
      data: { before, after },
    });

    return toChannelSummary(updated, this.secrets.channelDtoOptions(ctx));
  }
}

@Injectable()
export class ConnectMessagingChannelUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly secrets: MessagingChannelSecretsService,
    private readonly line: LineMessagingAdapter,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, rawInput: ConnectMessagingChannelInput): Promise<MessagingChannelSummary> {
    requirePermission(ctx, 'crm.channel.manage');
    const input = normalizeConnectInput(rawInput);
    const validationError = validateChannelCredentialInput(input);
    if (validationError) throw new BadRequestException(validationError);

    // Validate credentials with LINE FIRST so a caller without a working token
    // for this channel cannot probe which channel ids are taken (squatting oracle).
    const botInfo = await this.line.getBotInfo(input.accessToken);
    if (!botInfo.ok) throw new BadRequestException(`LINE connection failed: ${botInfo.error}`);

    // Best-effort: when LINE exposes the token's channel id, the claimed id must
    // match. Fails open on null (older long-lived tokens), never on mismatch.
    const tokenChannelId = await this.line.getTokenChannelId(input.accessToken);
    if (tokenChannelId && tokenChannelId !== input.lineChannelId) {
      throw new BadRequestException('Channel ID does not match the access token. Check the LINE Developers Console.');
    }

    // Same posture for the secret: getBotInfo only exercises the token, so a
    // wrong secret used to pass connect and surface later as webhook Verify
    // 401. Fails open on null (LINE outage), never on an explicit mismatch.
    const secretValid = await this.line.verifyChannelSecret(input.lineChannelId, input.channelSecret);
    if (secretValid === false) {
      throw new BadRequestException('Channel Secret does not match this channel. Copy it from Basic settings of this Messaging API channel.');
    }

    // One LINE channel can back only one active WatchDog channel, in any company.
    // Do not leak which company holds it. (DB partial unique index is the backstop.)
    const activeElsewhere = await this.repo.findActiveChannelByLineChannelId(input.lineChannelId);
    if (activeElsewhere) throw new BadRequestException('This LINE channel is already connected.');

    const encryptedSecretJson = this.secrets.encrypt({
      channelId: input.lineChannelId,
      channelSecret: input.channelSecret,
      accessToken: input.accessToken,
    });

    // Reconnect path: a soft-disabled row for this company+channel is revived
    // (same row keeps identities/conversations pointing at it) instead of
    // colliding with the unique(companyId, provider, lineChannelId) constraint.
    const previous = await this.repo.findCompanyChannelByLineChannelId(ctx.companyId, input.lineChannelId);

    let saved;
    try {
      saved = previous
        ? await this.repo.updateChannel(previous.id, {
            displayName: input.displayName,
            encryptedSecretJson,
            credentialLast4: credentialLast4(input.accessToken),
            secretVersion: { increment: 1 },
            webhookKey: randomBytes(WEBHOOK_KEY_BYTES).toString('base64url'),
            status: 'CONNECTED',
            lastValidatedAt: new Date(),
            lastErrorAt: null,
            lastErrorCode: null,
            connectedByUserId: ctx.userId,
            disabledAt: null,
            disabledByUserId: null,
            disableReason: null,
          })
        : await this.repo.createChannel({
            companyId: ctx.companyId,
            provider: 'LINE_OA',
            displayName: input.displayName,
            lineChannelId: input.lineChannelId,
            encryptedSecretJson,
            credentialLast4: credentialLast4(input.accessToken),
            webhookKey: randomBytes(WEBHOOK_KEY_BYTES).toString('base64url'),
            status: 'CONNECTED',
            lastValidatedAt: new Date(),
            connectedByUserId: ctx.userId,
          });
    } catch (error) {
      // Partial unique index race: another company connected first.
      if ((error as { code?: string }).code === 'P2002') {
        throw new BadRequestException('This LINE channel is already connected.');
      }
      throw error;
    }

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: previous ? 'crm.channel.reconnect' : 'crm.channel.connect',
      targetType: 'company_messaging_channel',
      targetId: saved.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { lineChannelId: input.lineChannelId, botDisplayName: botInfo.botDisplayName },
    });
    void this.outbox.append('crm.channel.connected', 'company_messaging_channel', saved.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'company_messaging_channel',
      aggregateId: saved.id,
      occurredAt: new Date().toISOString(),
      data: { lineChannelId: input.lineChannelId, reconnected: Boolean(previous) },
    });

    return toChannelSummary(saved, this.secrets.channelDtoOptions(ctx));
  }
}

@Injectable()
export class TestMessagingChannelUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly secrets: MessagingChannelSecretsService,
    private readonly line: LineMessagingAdapter,
  ) {}

  async execute(ctx: RequestContext, channelId: string): Promise<TestMessagingChannelResult> {
    requirePermission(ctx, 'crm.channel.manage');
    const channel = await this.repo.findChannelById(ctx.companyId, channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    // A failed test must never move a DISABLED channel to ERROR — the webhook
    // only drops DISABLED, so that would silently re-enable ingestion.
    if (channel.status === 'DISABLED') throw new BadRequestException('Channel is disabled');

    const creds = this.secrets.decrypt(channel);
    const botInfo = await this.line.getBotInfo(creds.accessToken);
    if (botInfo.ok) {
      await this.repo.updateChannel(channel.id, {
        lastValidatedAt: new Date(),
        lastErrorCode: null,
        ...(channel.status === 'ERROR' ? { status: 'CONNECTED' } : {}),
      });
      return { ok: true, botDisplayName: botInfo.botDisplayName };
    }
    await this.repo.updateChannel(channel.id, {
      status: 'ERROR',
      lastErrorAt: new Date(),
      lastErrorCode: botInfo.error,
    });
    return { ok: false, error: botInfo.error };
  }
}

@Injectable()
export class RotateMessagingChannelCredentialUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly secrets: MessagingChannelSecretsService,
    private readonly line: LineMessagingAdapter,
    private readonly audit: AuditService,
  ) {}

  async execute(
    ctx: RequestContext,
    channelId: string,
    input: RotateMessagingChannelCredentialInput,
  ): Promise<MessagingChannelSummary> {
    requirePermission(ctx, 'crm.channel.manage');
    const channel = await this.repo.findChannelById(ctx.companyId, channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.status === 'DISABLED') throw new BadRequestException('Channel is disabled');

    const channelSecret = input.channelSecret.trim();
    const accessToken = input.accessToken.trim();
    const validationError = validateChannelCredentialInput({ channelSecret, accessToken });
    if (validationError) throw new BadRequestException(validationError);

    const botInfo = await this.line.getBotInfo(accessToken);
    if (!botInfo.ok) throw new BadRequestException(`LINE connection failed: ${botInfo.error}`);

    // Same secret probe as connect — rotate is exactly where a wrong secret
    // gets "fixed", so letting a bad one through here defeats the guard.
    const secretValid = await this.line.verifyChannelSecret(channel.lineChannelId, channelSecret);
    if (secretValid === false) {
      throw new BadRequestException('Channel Secret does not match this channel. Copy it from Basic settings of this Messaging API channel.');
    }

    const updated = await this.repo.updateChannel(channel.id, {
      encryptedSecretJson: this.secrets.encrypt({
        channelId: channel.lineChannelId,
        channelSecret,
        accessToken,
      }),
      credentialLast4: credentialLast4(accessToken),
      secretVersion: { increment: 1 },
      status: 'CONNECTED',
      lastValidatedAt: new Date(),
      lastErrorCode: null,
      ...(input.rotateWebhookKey ? { webhookKey: randomBytes(WEBHOOK_KEY_BYTES).toString('base64url') } : {}),
    });

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'crm.channel.rotate_credential',
      targetType: 'company_messaging_channel',
      targetId: channel.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { rotatedWebhookKey: Boolean(input.rotateWebhookKey) },
    });

    return toChannelSummary(updated, this.secrets.channelDtoOptions(ctx));
  }
}

@Injectable()
export class DisableMessagingChannelUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly secrets: MessagingChannelSecretsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, channelId: string, input: DisableMessagingChannelInput): Promise<MessagingChannelSummary> {
    requirePermission(ctx, 'crm.channel.manage');
    if (!input.reason?.trim()) throw new BadRequestException('reason is required');
    const channel = await this.repo.findChannelById(ctx.companyId, channelId);
    if (!channel) throw new NotFoundException('Channel not found');

    const updated = await this.repo.updateChannel(channel.id, {
      status: 'DISABLED',
      disabledAt: new Date(),
      disabledByUserId: ctx.userId,
      disableReason: input.reason.trim(),
    });

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'crm.channel.disable',
      targetType: 'company_messaging_channel',
      targetId: channel.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { reason: input.reason.trim() },
    });
    void this.outbox.append('crm.channel.disabled', 'company_messaging_channel', channel.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'company_messaging_channel',
      aggregateId: channel.id,
      occurredAt: new Date().toISOString(),
      data: {},
    });

    return toChannelSummary(updated, this.secrets.channelDtoOptions(ctx));
  }
}

@Injectable()
export class RevealMessagingChannelCredentialUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly secrets: MessagingChannelSecretsService,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, channelId: string): Promise<RevealMessagingChannelCredentialResult> {
    requirePermission(ctx, 'crm.channel.manage');
    const channel = await this.repo.findChannelById(ctx.companyId, channelId);
    if (!channel) throw new NotFoundException('Channel not found');

    const creds = this.secrets.decrypt(channel);

    // Credential read-back is the highest-risk action on this surface:
    // AWAITED on purpose — if the audit write fails, no secrets leave the API.
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'crm.channel.reveal_credential',
      targetType: 'company_messaging_channel',
      targetId: channel.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'CRITICAL',
      metadataJson: { lineChannelId: channel.lineChannelId },
    });

    return {
      lineChannelId: creds.channelId,
      channelSecret: creds.channelSecret,
      accessToken: creds.accessToken,
    };
  }
}
