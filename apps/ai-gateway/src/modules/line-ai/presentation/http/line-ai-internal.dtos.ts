import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';
import type { LineWorkflowClassifyRequest } from '@watchdog-bms/contracts';

export class LineWorkflowClassifyDto implements LineWorkflowClassifyRequest {
  @IsString() @IsNotEmpty() @MaxLength(256)
  requestId!: string;

  @IsString() @IsNotEmpty() @MaxLength(256)
  companyId!: string;

  @IsString() @IsNotEmpty() @MaxLength(256)
  userId!: string;

  @IsIn(['th-TH', 'en-GB'])
  locale!: 'th-TH' | 'en-GB';

  @IsString() @IsNotEmpty() @MaxLength(1000)
  messageText!: string;

  @IsObject()
  inputEvidence!: LineWorkflowClassifyRequest['inputEvidence'];

  @IsObject()
  budgetGrantV2!: LineWorkflowClassifyRequest['budgetGrantV2'];

  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(2) @ArrayUnique()
  @IsIn(['input-evidence-v2', 'budget-envelope-v2'], { each: true })
  contractCapabilities!: ['input-evidence-v2', 'budget-envelope-v2'];
}
