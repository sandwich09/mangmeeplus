import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CompanyTeamNoteService } from './application/company-team-note.service';

/** Shared by the console and executive modules without importing the whole admin module. */
@Module({ imports: [AuditModule], providers: [CompanyTeamNoteService], exports: [CompanyTeamNoteService] })
export class CompanyTeamNoteModule {}
