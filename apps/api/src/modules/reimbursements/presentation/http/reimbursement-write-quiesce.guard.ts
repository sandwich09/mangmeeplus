import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../../../common/config/app-config.service';

export const REIMBURSEMENT_UPGRADE_ERROR_CODE = 'reimbursement_upgrade_in_progress';
export const REIMBURSEMENT_UPGRADE_RETRY_AFTER_SECONDS = 60;
export const REIMBURSEMENT_UPGRADE_MESSAGE =
  'ระบบกำลังอัปเกรดส่วนเบิกค่าใช้จ่ายชั่วคราว ข้อมูลที่กรอกยังอยู่ กรุณารอประมาณ 1 นาทีแล้วลองอีกครั้ง';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function assertReimbursementWriteAvailable(config: Pick<AppConfigService, 'reimbursementWriteQuiesce'>): void {
  if (!config.reimbursementWriteQuiesce) return;
  throw new ServiceUnavailableException({
    code: REIMBURSEMENT_UPGRADE_ERROR_CODE,
    message: REIMBURSEMENT_UPGRADE_MESSAGE,
  });
}

/**
 * Controller guard (after auth/permission, before DTO pipes): the bounded production bridge can
 * keep every reimbursement read available without accepting either old or new mutation payloads.
 */
@Injectable()
export class ReimbursementWriteQuiesceGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.reimbursementWriteQuiesce) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (READ_METHODS.has(request.method.toUpperCase())) return true;
    if (request.method.toUpperCase() === 'POST' && /\/reimbursements\/draft-actions\/[^/]+\/cancel\/?$/.test(request.path)) return true;

    http.getResponse<Response>().setHeader(
      'Retry-After',
      String(REIMBURSEMENT_UPGRADE_RETRY_AFTER_SECONDS),
    );
    assertReimbursementWriteAvailable(this.config);
    return true;
  }
}
