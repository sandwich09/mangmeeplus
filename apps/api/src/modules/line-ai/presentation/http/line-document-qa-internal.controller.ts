import { Body, Controller, Headers, Post } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { LineDocumentQaWorker } from '../../application/line-document-qa.worker';

class LineDocumentQaDrainDto {
  @IsInt() @Min(1) @Max(2) @IsOptional() batchSize?: number;
}

@Public()
@Controller('internal/ai/line-document-qa')
export class LineDocumentQaInternalController {
  constructor(private readonly worker: LineDocumentQaWorker) {}

  @Post('drain')
  drain(@Headers('x-worker-token') token: string | undefined, @Body() body: LineDocumentQaDrainDto): Promise<{ claimed: number }> {
    assertWorkerToken(token);
    return this.worker.drain(body?.batchSize ?? 2);
  }
}
