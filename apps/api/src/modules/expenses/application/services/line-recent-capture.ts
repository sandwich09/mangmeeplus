/**
 * The ONE "the record this chat just captured" rule (spec §2 provenance, §5.5).
 *
 * Recency window + chat provenance used to live only inside the webhook use case's correction
 * candidate loader. `expense.explain_record` needs exactly the same rule to resolve "บิลเมื่อกี้",
 * and two copies of a provenance rule is how one of them silently drifts wider than the other —
 * so both lanes call this.
 *
 * What the rule is (enforced by `listRecentLineCaptures` in the repository): captured by THIS user,
 * in THIS chat, inside the caller's branch scope, still editable, and newer than the window.
 * Ordering is newest first.
 *
 * What the rule is NOT: it does not decide what to do with several candidates. The correction lane
 * refuses an ambiguous WRITE target; the read-only explain tool takes the newest and names the bill
 * it is talking about. That policy stays with each caller.
 */

/** How far back a LINE chat may reach for the record it captured. Older records are handled in web. */
export const LINE_RECENT_CAPTURE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type LineRecentCaptureRow = {
  id: string;
  expenseDate: Date | null;
  grandTotalAmount: string | null;
  vendorDocumentNumber: string | null;
  sourceDocumentType: string | null;
  createdAt: Date;
};

/** The repository surface this rule needs — narrowed so a caller (and a test double) never has to
 *  carry the whole expense repository just to resolve a chat's recent captures. */
export type LineRecentCaptureReader = {
  listRecentLineCaptures(input: {
    companyId: string;
    createdByUserId: string;
    chatKeyHash: string;
    since: Date;
    scopes: { branchIds?: string[] };
    take: number;
  }): Promise<LineRecentCaptureRow[]>;
};

export function listRecentLineCaptureCandidates(
  reader: LineRecentCaptureReader,
  input: {
    companyId: string;
    userId: string;
    chatKeyHash: string;
    scopes: { branchIds?: string[] };
    take: number;
  },
): Promise<LineRecentCaptureRow[]> {
  return reader.listRecentLineCaptures({
    companyId: input.companyId,
    createdByUserId: input.userId,
    chatKeyHash: input.chatKeyHash,
    since: new Date(Date.now() - LINE_RECENT_CAPTURE_WINDOW_MS),
    scopes: input.scopes,
    take: input.take,
  });
}
