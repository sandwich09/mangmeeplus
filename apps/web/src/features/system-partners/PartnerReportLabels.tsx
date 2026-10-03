'use client';
import { useRef, useState } from 'react';
import type { PartnerCompanyDetailDto } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { Button } from '@/common/components/button';
import { SelectField } from '@/common/components/field';
import { MangmeeCard } from '@/common/components/mangmee';
import { ErrorState, ForbiddenState } from '@/common/components/state';
import { updatePartnerProfile } from './system-partners.api';
import {
  reportLabelWords as words, REPORT_CLASSIFICATION_TITLE, REPORT_INDUSTRY_TITLE, classificationOptions, industryOptions,
  partnerReportLabelBody, reportLabelEditedBy, reportIndustryLabel,
} from './report-labels.logic';

export default function PartnerReportLabels({ detail, canManage, isPlatformCompany, onSaved }: {
  detail: PartnerCompanyDetailDto; canManage: boolean; isPlatformCompany: boolean; onSaved: (detail: PartnerCompanyDetailDto) => void;
}) {
  const labels = detail.reportLabels;
  const [classification, setClassification] = useState(labels.classification ?? '');
  const [industry, setIndustry] = useState(labels.industryGroup ?? '');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [saved, setSaved] = useState(false);
  const classificationEdit = reportLabelEditedBy(labels.classifiedBy, labels.classifiedAt);
  const industryEdit = reportLabelEditedBy(labels.industryGroupSetBy, labels.industryGroupSetAt);
  async function save() {
    if (!canManage || denied || saving.current) return;
    const body = partnerReportLabelBody(classification, industry, isPlatformCompany);
    if (!body) { setError(apiErrorMessage({ code: 'INVALID_INPUT' })); return; }
    saving.current = true; setBusy(true); setError(null); setSaved(false);
    try {
      const result = await updatePartnerProfile(detail.id, body);
      setClassification(result.reportLabels.classification ?? ''); setIndustry(result.reportLabels.industryGroup ?? '');
      onSaved(result); setSaved(true);
    } catch (cause) { setError(apiErrorMessage(cause)); setDenied((cause as { status?: number })?.status === 403); }
    finally { saving.current = false; setBusy(false); }
  }
  return <MangmeeCard className="min-w-0 space-y-4 p-4 [overflow-wrap:anywhere] [&_label>span]:text-sm">
    <h2 className="font-semibold text-gray-900">{words.title}</h2>
    <p className="text-sm text-gray-600">{words.explanation}</p>
    {denied ? <ForbiddenState description={error ?? undefined} /> : <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <SelectField label={REPORT_CLASSIFICATION_TITLE} name="reportClassification" value={isPlatformCompany ? 'INTERNAL' : classification}
            disabled={!canManage || busy || isPlatformCompany} onChange={event => { setClassification(event.target.value); setSaved(false); }}>
            {classificationOptions(isPlatformCompany).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </SelectField>
          {isPlatformCompany && <p className="text-sm text-gray-600">{words.platform}</p>}
          {classificationEdit && <p className="text-sm text-gray-600">{classificationEdit}</p>}
        </div>
        <div className="min-w-0 space-y-2">
          <SelectField label={REPORT_INDUSTRY_TITLE} name="reportIndustryGroup" value={industry} disabled={!canManage || busy}
            onChange={event => { setIndustry(event.target.value); setSaved(false); }}>
            {industryOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </SelectField>
          <p className="text-sm text-gray-600">{words.fallback}</p>
          <p className="text-sm text-gray-600">{words.effective(reportIndustryLabel(labels.effectiveIndustryGroup))}</p>
          {industryEdit && <p className="text-sm text-gray-600">{industryEdit}</p>}
        </div>
      </div>
      {error && <ErrorState description={error} />}
      {saved && <p role="status" className="text-sm text-brand-800">{words.saved}</p>}
      {canManage ? <Button type="submit" loading={busy}>{words.save}</Button> : <p className="text-sm text-gray-600">{words.readOnly}</p>}
    </form>}
  </MangmeeCard>;
}
