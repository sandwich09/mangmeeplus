import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { DrainExpenseAutoPostUseCase } from '../../application/use-cases/expense-auto-post.use-case';

@Public()
@Controller('internal/ledger/expense-auto-post')
export class ExpenseAutoPostInternalController {
  constructor(private readonly drain: DrainExpenseAutoPostUseCase) {}

  @Post('drain')
  execute(
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: { limit?: number },
  ) {
    assertWorkerToken(token);
    return this.drain.execute(body?.limit);
  }
}
