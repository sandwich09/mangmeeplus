import { Injectable } from '@nestjs/common';
import type { BuyerEntityKind, VendorCounterpartyAutoSaveResult } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaAccountingRepository } from '../../infrastructure/prisma-accounting.repository';
import type { CounterpartyRecord } from '../../domain/models/accounting.model';
import {
  buildCounterpartyAddressV2,
  counterpartyAddressText,
  decideVendorAutoSave,
  normalizeBranchCode,
  vendorMatchKey,
} from '../../domain/logic/vendor-counterparty-match.logic';

/**
 * Only the three fields this use case actually needs. Narrower than `RequestContext` on purpose:
 * `receipt-ocr-apply.service.ts` runs under a LINE/job context that is not a full request, and a
 * structural type lets a real `RequestContext` pass unchanged while that caller passes what it has.
 */
export type VendorAutoSaveContext = { companyId: string; userId: string; requestId?: string };

export type EnsureVendorCounterpartyInput = {
  expenseId: string;
  /** Uploader of the linked active primary receipt; unlike ctx.userId this can differ from the reviewer. */
  receiptUploaderUserId?: string | null;
  /** CON-4: both markers of a system-generated expense; either one skips the whole thing. */
  captureSource?: string | null;
  sourceReimbursementRequestId?: string | null;
  vendorCounterpartyId?: string | null;
  vendorName?: string | null;
  vendorTaxId?: string | null;
  vendorBranchCode?: string | null;
  vendorAddressText?: string | null;
  vendorEntityKind?: BuyerEntityKind | null;
};

/** What the expense write should store as a result of the registry lookup (GAP-4, CON-7). */
export type EnsureVendorCounterpartyOutcome = {
  result: VendorCounterpartyAutoSaveResult;
  /** Set only when the expense is not linked yet; the caller folds it into its own write. */
  linkCounterpartyId?: string;
  /** Set only when the expense has no entity kind and the registry does (CON-7). */
  fillEntityKind?: BuyerEntityKind;
};

/**
 * D4/§7: every expense save grows the counterparty registry by itself. Deliberately unlike
 * `EnsureCustomerCounterpartyUseCase`, which this otherwise copies:
 *
 * - **No launch gate (CON-3).** The customer-side twin calls
 *   `assertLaunchRouteOpenInTransaction(db, 'sales_documents')`. Copying that here would make every
 *   expense save fail for a company that never opened sales documents — a silent block on the one
 *   flow this feature exists to help. This write rides the permission and entitlement of the
 *   expense write that already passed.
 * - **Not gated on `accounting.counterparty.manage` (A3).** It is a side effect of an authorized
 *   expense write, audited with its source every time. Overwriting a primary address BY HAND still
 *   needs that permission, on the counterparty screen.
 * - **Never throws (§8, AC06).** The expense is already saved or about to be; a registry failure
 *   returns `{ case: 'FAILED', failed: true }` so the caller can say "ยังไม่ได้บันทึกลงทะเบียน
 *   คู่ค้า ลองใหม่ได้จากหน้าคู่ค้า" instead of losing the user's work or going quiet.
 */
@Injectable()
export class EnsureVendorCounterpartyFromExpenseUseCase {
  constructor(
    private readonly repo: PrismaAccountingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: VendorAutoSaveContext, input: EnsureVendorCounterpartyInput): Promise<EnsureVendorCounterpartyOutcome> {
    // CON-4: a reimbursement projection's vendor is `เบิกคืนพนักงาน: <employee>`, not a shop. Without
    // this, every employee who ever claimed anything becomes a counterparty row.
    if (input.captureSource === 'API_INTERNAL' || input.sourceReimbursementRequestId) {
      return { result: { case: 'SKIPPED' } };
    }

    const key = vendorMatchKey({ taxId: input.vendorTaxId, branchCode: input.vendorBranchCode, name: input.vendorName });
    // No tax id and no name: §7 says skip matching entirely rather than collide every nameless
    // vendor into one row.
    if (!key) return { result: { case: 'SKIPPED' } };

    try {
      return await this.save(ctx, input, key);
    } catch {
      // §8: the expense wins, always. The user is told the registry write did not happen and where
      // to retry it; nothing here may turn into a failed save.
      return { result: { case: 'FAILED', failed: true } };
    }
  }

  private async save(
    ctx: VendorAutoSaveContext,
    input: EnsureVendorCounterpartyInput,
    key: NonNullable<ReturnType<typeof vendorMatchKey>>,
  ): Promise<EnsureVendorCounterpartyOutcome> {
    // CON-12: no `type` filter. CRM creates CUSTOMER rows and procurement creates VENDOR rows for
    // the same company, and a filtered search would create a duplicate next to each of them.
    const matched = await this.repo.findCounterpartyByVendorKey(ctx.companyId, key);
    const documentAddressText = input.vendorAddressText?.trim() || null;

    if (!matched) {
      const branchCode = normalizeBranchCode(input.vendorBranchCode);
      const created = await this.repo.createCounterparty({
        companyId: ctx.companyId,
        // A5: server-owned. Born from a purchase, so VENDOR; the sales side promotes it to BOTH the
        // first time it is used there (CON-1).
        type: 'VENDOR',
        displayName: vendorDisplayName(input.vendorName, branchCode),
        ...(input.vendorTaxId ? { taxId: input.vendorTaxId } : {}),
        ...(branchCode ? { branchCode } : {}),
        ...(input.vendorEntityKind ? { entityKind: input.vendorEntityKind } : {}),
        ...(documentAddressText
          ? {
            billingAddressJson: buildCounterpartyAddressV2({
              addressText: documentAddressText,
              source: 'EXPENSE_AUTO',
              expenseId: input.expenseId,
              userId: ctx.userId,
              at: new Date().toISOString(),
            }),
          }
          : {}),
        createdByUserId: ctx.userId,
        ...(input.receiptUploaderUserId ? { receiptUploaderUserId: input.receiptUploaderUserId } : {}),
      });
      this.log(ctx, 'create', created.id, input.expenseId, Boolean(documentAddressText));
      return {
        result: { case: 'CREATE', counterpartyId: created.id, displayName: created.displayName, canOpenCounterparty: true },
        linkCounterpartyId: created.id,
      };
    }

    return this.saveToMatched(ctx, input, matched, documentAddressText);
  }

  /**
   * §11.1/§15: another expense save can race this same row between the `findCounterpartyByVendorKey`
   * read in `save()` and the write below — two receipts for the same shop landing at once is the
   * ordinary case this exists for, not an edge case. `saveCounterpartyVendorFields` now CASes on
   * `updatedAt`; a lost race re-reads the row and recomputes the decision AND the address JSON
   * against the fresh data, up to twice, rather than overwriting the other write blind. §8 still
   * holds when every attempt loses: this returns the ordinary non-throwing FAILED outcome, exactly
   * like any other registry failure, never a throw.
   */
  private async saveToMatched(
    ctx: VendorAutoSaveContext,
    input: EnsureVendorCounterpartyInput,
    initialMatched: CounterpartyRecord,
    documentAddressText: string | null,
  ): Promise<EnsureVendorCounterpartyOutcome> {
    let matched = initialMatched;

    // 3 attempts total = 1 initial + up to 2 retries (§15). Every retry re-reads `matched` first, so
    // each loop body recomputes the decision and the address JSON fresh — never reuses a stale one.
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const registryAddress = matched.billingAddressJson;
      const registryAddressText = counterpartyAddressText(registryAddress ?? null);
      const locked = Boolean((registryAddress as { locked?: unknown } | undefined)?.locked);
      const decision = decideVendorAutoSave({ matched: true, registryAddressText, documentAddressText, locked });

      // CON-7 runs in both directions: the registry fills an empty expense field (which removes an
      // existing hard block — `expense-status.logic.ts` refuses to confirm a WHT expense without one),
      // and a reviewer's own choice flows back under the same never-overwrite-a-lock rule as the address.
      const fillEntityKind = !input.vendorEntityKind && matched.entityKind ? matched.entityKind : undefined;
      const writeEntityKind = input.vendorEntityKind && input.vendorEntityKind !== matched.entityKind
        && (!matched.entityKind || !locked)
        ? input.vendorEntityKind
        : undefined;
      const addressChanged = decision.promoteToPrimary || decision.appendToHistory;
      // Case d and a locked no-op still promote a matched CUSTOMER row: a purchase happened against
      // it, so it is genuinely both from now on.
      const promoteToBoth = matched.type === 'CUSTOMER';

      const outcome: EnsureVendorCounterpartyOutcome = {
        result: {
          case: decision.case,
          counterpartyId: matched.id,
          displayName: matched.displayName,
          ...(matched.createdByUserId === ctx.userId
            || await this.repo.isCounterpartyReceiptUploader(ctx.companyId, matched.id, ctx.userId)
            ? { canOpenCounterparty: true as const }
            : {}),
          ...(decision.case === 'HISTORY' && locked ? { locked: true } : {}),
        },
        ...(input.vendorCounterpartyId ? {} : { linkCounterpartyId: matched.id }),
        ...(fillEntityKind ? { fillEntityKind } : {}),
      };

      if (!(addressChanged || writeEntityKind || promoteToBoth)) return outcome;

      // A4 decides which of the two addresses stays primary; the other is the one remembered. When
      // the registry is locked the primary is rebuilt unchanged, provenance included — the write
      // exists only to push the document's address into the history.
      const previous = (registryAddress ?? undefined) as
        { postalCode?: string | null; provenance?: { source?: string; expenseId?: string; userId?: string; at?: string } } | undefined;
      const keepPrimary = !decision.promoteToPrimary;
      const at = new Date().toISOString();
      const billingAddressJson = addressChanged && documentAddressText
        ? buildCounterpartyAddressV2({
          addressText: keepPrimary ? registryAddressText! : documentAddressText,
          postalCode: keepPrimary ? previous?.postalCode ?? null : null,
          source: keepPrimary ? (previous?.provenance?.source as 'MANUAL') ?? 'MANUAL' : 'EXPENSE_AUTO',
          ...(keepPrimary
            ? (previous?.provenance?.expenseId ? { expenseId: previous.provenance.expenseId } : {})
            : { expenseId: input.expenseId }),
          userId: keepPrimary ? previous?.provenance?.userId ?? ctx.userId : ctx.userId,
          at: keepPrimary ? previous?.provenance?.at ?? at : at,
          previous: registryAddress,
          ...(decision.appendToHistory
            ? { appendToHistory: { addressText: keepPrimary ? documentAddressText : registryAddressText!, expenseId: input.expenseId, at } }
            : {}),
        })
        : undefined;

      const wrote = await this.repo.saveCounterpartyVendorFields({
        companyId: ctx.companyId,
        counterpartyId: matched.id,
        ...(billingAddressJson ? { billingAddressJson } : {}),
        ...(writeEntityKind ? { entityKind: writeEntityKind } : {}),
        ...(promoteToBoth ? { promoteToBoth: true } : {}),
        updatedByUserId: ctx.userId,
        ...(matched.updatedAt ? { expectedUpdatedAt: matched.updatedAt } : {}),
      });
      if (wrote) {
        this.log(ctx, 'update', matched.id, input.expenseId, Boolean(billingAddressJson));
        return outcome;
      }

      if (attempt === 2) break;
      const fresh = await this.repo.findCounterpartyById(ctx.companyId, matched.id);
      if (!fresh) break;
      matched = fresh;
    }

    return { result: { case: 'FAILED', failed: true } };
  }

  /**
   * CON-10: the audit sanitizer's key regex covers token/password/body/content only — it will NOT
   * redact an address, and widening it would strip look-alike keys from the company tax-identity
   * spec. So the value never enters `metadataJson` in the first place; `addressChanged` is the
   * whole story an auditor needs, and the address itself lives on the row.
   */
  private log(ctx: VendorAutoSaveContext, action: 'create' | 'update', counterpartyId: string, expenseId: string, addressChanged: boolean): void {
    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: `accounting.counterparty.${action}`,
      targetType: 'accounting_counterparty',
      targetId: counterpartyId,
      requestId: ctx.requestId ?? '',
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: { source: 'expense_auto_link', expenseId, addressChanged },
    });
  }
}

/**
 * §13: two branches of one shop are two rows under the A2 key, and without this they would both be
 * called "บริษัท ก จำกัด" with nothing on screen to tell them apart. Head office ('00000') gets no
 * suffix — it is the default reading of a bare name.
 */
function vendorDisplayName(name: string | null | undefined, branchCode: string | null): string {
  const base = (name ?? '').trim();
  return branchCode && branchCode !== '00000' ? `${base} (สาขา ${branchCode})` : base;
}
