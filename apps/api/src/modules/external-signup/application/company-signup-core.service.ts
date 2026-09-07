import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CompanySignupRequest, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  canTransitionCompanySignup,
  companySignupPayloadHash,
  isCompanySignupFailureState,
  normalizeCompanySignupInput,
  type CompanySignupInput,
  type CompanySignupState,
  type NormalizedCompanySignupInput,
  isStaleProvisioning,
} from '../domain/company-signup.logic';

const SERVICE_ACTOR = 'official-signup-core';
const SPECIAL_PROVISIONING_STATES = new Set<CompanySignupState>(['PROVISIONING', 'READY', 'PROVISIONING_FAILED']);

type ReceiveResult = Readonly<{ request: CompanySignupRequest; replayed: boolean }>;
/**
 * A caller-supplied precondition, evaluated under the advisory lock. `rejectionCode` is what the
 * caller wants the operator to see, so the guard and its message stay in one place.
 */
export type SignupStatePredicate = ((current: CompanySignupRequest) => boolean) & { rejectionCode: string };

/** Attaches the refusal code to a predicate, so a guard cannot be written without one. */
export function signupStateGuard(
  rejectionCode: string,
  predicate: (current: CompanySignupRequest) => boolean,
): SignupStatePredicate {
  return Object.assign(predicate, { rejectionCode });
}

/**
 * Review R08: a transition and the facts that make it true have to commit together. Before this,
 * approve moved the state, then stamped `approvedAt`, then queued the claim email as three separate
 * writes — so a failure between any two of them left an applicant in EMAIL_PENDING waiting on an
 * email nobody would ever send, and the retry saw the state and returned success.
 */
export type SignupAdvanceExtras = Readonly<{
  /** Columns written by the SAME CAS as the state, so metadata cannot part company with it. */
  data?: Prisma.CompanySignupRequestUncheckedUpdateManyInput;
  /**
   * Required side effects — an outbox append, nothing that can block — run inside this
   * transaction. A throw here rolls the transition back with them.
   */
  alsoInTransaction?: (tx: Prisma.TransactionClient) => Promise<void>;
}>;

type ProvisionClaim = Readonly<{
  request: CompanySignupRequest;
  claimed: boolean;
  attemptId: string | null;
  /** True when this claim took the fence from an abandoned attempt (§15.6: an ops-visible event). */
  reclaimedStale?: boolean;
}>;

@Injectable()
export class CompanySignupCoreService {
  constructor(private readonly prisma: PrismaService) {}

  async receive(input: CompanySignupInput, correlationRequestId: string): Promise<ReceiveResult> {
    let normalized: NormalizedCompanySignupInput;
    try {
      normalized = normalizeCompanySignupInput(input);
    } catch (error) {
      throw new UnprocessableEntityException((error as Error).message);
    }
    const payloadHash = companySignupPayloadHash(normalized);

    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, normalized.externalSignupId);
      const existing = await tx.companySignupRequest.findUnique({
        where: { externalSignupId: normalized.externalSignupId },
      });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException('external_signup_payload_conflict');
        return { request: existing, replayed: true };
      }

      const request = await tx.companySignupRequest.create({ data: { ...normalized, payloadHash } });
      await this.appendEvidence(tx, request, null, 'RECEIVED', correlationRequestId);
      return { request, replayed: false };
    });
  }

  /**
   * P10-L: create a request whose fields a source-specific use-case already normalised. Flow B's
   * `receive` above cannot serve the LINE form — it demands an email, a consent version and two
   * name halves that form never asks for — but the RECEIVED evidence and outbox row must be
   * identical, so they come from the same private writer.
   *
   * No advisory lock: the "one open application per LINE account" fence is the partial unique
   * index (review B-05), and a unique violation here aborts this transaction for the caller to map.
   */
  async receiveNormalized(
    data: Prisma.CompanySignupRequestUncheckedCreateInput,
    correlationRequestId: string,
  ): Promise<ReceiveResult> {
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, data.externalSignupId);
      const existing = await tx.companySignupRequest.findUnique({
        where: { externalSignupId: data.externalSignupId },
      });
      if (existing) {
        if (existing.payloadHash !== data.payloadHash) {
          throw new ConflictException('external_signup_payload_conflict');
        }
        return { request: existing, replayed: true };
      }
      const request = await tx.companySignupRequest.create({ data });
      await this.appendEvidence(tx, request, null, 'RECEIVED', correlationRequestId);
      return { request, replayed: false };
    });
  }

  /**
   * `expect` is re-evaluated on the row read UNDER the advisory lock, which is the only snapshot
   * that can still be trusted. A caller that decided from its own earlier read is deciding from a
   * row another transaction may have moved since — and the transition table alone cannot catch it,
   * because it answers "is this edge legal", not "is this edge still the right thing to do".
   */
  async advance(
    requestId: string,
    toState: Exclude<CompanySignupState, 'RECEIVED'>,
    correlationRequestId: string,
    failureCode?: string,
    expect?: SignupStatePredicate,
    extras?: SignupAdvanceExtras,
  ): Promise<ReceiveResult> {
    if (SPECIAL_PROVISIONING_STATES.has(toState)) throw new ConflictException('use_provisioning_boundary');
    return this.changeState(requestId, toState, correlationRequestId, failureCode, expect, extras);
  }

  async claimProvisioning(requestId: string, correlationRequestId: string, now = new Date()): Promise<ProvisionClaim> {
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, requestId);
      const current = await this.findOrThrow(tx, requestId);
      if (current.state === 'READY' || current.state === 'LINE_LINK_PENDING' || current.state === 'COMPLETED') {
        return { request: current, claimed: false, attemptId: null };
      }
      // A PROVISIONING row means someone is mid-flight — unless nobody is. Re-claiming an abandoned
      // one is safe because the retry adopts an already-created company rather than building a
      // second (review MEDIUM-3, HIGH-A), and the conditional stamp inside the onboarding
      // transaction makes even an overlapping pair produce exactly one company.
      const stale = isStaleProvisioning(current, now);
      if (current.state === 'PROVISIONING' && !stale) {
        return { request: current, claimed: false, attemptId: null };
      }
      if (!stale && !canTransitionCompanySignup(current.state as CompanySignupState, 'PROVISIONING', current.source)) {
        throw new ConflictException(`invalid_signup_transition:${current.state}:PROVISIONING`);
      }
      const attemptId = randomUUID();
      const request = await this.casUpdate(tx, current, {
        state: 'PROVISIONING', failureCode: null, provisioningAttemptId: attemptId, provisioningStartedAt: now,
      });
      await this.appendEvidence(
        tx, request, current.state as CompanySignupState, 'PROVISIONING', correlationRequestId,
        stale ? 'signup.provisioning.reclaimed_stale' : undefined,
      );
      return { request, claimed: true, attemptId, reclaimedStale: stale };
    });
  }

  async completeProvisioning(input: {
    requestId: string;
    attemptId: string;
    companyId: string;
    ownerUserId: string;
    correlationRequestId: string;
  }): Promise<ReceiveResult> {
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, input.requestId);
      const current = await this.findOrThrow(tx, input.requestId);
      if (current.state === 'READY' && current.companyId === input.companyId && current.ownerUserId === input.ownerUserId) {
        return { request: current, replayed: true };
      }
      this.assertAttempt(current, input.attemptId);
      const request = await this.casUpdate(tx, current, {
        state: 'READY', failureCode: null, companyId: input.companyId, ownerUserId: input.ownerUserId,
      });
      await this.appendEvidence(tx, request, 'PROVISIONING', 'READY', input.correlationRequestId);
      return { request, replayed: false };
    });
  }

  async failProvisioning(input: {
    requestId: string;
    attemptId: string;
    failureCode: string;
    correlationRequestId: string;
  }): Promise<ReceiveResult> {
    const failureCode = input.failureCode.trim().slice(0, 64);
    if (!failureCode) throw new UnprocessableEntityException('failure_code_required');
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, input.requestId);
      const current = await this.findOrThrow(tx, input.requestId);
      if (current.state === 'PROVISIONING_FAILED' && current.provisioningAttemptId === input.attemptId
        && current.failureCode === failureCode) {
        return { request: current, replayed: true };
      }
      this.assertAttempt(current, input.attemptId);
      const request = await this.casUpdate(tx, current, { state: 'PROVISIONING_FAILED', failureCode });
      await this.appendEvidence(tx, request, 'PROVISIONING', 'PROVISIONING_FAILED', input.correlationRequestId);
      return { request, replayed: false };
    });
  }

  private async changeState(
    requestId: string,
    toState: CompanySignupState,
    correlationRequestId: string,
    failureCode?: string,
    expect?: SignupStatePredicate,
    extras?: SignupAdvanceExtras,
  ): Promise<ReceiveResult> {
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, requestId);
      const current = await this.findOrThrow(tx, requestId);
      // Checked BEFORE the replay shortcut and before the table: the caller's precondition is about
      // this row as it is now, under the lock, not as it looked when the caller read it.
      if (expect && !expect(current)) throw new ConflictException(expect.rejectionCode);
      const normalizedFailure = failureCode?.trim().slice(0, 64) || null;
      if (current.state === toState && current.failureCode === normalizedFailure) {
        return { request: current, replayed: true };
      }
      // P10-L: the table is chosen by the row's own source, so a LINE application can never take an
      // EMAIL_* edge and the web form can never take the AUTO_FREE shortcut.
      if (!canTransitionCompanySignup(current.state as CompanySignupState, toState, current.source)) {
        throw new ConflictException(`invalid_signup_transition:${current.state}:${toState}`);
      }
      if (isCompanySignupFailureState(toState) && !normalizedFailure) {
        throw new UnprocessableEntityException('failure_code_required');
      }
      const request = await this.casUpdate(tx, current, {
        ...(extras?.data ?? {}),
        state: toState,
        failureCode: isCompanySignupFailureState(toState) ? normalizedFailure : null,
      });
      await this.appendEvidence(tx, request, current.state as CompanySignupState, toState, correlationRequestId);
      // R08: the required side effect commits with the transition or neither happens. Deliberately
      // NOT re-run on the replay branch above — the caller owns repairing a side effect that was
      // lost after an earlier transition committed, and it knows whether the repair is idempotent.
      await extras?.alsoInTransaction?.(tx);
      return { request, replayed: false };
    });
  }

  private async lock(tx: Prisma.TransactionClient, key: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private async findOrThrow(tx: Prisma.TransactionClient, id: string): Promise<CompanySignupRequest> {
    const request = await tx.companySignupRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('company_signup_request_not_found');
    return request;
  }

  private async casUpdate(
    tx: Prisma.TransactionClient,
    current: CompanySignupRequest,
    data: Prisma.CompanySignupRequestUncheckedUpdateManyInput,
  ): Promise<CompanySignupRequest> {
    const changed = await tx.companySignupRequest.updateMany({
      where: { id: current.id, state: current.state, version: current.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ConflictException('company_signup_concurrent_transition');
    return tx.companySignupRequest.findUniqueOrThrow({ where: { id: current.id } });
  }

  private assertAttempt(current: CompanySignupRequest, attemptId: string): void {
    if (current.state !== 'PROVISIONING' || current.provisioningAttemptId !== attemptId) {
      throw new ConflictException('provisioning_attempt_mismatch');
    }
  }

  private async appendEvidence(
    tx: Prisma.TransactionClient,
    request: CompanySignupRequest,
    fromState: CompanySignupState | null,
    toState: CompanySignupState,
    correlationRequestId: string,
    /** Names the transition when it is not an ordinary one — a stale fence takeover, say. */
    action?: string,
  ): Promise<void> {
    const failed = isCompanySignupFailureState(toState);
    await tx.auditLog.create({
      data: {
        actorType: 'SERVICE', actorRefId: SERVICE_ACTOR,
        action: action ?? (fromState ? 'signup.request.transition' : 'signup.request.received'),
        targetType: 'company_signup_request', targetId: request.id, requestId: correlationRequestId,
        result: failed ? 'FAILED' : 'SUCCESS',
        riskLevel: toState === 'PROVISIONING' || toState === 'READY' ? 'HIGH' : 'MEDIUM',
        metadataJson: { source: request.source, fromState, toState, version: request.version },
      },
    });
    await tx.outboxEvent.create({
      data: {
        eventType: fromState ? 'company_signup.state_changed' : 'company_signup.received',
        aggregateType: 'CompanySignupRequest', aggregateId: request.id,
        eventKey: `company_signup:${request.id}:${request.version}`,
        payloadJson: {
          schemaVersion: 1, requestId: correlationRequestId, occurredAt: new Date().toISOString(),
          data: { signupRequestId: request.id, fromState, toState, version: request.version },
        },
        priority: toState === 'PROVISIONING' || toState === 'READY' ? 'HIGH' : 'NORMAL',
      },
    });
  }
}
