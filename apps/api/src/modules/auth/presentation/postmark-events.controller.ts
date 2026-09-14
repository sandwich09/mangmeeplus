import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../../common/security/public.decorator';
import { PostmarkEventsService } from '../application/postmark-events.service';

@Public()
@Controller('public/postmark-events')
export class PostmarkEventsController {
  constructor(private readonly events: PostmarkEventsService) {}
  @Post()
  @HttpCode(200)
  receive(@Req() request: Request) { return this.events.receive(request.headers.authorization, request.body); }
}
