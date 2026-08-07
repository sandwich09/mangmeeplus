export type SessionRevocationInput = {
  userId: string;
  exceptTokenId?: string;
  now?: Date;
};

type AuthSessionUpdateManyDelegate = {
  updateMany(args: {
    where: {
      userId: string;
      status: 'ACTIVE';
      tokenId?: { not: string };
    };
    data: {
      status: 'REVOKED';
      revokedAt: Date;
    };
  }): Promise<{ count: number }>;
};

export async function revokeActiveSessions(
  authSession: AuthSessionUpdateManyDelegate,
  input: SessionRevocationInput,
): Promise<number> {
  const where: {
    userId: string;
    status: 'ACTIVE';
    tokenId?: { not: string };
  } = {
    userId: input.userId,
    status: 'ACTIVE',
  };

  if (input.exceptTokenId) {
    where.tokenId = { not: input.exceptTokenId };
  }

  const result = await authSession.updateMany({
    where,
    data: {
      status: 'REVOKED',
      revokedAt: input.now ?? new Date(),
    },
  });

  return result.count;
}
