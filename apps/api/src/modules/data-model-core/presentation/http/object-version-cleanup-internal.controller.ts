import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { ObjectVersionCleanupService } from '../../application/services/object-version-cleanup.service';

@Public()
@Controller('internal/storage-cleanup/object-versions')
export class ObjectVersionCleanupInternalController {
  constructor(private readonly cleanup: ObjectVersionCleanupService) {}

  @Post('claim')
  claim(@Headers('x-worker-token') token: string | undefined, @Body() body: { batchSize?: number }) {
    assertWorkerToken(token);
    return this.cleanup.claim(body?.batchSize);
  }

  @Post(':id/complete')
  async complete(
    @Headers('x-worker-token') token: string | undefined,
    @Param('id') id: string,
    @Body() body: { claimToken: string },
  ) {
    assertWorkerToken(token);
    return { written: await this.cleanup.complete(id, body.claimToken) };
  }

  @Post(':id/fail')
  async fail(
    @Headers('x-worker-token') token: string | undefined,
    @Param('id') id: string,
    @Body() body: { claimToken: string; errorCode: string },
  ) {
    assertWorkerToken(token);
    return { written: await this.cleanup.fail(id, body.claimToken, body.errorCode) };
  }
}
