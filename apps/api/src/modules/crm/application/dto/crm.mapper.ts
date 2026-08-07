import type {
  CrmCustomerSummary,
  CrmCustomerDetail,
  CrmContactSummary,
  CrmLeadSummary,
  CrmPipelineStageSummary,
  CrmOpportunitySummary,
  CrmOpportunityDetail,
  CrmActivitySummary,
  CrmFollowUpSummary,
  CrmQuotationLinkSummary,
  CrmBookingSummary,
  CrmCustomerLineIdentitySummary,
} from '@watchdog-bms/contracts';
import type {
  CrmCustomerRecord,
  CrmContactRecord,
  CrmLeadRecord,
  CrmPipelineStageRecord,
  CrmOpportunityRecord,
  CrmActivityRecord,
  CrmFollowUpRecord,
  CrmQuotationLinkRecord,
  CrmBookingRecord,
  CrmCustomerLineIdentityRecord,
} from '../../domain/models/crm.model';

const iso = (d?: Date): string | undefined => (d ? d.toISOString() : undefined);

export function toCustomerSummary(c: CrmCustomerRecord): CrmCustomerSummary {
  const identities = c.lineIdentities ?? [];
  const lineIdentityStatus = identities.find((identity) => identity.status === 'ACTIVE')?.status ?? identities[0]?.status;
  return {
    id: c.id,
    companyId: c.companyId,
    branchId: c.branchId,
    accountingCounterpartyId: c.accountingCounterpartyId,
    code: c.code,
    displayName: c.displayName,
    legalName: c.legalName,
    customerType: c.customerType,
    status: c.status,
    ownerUserId: c.ownerUserId,
    primaryPhone: c.primaryPhone,
    primaryEmail: c.primaryEmail,
    taxId: c.taxId,
    consentStatus: c.consentStatus,
    originSource: c.originSource,
    createdByType: c.createdByType,
    lineIdentityCount: identities.length,
    lineIdentityStatus,
    hasVerifiedLineIdentity: identities.some((identity) => Boolean(identity.verifiedLinkAt)),
    tier: c.tier,
    engagementScore: c.engagementScore,
    lifetimeValueAmount: c.lifetimeValueAmount,
    lastActivityAt: iso(c.lastActivityAt),
    nextFollowUpAt: iso(c.nextFollowUpAt),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toCustomerDetail(c: CrmCustomerRecord): CrmCustomerDetail {
  return {
    ...toCustomerSummary(c),
    lineIdentities: (c.lineIdentities ?? []).map(toCustomerLineIdentitySummary),
    facebookId: c.facebookId,
    source: c.source,
    notes: c.notes,
    consentUpdatedAt: iso(c.consentUpdatedAt),
    consentNote: c.consentNote,
    archivedAt: iso(c.archivedAt),
    archiveReason: c.archiveReason,
    mergedIntoCustomerId: c.mergedIntoCustomerId,
    contacts: (c.contacts ?? []).map(toContactSummary),
  };
}

export function toCustomerLineIdentitySummary(identity: CrmCustomerLineIdentityRecord): CrmCustomerLineIdentitySummary {
  const suffix = identity.providerUserId.slice(-4);
  return {
    id: identity.id,
    channelId: identity.channelId,
    provider: identity.provider,
    displayName: identity.displayName,
    maskedProviderUserId: `••••${suffix}`,
    status: identity.status,
    verifiedLinkAt: iso(identity.verifiedLinkAt),
    verifiedLinkVia: identity.verifiedLinkVia,
  };
}

export function toContactSummary(c: CrmContactRecord): CrmContactSummary {
  return {
    id: c.id,
    companyId: c.companyId,
    customerId: c.customerId,
    name: c.name,
    role: c.role,
    phone: c.phone,
    email: c.email,
    preferredChannel: c.preferredChannel,
    consentStatus: c.consentStatus,
    isPrimary: c.isPrimary,
    note: c.note,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toLeadSummary(l: CrmLeadRecord): CrmLeadSummary {
  return {
    id: l.id,
    companyId: l.companyId,
    branchId: l.branchId,
    source: l.source,
    rawName: l.rawName,
    rawPhone: l.rawPhone,
    rawEmail: l.rawEmail,
    status: l.status,
    assignedToUserId: l.assignedToUserId,
    convertedCustomerId: l.convertedCustomerId,
    convertedOpportunityId: l.convertedOpportunityId,
    disqualifiedReason: l.disqualifiedReason,
    note: l.note,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

export function toStageSummary(s: CrmPipelineStageRecord): CrmPipelineStageSummary {
  return {
    id: s.id,
    companyId: s.companyId,
    name: s.name,
    canonicalGroup: s.canonicalGroup,
    sortOrder: s.sortOrder,
    probabilityDefault: s.probabilityDefault,
    isTerminalWon: s.isTerminalWon,
    isTerminalLost: s.isTerminalLost,
    isActive: s.isActive,
  };
}

export function toOpportunitySummary(o: CrmOpportunityRecord): CrmOpportunitySummary {
  return {
    id: o.id,
    companyId: o.companyId,
    branchId: o.branchId,
    customerId: o.customerId,
    customerDisplayName: o.customerDisplayName,
    leadId: o.leadId,
    ownerUserId: o.ownerUserId,
    title: o.title,
    stageId: o.stageId,
    canonicalStageGroup: o.canonicalStageGroup,
    status: o.status,
    amountEstimate: o.amountEstimate,
    currency: o.currency,
    probability: o.probability,
    expectedCloseDate: iso(o.expectedCloseDate),
    closedAt: iso(o.closedAt),
    closeReason: o.closeReason,
    lostReason: o.lostReason,
    lastActivityAt: iso(o.lastActivityAt),
    nextFollowUpAt: iso(o.nextFollowUpAt),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function toOpportunityDetail(o: CrmOpportunityRecord): CrmOpportunityDetail {
  return {
    ...toOpportunitySummary(o),
    createdByUserId: o.createdByUserId,
    quotationLinks: (o.quotationLinks ?? []).map(toQuotationLinkSummary),
    followUps: (o.followUps ?? []).map(toFollowUpSummary),
    activities: (o.activities ?? []).map(toActivitySummary),
  };
}

export function toActivitySummary(a: CrmActivityRecord): CrmActivitySummary {
  return {
    id: a.id,
    companyId: a.companyId,
    customerId: a.customerId,
    leadId: a.leadId,
    opportunityId: a.opportunityId,
    followUpTaskId: a.followUpTaskId,
    actorUserId: a.actorUserId,
    type: a.type,
    channel: a.channel,
    outcome: a.outcome,
    note: a.note,
    occurredAt: a.occurredAt.toISOString(),
    createdAt: a.createdAt.toISOString(),
  };
}

export function toFollowUpSummary(f: CrmFollowUpRecord): CrmFollowUpSummary {
  return {
    id: f.id,
    companyId: f.companyId,
    customerId: f.customerId,
    leadId: f.leadId,
    opportunityId: f.opportunityId,
    ownerUserId: f.ownerUserId,
    title: f.title,
    dueAt: f.dueAt.toISOString(),
    timezone: f.timezone,
    priority: f.priority,
    channel: f.channel,
    status: f.status,
    completedAt: iso(f.completedAt),
    snoozedUntil: iso(f.snoozedUntil),
    cancelReason: f.cancelReason,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

export function toQuotationLinkSummary(q: CrmQuotationLinkRecord): CrmQuotationLinkSummary {
  return {
    id: q.id,
    companyId: q.companyId,
    customerId: q.customerId,
    opportunityId: q.opportunityId,
    accountingDocumentId: q.accountingDocumentId,
    accountingDocumentType: q.accountingDocumentType,
    accountingDocumentNumber: q.accountingDocumentNumber,
    status: q.status,
    grandTotalAmount: q.grandTotalAmount,
    currency: q.currency,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

export function toBookingSummary(b: CrmBookingRecord): CrmBookingSummary {
  return {
    id: b.id,
    companyId: b.companyId,
    branchId: b.branchId,
    customerId: b.customerId,
    customerName: b.customerName,
    serviceName: b.serviceName,
    staffUserId: b.staffUserId,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    status: b.status,
    source: b.source,
    sourceConversationId: b.sourceConversationId,
    ...(b.depositAmount != null ? { depositAmount: String(b.depositAmount) } : {}),
    ...(b.totalAmount != null ? { totalAmount: String(b.totalAmount) } : {}),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}
