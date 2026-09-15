import { lockEmailRecoveryAccount } from '../email-recovery-lock';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { hashPassword, verifyPassword } from '../../domain/logic/password-credential.logic';
import { PASSWORD_REUSE } from './change-password.use-case';
import { EMAIL_RECOVERY_TOKEN, emailRecoveryBinding, emailRecoveryCredential, hashToken } from '../../domain/logic/secure-token.logic';
import { AuditAction } from '../../../audit/domain/models/audit-action';

const invalid=()=>new ForbiddenException({code:'email_reset_invalid',message:'Password reset link is invalid, expired, or already used.'});
@Injectable()
export class ConfirmPasswordResetUseCase {
  constructor(private readonly prisma:PrismaService){}
  async execute(input:{token:string;newPassword:string;requestId?:string}):Promise<{completed:true}>{
    if(!EMAIL_RECOVERY_TOKEN.test(input.token))throw invalid();
    if(typeof input.newPassword!=='string'||input.newPassword.length<8||input.newPassword.length>128)throw new BadRequestException();
    const token=await this.prisma.client.passwordResetToken.findUnique({where:{tokenHash:hashToken(input.token)}});
    if(!token)throw invalid();const parts=input.token.split('.');
    await this.prisma.client.$transaction(async tx=>{
      const account=await lockEmailRecoveryAccount(tx,token.userId);if(!account)throw invalid();
      const {user,member}=account,current=await tx.passwordResetToken.findUnique({where:{id:token.id}});
      if(!current||emailRecoveryBinding(user)!==parts[1])throw invalid();
      // No login session is issued. A lost-response replay only confirms the same completed change.
      const now=new Date(),samePassword=verifyPassword(input.newPassword,user.credential!.passwordHash);
      if(current.status==='USED'&&current.expiresAt>now&&current.usedAt&&user.credential!.updatedAt.getTime()===current.usedAt.getTime()&&now.getTime()-current.usedAt.getTime()<=5*60000&&samePassword)return;
      if(current.status!=='PENDING'||current.expiresAt<=now||emailRecoveryCredential(user)!==parts[2])throw invalid();
      if(samePassword)throw new BadRequestException(PASSWORD_REUSE);
      const claimed=await tx.passwordResetToken.updateMany({where:{id:current.id,status:'PENDING',expiresAt:{gt:now}},data:{status:'USED',usedAt:now}});
      if(claimed.count!==1)throw invalid();
      await tx.userCredential.update({where:{userId:user.id},data:{passwordHash:hashPassword(input.newPassword),status:'ACTIVE',mustChangePassword:false,expiresAt:null,tempPasswordEncrypted:null,updatedAt:now}});
      const revoked=await tx.authSession.updateMany({where:{userId:user.id,status:'ACTIVE'},data:{status:'REVOKED',revokedAt:now}});
      await tx.passwordResetToken.updateMany({where:{userId:user.id,status:'PENDING'},data:{status:'REVOKED'}});
      await tx.auditLog.create({data:{companyId:member.companyId,actorUserId:user.id,action:AuditAction.AUTH_PASSWORD_RESET_CONFIRM,targetType:'PasswordResetToken',targetId:current.id,
        requestId:input.requestId??current.id,result:'SUCCESS',riskLevel:'HIGH',metadataJson:{channel:'EMAIL',revokedSessionCount:revoked.count}}});
    });return {completed:true};
  }
}
