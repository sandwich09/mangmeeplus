import type { ValidationPipeOptions } from '@nestjs/common';

// Single source for the global ValidationPipe config so DTO boundary specs
// (e.g. ledger.dtos.spec.ts) exercise the exact gate production runs — a spec
// asserting a stale copy of these options is false confidence.
export const GLOBAL_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  forbidNonWhitelisted: true,
  transform: true,
  whitelist: true,
};
