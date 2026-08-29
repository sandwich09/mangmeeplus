import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import {
  generateLineWebQrCredentials,
  hashLineWebQrValue,
  LINE_WEB_QR_TTL_MS,
  lineWebQrImageUrl,
  lineWebQrScanUrl,
} from '../../domain/logic/line-web-qr.logic';

export type CreateLineWebLoginTransactionResult = {
  publicCode: string;
  desktopSecret: string;
  qrImageUrl: string;
  scanUrl: string;
  expiresInSeconds: number;
};

/** Same-app relative paths only: no scheme, no protocol-relative, bounded length. */
function sanitizeReturnTo(raw: string | undefined): string | undefined {
  if (!raw || raw.length > 512) return undefined;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return undefined;
  return raw;
}

/**
 * P12-3a step 1: mint a desktop QR login transaction (master plan §13.6E, AUTH-03).
 *
 * Both halves are returned to the BFF exactly once and never persisted raw — the row keeps sha256
 * hashes only, so neither a database reader nor a log line can reconstruct a scannable code or a
 * redeemable secret. The caller hands `publicCode` to the QR and keeps `desktopSecret` in an
 * HttpOnly cookie the browser script cannot read.
 */
@Injectable()
export class CreateLineWebLoginTransactionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(input: { returnTo?: string }): Promise<CreateLineWebLoginTransactionResult> {
    const webBase = this.config.webBaseUrl;
    if (!webBase && this.config.isProduction) {
      throw new ServiceUnavailableException('Web base URL is not configured.');
    }
    const { publicCode, desktopSecret } = generateLineWebQrCredentials();
    const returnTo = sanitizeReturnTo(input.returnTo);
    await this.prisma.client.lineWebLoginTransaction.create({
      data: {
        publicCodeHash: hashLineWebQrValue(publicCode),
        desktopSecretHash: hashLineWebQrValue(desktopSecret),
        expiresAt: new Date(Date.now() + LINE_WEB_QR_TTL_MS),
        ...(returnTo ? { returnTo } : {}),
      },
    });
    const scanUrl = lineWebQrScanUrl(webBase ?? 'http://localhost:3000', publicCode);
    return {
      publicCode,
      desktopSecret,
      qrImageUrl: lineWebQrImageUrl(scanUrl),
      scanUrl,
      expiresInSeconds: Math.floor(LINE_WEB_QR_TTL_MS / 1000),
    };
  }
}
