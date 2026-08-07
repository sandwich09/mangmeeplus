export type AuditResult = 'SUCCESS' | 'DENIED' | 'FAILED';
export type AuditRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Durable actor kind for an audit row. Omitted => USER (backward compatible). */
export type AuditActorType = 'USER' | 'SYSTEM' | 'CRM_CUSTOMER' | 'SERVICE';

export type AuditLogEntry = {
  /** Defaults to USER when omitted. Non-USER actors carry identity in actorRefId. */
  actorType?: AuditActorType;
  actorUserId?: string;
  /** Non-User principal id (system job / CRM customer / service); never a User FK. */
  actorRefId?: string;
  companyId?: string;
  /** Use AuditActionValue from audit-action.ts for known actions. */
  action: string;
  targetType: string;
  targetId?: string;
  requestId: string;
  result: AuditResult;
  riskLevel?: AuditRiskLevel;
  metadataJson?: Record<string, unknown>;
};

/** Read-side record returned by repository queries; includes DB-generated fields. */
export type AuditLogRecord = AuditLogEntry & {
  id: string;
  createdAt: Date;
};
