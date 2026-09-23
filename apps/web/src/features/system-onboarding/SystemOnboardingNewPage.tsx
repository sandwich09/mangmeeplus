'use client';

import { useState } from 'react';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { useConfirm } from '@/common/components/modal';
import { authedFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { todayCivilDate } from '@watchdog-bms/contracts';

const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';
const labelClass = 'block text-xs font-medium text-gray-600 mb-1';

// BackToPartnersLink was replaced by the shared BackLink component, which every admin screen
// now uses so the back affordance looks and behaves the same everywhere.

type LineLinkPackage = {
  linkUrl: string;
  qrImageUrl: string;
  expiresAt: string;
};

type HandoffResult = {
  onboardingRunId: string;
  companyId: string;
  ownerId: string;
  /** null for a LINE-only owner: there is no username to hand over, by design (spec §6). */
  username: string | null;
  attachedExistingOwner?: boolean;
  temporaryPassword?: string; // absent in attach-existing-owner mode
  handoffUrl: string;
  lineAddUrl?: string;
  lineLinkUrl?: string;
  ownerLineLink?: LineLinkPackage;
  chartOfAccounts: {
    templateKey: string;
    templateVersion: number;
    templateChecksum: string;
    mappingManifestChecksum: string;
    accountCount: number;
    readyForManualLedger: boolean;
    readyForAutomaticPosting: boolean;
  };
};

function responseError(body: Record<string, unknown>, status: number, responseRequestId?: string | null): string {
  const rawMessage = Array.isArray(body['message'])
    ? body['message'].join(', ')
    : typeof body['message'] === 'string'
      ? body['message']
      : `API error ${status}`;
  const translated = apiErrorMessage(Object.assign(new Error(rawMessage), {
    status,
    ...(typeof body['code'] === 'string' ? { code: body['code'] } : {}),
  }));
  const requestId = typeof body['requestId'] === 'string' ? body['requestId'] : responseRequestId;
  return requestId
    ? `${translated} · รหัสอ้างอิง: ${requestId}`
    : translated;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function HandoffField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between rounded border border-gray-200 bg-gray-50 px-3 py-2">
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-mono text-gray-900 break-all">{value}</p>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

function OwnerLineLinkCard({ lineLink }: { lineLink: LineLinkPackage }) {
  return (
    <div className="rounded border border-green-200 bg-green-50 p-3">
      <div className="flex gap-3">
        <img
          src={lineLink.qrImageUrl}
          alt="Owner LINE link QR code"
          className="h-28 w-28 flex-shrink-0 rounded border border-gray-200 bg-white p-1"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-semibold text-green-800">Owner LINE link QR (single use, bound to this owner only)</p>
          <a href={lineLink.linkUrl} target="_blank" rel="noreferrer" className="block break-all text-sm font-medium text-brand-700 underline">
            {lineLink.linkUrl}
          </a>
          <p className="text-xs text-gray-500">Expires {formatThaiDateTime(lineLink.expiresAt)}</p>
          <CopyButton value={lineLink.linkUrl} />
        </div>
      </div>
    </div>
  );
}

type ReissueQrResult = { ownerLineLink: LineLinkPackage };
type RegeneratedPasswordResult = { temporaryPassword: string; ownerLineLink?: LineLinkPackage };

/** Escape hatches for an existing run: QR-only reissue (password untouched) vs the
 *  destructive password regeneration. Kept as two clearly separated actions so an
 *  expired QR never gets "fixed" by locking the owner out of a password they set. */
function MaintenanceCard({ prefillRunId }: { prefillRunId: string }) {
  const [runId, setRunId] = useState(prefillRunId);
  const [busy, setBusy] = useState<null | 'qr' | 'password'>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrResult, setQrResult] = useState<ReissueQrResult | null>(null);
  const [passwordResult, setPasswordResult] = useState<RegeneratedPasswordResult | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const callMaintenance = async (kind: 'qr' | 'password') => {
    const id = runId.trim();
    if (!id) {
      setError('Enter the onboarding run ID first.');
      return;
    }
    if (kind === 'password' && !(await confirm({
      title: 'Regenerate temporary password',
      message: 'Regenerate the temporary password? This RESETS the owner\'s password — if they already set their own password, they will be locked out of it. For an expired QR only, use "Reissue owner LINE QR" instead.',
      confirmLabel: 'Regenerate password',
      cancelLabel: 'Cancel',
    }))) return;
    setBusy(kind);
    setError(null);
    try {
      const endpoint = kind === 'qr' ? 'reissue-owner-line-link' : 'regenerate-temporary-password';
      const res = await authedFetch(`/system/company-onboardings/${encodeURIComponent(id)}/${endpoint}`, { method: 'POST' });
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        setError(responseError(body, res.status, res.headers.get('x-request-id')));
        return;
      }
      if (kind === 'qr') {
        setQrResult(body as ReissueQrResult);
        setPasswordResult(null);
      } else {
        setPasswordResult(body as RegeneratedPasswordResult);
        setQrResult(null);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Existing Onboarding Maintenance</h2>
        <p className="text-sm text-gray-500 mt-1">Reissue the owner LINE QR or regenerate the temporary password for a run that was already created.</p>
      </div>
      {error && (
        <div role="alert" className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <div>
        <label className={labelClass}>Onboarding Run ID</label>
        <input className={inputClass} value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="e.g. cmb1x…" />
      </div>
      <div className="space-y-3">
        <div className="rounded border border-gray-200 px-3 py-3 space-y-2">
          <p className="text-sm text-gray-700">
            <span className="font-semibold">QR expired?</span> Issue a fresh 72-hour owner LINE link QR. The owner's password is <span className="font-semibold">not</span> changed; any older pending QR is revoked.
          </p>
          <button
            type="button"
            className="mangmee-btn mangmee-btn-primary disabled:opacity-50"
            disabled={busy !== null} aria-busy={Boolean(busy !== null)}
            onClick={() => void callMaintenance('qr')}
          >
            {busy === 'qr' ? 'Reissuing…' : 'Reissue owner LINE QR'}
          </button>
        </div>
        <div className="rounded border border-red-200 bg-red-50/50 px-3 py-3 space-y-2">
          <p className="text-sm text-red-800">
            <span className="font-semibold">Password lost?</span> Regenerate the temporary password. This resets the owner's password (they must change it at next login) and also rotates the LINE QR. If the owner already set their own password, this locks them out of it — do not use this for an expired QR.
          </p>
          <button
            type="button"
            className="mangmee-btn mangmee-btn-danger disabled:opacity-50"
            disabled={busy !== null} aria-busy={Boolean(busy !== null)}
            onClick={() => void callMaintenance('password')}
          >
            {busy === 'password' ? 'Regenerating…' : 'Regenerate temporary password'}
          </button>
        </div>
      </div>
      {qrResult?.ownerLineLink && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-900">New owner LINE QR (password unchanged)</p>
          <OwnerLineLinkCard lineLink={qrResult.ownerLineLink} />
        </div>
      )}
      {passwordResult && (
        <div className="space-y-2">
          <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">
              This password will not be shown again. Copy it now and hand it to the customer through a secure channel.
            </p>
          </div>
          <HandoffField label="TEMPORARY PASSWORD (shown once only)" value={passwordResult.temporaryPassword} />
          {passwordResult.ownerLineLink && <OwnerLineLinkCard lineLink={passwordResult.ownerLineLink} />}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

/**
 * Review A-04. The console has three owner shapes and only two used to have copy. A LINE-only shop
 * has no username by design, which is exactly how it is told apart from an attach — where the
 * existing account's username comes back.
 */
function lineOnlyHandoff(result: HandoffResult): boolean {
  return result.username === null && !result.temporaryPassword;
}

function HandoffPackage({ result }: { result: HandoffResult }) {
  return (
    <div className="space-y-4">
      {result.temporaryPassword ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">
            This password will not be shown again. Copy it now and hand it to the customer through a secure channel.
          </p>
        </div>
      ) : lineOnlyHandoff(result) ? (
        <div className="rounded bg-green-50 border border-green-200 px-4 py-3">
          <p className="text-sm font-semibold text-green-700">
            ลูกค้าใช้ LINE เท่านั้น — ไม่มีชื่อผู้ใช้และรหัสผ่านชั่วคราว ส่งมอบด้วย QR เชื่อม LINE ด้านล่าง (ใช้ได้ครั้งเดียว อายุ 72 ชั่วโมง)
          </p>
        </div>
      ) : (
        <div className="rounded bg-green-50 border border-green-200 px-4 py-3">
          <p className="text-sm font-semibold text-green-700">
            Attached to an existing owner account — no new password was issued. The owner signs in with their existing username and password, and can switch companies from the web header or with /companies in LINE.
          </p>
        </div>
      )}
      <div className="space-y-2">
        <HandoffField label="Company Dashboard URL" value={result.handoffUrl} />
        {result.username && <HandoffField label="Login Username" value={result.username} />}
        {result.temporaryPassword && <HandoffField label="TEMPORARY PASSWORD (shown once only)" value={result.temporaryPassword} />}
        {result.ownerLineLink && <OwnerLineLinkCard lineLink={result.ownerLineLink} />}
        {result.lineAddUrl && <HandoffField label="LINE OA Add URL" value={result.lineAddUrl} />}
        {result.lineLinkUrl && <HandoffField label="LINE Account Link URL" value={result.lineLinkUrl} />}
      </div>
      <div className="rounded border border-green-200 bg-green-50 px-4 py-3">
        <p className="text-sm font-semibold text-green-900">ผังบัญชีมาตรฐานพร้อมใช้งาน</p>
        <p className="mt-1 text-sm text-green-800">
          {result.chartOfAccounts.templateKey} · version {result.chartOfAccounts.templateVersion} · {result.chartOfAccounts.accountCount} บัญชี
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className={result.chartOfAccounts.readyForManualLedger ? 'text-green-800' : 'text-amber-800'}>
            ลงบัญชีเอง: {result.chartOfAccounts.readyForManualLedger ? 'พร้อม' : 'ยังไม่พร้อม'}
          </span>
          <span className={result.chartOfAccounts.readyForAutomaticPosting ? 'text-green-800' : 'text-amber-800'}>
            ลงบัญชีอัตโนมัติ: {result.chartOfAccounts.readyForAutomaticPosting ? 'พร้อม' : 'รอตรวจ mapping'}
          </span>
        </div>
      </div>
      {(result.ownerLineLink || result.lineAddUrl || result.lineLinkUrl) && (
        <div className="rounded border border-blue-200 bg-blue-50 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-blue-800">Customer LINE setup instructions (share with customer)</p>
          <ol className="list-decimal list-inside space-y-1 text-sm text-blue-900">
            {result.temporaryPassword ? (
              <>
                <li>Sign in to the web dashboard with the username and temporary password above.</li>
                <li>Change your password when prompted before accessing any module.</li>
              </>
            ) : lineOnlyHandoff(result) ? (
              // There is nothing to sign in WITH yet: scanning the QR is what creates the identity,
              // and after that the LINE buttons carry them into the web.
              <li>สแกน QR เชื่อม LINE ด้านบนด้วยบัญชี LINE ของเจ้าของร้าน แล้วเข้าใช้งานผ่านปุ่มในแชทได้เลย</li>
            ) : (
              <li>Sign in to the web dashboard with the existing username and password.</li>
            )}
            {result.lineAddUrl && <li>Add the LINE Official Account using the LINE OA Add URL or QR code above.</li>}
            {result.ownerLineLink && <li>Scan the Owner LINE link QR (or open its link) to connect your LINE identity. It is single use and works only for this owner account.</li>}
            {result.lineLinkUrl && <li>Open the LINE Account Link URL to connect your LINE identity. You must be logged in to the web first.</li>}
            <li>After linking, you can use LINE to ask read-only business questions through AI.</li>
          </ol>
          <p className="text-xs text-blue-700 mt-1">Note: Adding the LINE OA alone does not grant data access. Account linking is required.</p>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Onboarding run ID: {result.onboardingRunId} | Company ID: {result.companyId}
      </p>
    </div>
  );
}

export default function SystemOnboardingNewPage() {
  const [companyName, setCompanyName] = useState('');
  // '' = ยังไม่ทราบ. An admin who does not know leaves it blank and the company stays UNKNOWN —
  // every reader then behaves exactly as it does today. Never guessed from anything else.
  const [taxId, setTaxId] = useState('');
  const [vatStatus, setVatStatus] = useState<'' | 'REGISTERED' | 'NOT_REGISTERED'>('');
  const [vatEffectiveFrom, setVatEffectiveFrom] = useState(todayCivilDate());
  const [ownerDisplayName, setOwnerDisplayName] = useState('');
  const [ownerUsername, setOwnerUsername] = useState('');
  const [attachExistingOwner, setAttachExistingOwner] = useState(false);
  // Review A-04: the customer lives on LINE, so there is no username to hand over and no temporary
  // password to leak — the owner LINE-link QR below is the whole handover.
  const [ownerLineOnly, setOwnerLineOnly] = useState(false);
  const [modulePackage, setModulePackage] = useState('');
  const [lineOaAddUrl, setLineOaAddUrl] = useState('');
  const [lineLinkUrl, setLineLinkUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [result, setResult] = useState<HandoffResult | null>(null);

  // Dashes and spaces are how a Thai tax id is printed, so they are accepted and stripped rather
  // than rejected. Blank stays valid: the field is optional.
  const taxIdDigits = taxId.replace(/\D/g, '');
  const taxIdInvalid = taxIdDigits.length > 0 && taxIdDigits.length !== 13;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (taxIdInvalid) {
      setError('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Cookie session + CSRF + refresh-on-401 handled by the shared client.
      const res = await authedFetch('/system/company-onboardings', {
        method: 'POST',
        body: JSON.stringify({
          companyName,
          // Omitted when blank, like the VAT answer: the owner captures it later on the identity
          // screen. Sent as digits so a number typed as 0-1234-56789-01-2 is the same value the
          // identity screen would store.
          ...(taxIdDigits ? { taxId: taxIdDigits } : {}),
          // Omitted when the admin does not know — the company then stays UNKNOWN, which is not
          // the same as "not registered" and must not be sent as one.
          ...(vatStatus ? {
            vatRegistration: {
              status: vatStatus,
              // A "not registered" answer takes effect from today: there is nothing earlier to
              // claim on, and documents dated before it stay UNKNOWN and behave as they do now.
              effectiveFrom: vatStatus === 'REGISTERED' ? vatEffectiveFrom : todayCivilDate(),
            },
          } : {}),
          ownerDisplayName: attachExistingOwner && !ownerDisplayName ? ownerUsername : ownerDisplayName,
          // Omitted, not blanked, for a LINE-only owner: the column is null by design (spec §6).
          ...(ownerLineOnly ? { ownerLineOnly: true } : { ownerUsername }),
          ...(attachExistingOwner ? { attachExistingOwner: true } : {}),
          ...(modulePackage ? { modulePackage } : {}),
          ...(lineOaAddUrl ? { lineOaAddUrl } : {}),
          ...(lineLinkUrl ? { lineLinkUrl } : {}),
        }),
      });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        setError(responseError(body, res.status, res.headers.get('x-request-id')));
        return;
      }
      setResult(body as HandoffResult);
    } catch {
      setError('เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  if (forbidden) {
    return (
      <div className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900">Access Denied</h1>
          <p className="text-sm text-gray-500 mt-1">You do not have permission to create company onboardings.</p>
          <div className="mt-3">
            <BackLink href="/system/partners" label="กลับไปรายชื่อพาร์ทเนอร์" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gray-50 p-6">
      <div className="max-w-lg mx-auto space-y-6">
        <BackLink href="/system/partners" label="กลับไปรายชื่อพาร์ทเนอร์" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">New Company Onboarding</h1>
          <p className="text-sm text-gray-500 mt-1">Create a new customer company and first owner account.</p>
        </div>

        {result ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Handoff Package</h2>
            <HandoffPackage result={result} />
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            {error && (
              <div role="alert" className="mb-4 rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={labelClass}>Company Name *</label>
                <input className={inputClass} required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <div>
                <label className={labelClass} htmlFor="taxId">เลขประจำตัวผู้เสียภาษี / Tax ID</label>
                <input id="taxId" className={inputClass} inputMode="numeric" value={taxId}
                  placeholder="0-1234-56789-01-2"
                  aria-invalid={taxIdInvalid || undefined}
                  onChange={(e) => setTaxId(e.target.value)} />
                {taxIdInvalid && (
                  <p className="mt-1 text-xs text-rose-600">ต้องเป็นตัวเลข 13 หลัก (กรอกแล้ว {taxIdDigits.length} หลัก)</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  Needed before the company can issue tax documents in its own name — the payer block on a 50 ทวิ stays blank without it. Leave empty if you do not have it; the owner can capture it later in company settings.
                </p>
              </div>
              <div>
                <label className={labelClass} htmlFor="vatStatus">จดทะเบียน VAT / VAT registration</label>
                <ThemedSelect id="vatStatus" className={inputClass} value={vatStatus}
                  onChange={(e) => setVatStatus(e.target.value as '' | 'REGISTERED' | 'NOT_REGISTERED')}>
                  <option value="">— ยังไม่ทราบ / Unknown (ask later) —</option>
                  <option value="REGISTERED">จดทะเบียนแล้ว / Registered</option>
                  <option value="NOT_REGISTERED">ยังไม่ได้จดทะเบียน / Not registered</option>
                </ThemedSelect>
                {vatStatus === 'REGISTERED' && (
                  <div className="mt-2">
                    <label className={labelClass}>วันที่มีผล (ตาม ภ.พ.20) *</label>
                    <ThemedDate className={inputClass} required value={vatEffectiveFrom}
                      onChange={(e) => setVatEffectiveFrom(e.target.value)} />
                  </div>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  Decides whether the company is asked Thai VAT questions when recording expenses, and whether it may claim input VAT. Leave as Unknown if you are not sure — it stays answerable later and nothing is guessed meanwhile.
                </p>
              </div>
              <label className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={attachExistingOwner}
                  onChange={(e) => { setAttachExistingOwner(e.target.checked); if (e.target.checked) setOwnerLineOnly(false); }}
                />
                Attach to an existing owner username (no new user or password; owner switches companies from the header / LINE)
              </label>
              {/* Review A-04. Mutually exclusive with attach-existing: that path reuses an account
                  which already has whatever credential it has. */}
              {!attachExistingOwner && (
                <label className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={ownerLineOnly}
                    onChange={(e) => setOwnerLineOnly(e.target.checked)}
                  />
                  <span>
                    ลูกค้าใช้ LINE เท่านั้น / Customer signs in with LINE only
                    <span className="mt-0.5 block text-xs text-gray-500">
                      ไม่ออกชื่อผู้ใช้และรหัสผ่านชั่วคราว ส่งมอบด้วย QR เชื่อม LINE ของเจ้าของร้านอย่างเดียว (อายุ 72 ชั่วโมง)
                    </span>
                  </span>
                </label>
              )}
              {!attachExistingOwner && (
                <div>
                  <label className={labelClass}>Owner Display Name *</label>
                  <input className={inputClass} required value={ownerDisplayName} onChange={(e) => setOwnerDisplayName(e.target.value)} />
                </div>
              )}
              {!ownerLineOnly && (
                <div>
                  <label className={labelClass}>{attachExistingOwner ? 'Existing Owner Username *' : 'Owner Username *'}</label>
                  <input className={inputClass} required value={ownerUsername} onChange={(e) => setOwnerUsername(e.target.value)} />
                </div>
              )}
              <button type="submit" className={btnClass} disabled={loading} aria-busy={Boolean(loading)}>
                {loading ? 'Creating…' : 'Create Onboarding'}
              </button>
            </form>
          </div>
        )}

        {/* key remounts the card when a run is created so its ID is prefilled */}
        <MaintenanceCard key={result?.onboardingRunId ?? 'blank'} prefillRunId={result?.onboardingRunId ?? ''} />
      </div>
    </div>
  );
}
