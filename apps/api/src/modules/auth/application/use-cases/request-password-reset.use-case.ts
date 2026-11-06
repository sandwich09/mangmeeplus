import { lockEmailRecoveryAccount } from '../email-recovery-lock';
import { Inject, Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { generateEmailRecoveryToken, emailRecoveryBinding, emailRecoveryCredential, hashToken } from '../../domain/logic/secure-token.logic';
import { AUTH_MAILER_TOKEN, type AuthMailerPort } from '../../domain/ports/auth-mailer.port';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { EmailDeliveryService } from '../email-delivery.service';
import { PostmarkSendError } from '../../infrastructure/postmark.client';

const GENERIC_MESSAGE='If the account is eligible, a password reset link has been sent.';
@Injectable()
export class RequestPasswordResetUseCase {
  constructor(private readonly prisma:PrismaService,@Inject(AUTH_MAILER_TOKEN) private readonly mailer:AuthMailerPort,
    private readonly config:AppConfigService,private readonly delivery:EmailDeliveryService){}
  async execute(input:{identifier:string;requestId?:string}):Promise<{message:string}>{
    const started=Date.now();
    try{await this.request(input);return {message:GENERIC_MESSAGE};}
    finally{const remaining=this.config.passwordResetResponseMinMs-(Date.now()-started);if(remaining>0)await delay(remaining);}
  }
  private async request(input:{identifier:string;requestId?:string}){
    if(!this.delivery.isPostmark)return;
    const identifier=input.identifier.trim().toLowerCase(),users=await this.prisma.client.user.findMany({where:{OR:[{email:identifier},{username:identifier}]},take:2});
    if(users.length!==1)return;const userId=users[0]!.id;
    const reservation=await this.prisma.client.$transaction(async tx=>{
      const account=await lockEmailRecoveryAccount(tx,userId);if(!account)return null;
      const {user,member}=account;
      const now=new Date(),recent=await tx.passwordResetToken.findMany({where:{userId,createdAt:{gt:new Date(now.getTime()-3600000)}},orderBy:{createdAt:'desc'},take:5});
      if(recent.length>=5||recent[0]&&recent[0].createdAt.getTime()>now.getTime()-60000)return null;
      const rawToken=generateEmailRecoveryToken(user),expiresAt=new Date(now.getTime()+30*60000);
      const token=await tx.passwordResetToken.create({data:{userId,tokenHash:hashToken(rawToken),expiresAt}});
      const attempt=await this.delivery.prepare({companyId:member.companyId,purpose:'password_reset',recipient:user.email!,deadlineAt:expiresAt,intentKey:`email-reset:${token.id}`},tx);
      await tx.passwordResetToken.updateMany({where:{userId,status:'PENDING',id:{not:token.id}},data:{status:'REVOKED'}});
      await tx.auditLog.create({data:{companyId:member.companyId,actorUserId:userId,action:AuditAction.AUTH_PASSWORD_RESET_REQUEST,targetType:'PasswordResetToken',targetId:token.id,
        requestId:input.requestId??token.id,result:'SUCCESS',riskLevel:'MEDIUM',metadataJson:{channel:'EMAIL',attemptId:attempt.id}}});
      return {rawToken,expiresAt,toEmail:user.email!,sendAttemptId:attempt.id,tokenId:token.id};
    }).catch(error=>{if(error instanceof PostmarkSendError)return null;throw error;});
    if(!reservation)return;
    // Provider latency/status must not reveal whether this public identifier exists.
    void (async()=>{
      const user=await this.prisma.client.user.findUnique({where:{id:userId},include:{credential:true}}),parts=reservation.rawToken.split('.');
      const token=await this.prisma.client.passwordResetToken.findUnique({where:{id:reservation.tokenId}});
      const member=await this.prisma.client.companyMembership.findFirst({where:{userId,status:'ACTIVE',company:{OR:[{status:'ACTIVE'},{status:'DISABLED',planTerm:{termDisabledAt:{not:null}}}]}},select:{id:true}});
      if(!user||!member||user.status!=='ACTIVE'||!user.emailVerifiedAt||!user.credential||user.credential.status==='DISABLED'||
        emailRecoveryBinding(user)!==parts[1]||emailRecoveryCredential(user)!==parts[2]||token?.status!=='PENDING'||token.expiresAt<=new Date()){
        await this.prisma.client.emailSendAttempt.updateMany({where:{id:reservation.sendAttemptId,status:'READY',dispatchStartedAt:null},data:{status:'PERMANENT',errorCode:'recovery_binding_changed'}});return;
      }
      await this.mailer.sendPasswordResetLink(reservation);
    })().catch(()=>undefined);
  }
}
