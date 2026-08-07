import { Injectable } from '@nestjs/common';
import type { AuthMailerPort } from '../domain/ports/auth-mailer.port';

@Injectable()
export class DisabledAuthMailerAdapter implements AuthMailerPort {
  async sendEmailVerification(): Promise<void> {}

  async sendPasswordResetLink(): Promise<void> {}
}
