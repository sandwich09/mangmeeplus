import { BadRequestException, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../../../common/security/public.decorator';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { inlineDownloadContentType } from '../../domain/logic/attachment.logic';
import { LocalStorageAdapter } from '../../infrastructure/storage/local-storage.adapter';

@Public()
@Controller('local-storage')
export class LocalStorageController {
  constructor(
    private readonly config: AppConfigService,
    private readonly storage: LocalStorageAdapter,
  ) {}

  @Put('upload/:token')
  @HttpCode(204)
  async upload(@Param('token') token: string, @Req() req: Request): Promise<void> {
    if (!this.config.isLocal) throw new NotFoundException();
    if (!/^[a-f0-9]{32}$/.test(token)) throw new NotFoundException();
    try {
      await this.storage.storeUpload(token, await readBody(req, this.config.uploadMaxBytes));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ConflictException('Upload URL has already been used.');
      throw error;
    }
  }


  @Get('download/:token')
  async download(
    @Param('token') token: string,
    @Query('contentType') contentType: string | undefined,
    @Query('versionId') versionId: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (!this.config.isLocal) throw new NotFoundException();
    if (!/^[a-f0-9]{32}$/.test(token)) throw new NotFoundException();
    const allowedType = inlineDownloadContentType(contentType);
    try {
      if (versionId && !/^[a-f0-9]{64}$/.test(versionId)) throw new NotFoundException();
      response.type(allowedType).send(await this.storage.readStoredToken(token, versionId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException();
      if ((error as Error).message === 'Local object version does not match immutable evidence.') throw new NotFoundException();
      throw error;
    }
  }
}

function readBody(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let total = 0;
    let settled = false;
    const chunks: Buffer[] = [];
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(Buffer.concat(chunks));
    };
    req.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > maxBytes) {
        req.destroy();
        done(new BadRequestException('Uploaded file exceeds size limit.'));
        return;
      }
      chunks.push(bytes);
    });
    req.on('end', () => done());
    req.on('error', done);
  });
}
