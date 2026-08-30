import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';

export type SetPartnerMemberContactCommand = {
  companyId: string;
  memberUserId: string;
  /** Omitted = unchanged; empty string = clear. Stored lowercase; must be unique across users. */
  email?: string;
  /** Omitted = unchanged; empty string = clear. */
  phoneNumber?: string;
  requestingAdminUserId: string;
  requestId: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+\-() ]{6,20}$/;

function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) {
    throw new UnprocessableEntityException('Invalid email format.');
  }
  return trimmed;
}

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!PHONE_PATTERN.test(trimmed)) {
    throw new UnprocessableEntityException('Invalid phone number format.');
  }
  return trimmed;
}

@Injectable()
export class SetPartnerMemberContactUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: SetPartnerMemberContactCommand): Promise<{ updated: true }> {
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { companyId: cmd.companyId, userId: cmd.memberUserId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Member not found in this partner company.');

    const email = cmd.email === undefined ? undefined : normalizeEmail(cmd.email);
    const phoneNumber = cmd.phoneNumber === undefined ? undefined : normalizePhone(cmd.phoneNumber);
    if (email === undefined && phoneNumber === undefined) {
      throw new UnprocessableEntityException('Nothing to update.');
    }

    if (email) {
      const clash = await this.prisma.client.user.findFirst({
        where: { email, NOT: { id: cmd.memberUserId } },
        select: { id: true },
      });
      if (clash) throw new ConflictException('Email already in use by another user.');
    }

    const before = await this.prisma.client.user.findUnique({
      where: { id: cmd.memberUserId },
      select: { email: true, phoneNumber: true },
    });

    try {
      await this.prisma.client.$transaction([
        this.prisma.client.user.update({
          where: { id: cmd.memberUserId },
          data: {
            ...(email !== undefined ? { email } : {}),
            ...(phoneNumber !== undefined ? { phoneNumber } : {}),
          },
        }),
        this.prisma.client.auditLog.create({
          data: {
            actorUserId: cmd.requestingAdminUserId,
            action: 'system.partner_member.contact_update',
            targetType: 'User',
            targetId: cmd.memberUserId,
            requestId: cmd.requestId,
            result: 'SUCCESS',
            riskLevel: 'HIGH',
            // Booleans only — no raw contact values in audit metadata.
            metadataJson: {
              companyId: cmd.companyId,
              memberUserId: cmd.memberUserId,
              emailChanged: email !== undefined && email !== (before?.email ?? null),
              phoneChanged: phoneNumber !== undefined && phoneNumber !== (before?.phoneNumber ?? null),
            },
          },
        }),
      ]);
    } catch (err: unknown) {
      // The DB unique on User.email closes the pre-check race.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Email already in use by another user.');
      }
      throw err;
    }

    return { updated: true };
  }
}
