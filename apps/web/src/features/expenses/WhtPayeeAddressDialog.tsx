'use client';

import { useRef, useState } from 'react';
import { WHT_HANDOFF_PAYEE_ADDRESS_MAX, whtPayeeAddress } from '@watchdog-bms/contracts';
import { Modal } from '@/common/components/modal/Modal';
import { useToast } from '@/common/components/toast';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { btnClass, ghostClass, inputClass, err, ErrorBanner } from './ExpensesUi';
import { setWhtHandoffPayeeAddress } from './expenses.api';
import type { WhtCertificateRow } from './expense-wht-certificates.model';

export function WhtPayeeAddressDialog({ companyId, row, locale, onClose, onSaved }: {
  companyId: string; row: WhtCertificateRow; locale: SupportedLocale; onClose: () => void; onSaved: () => void;
}) {
  const current = whtPayeeAddress(row.payeeAddress, row.prefill.payeeSnapshot.address) || '';
  const [address, setAddress] = useState(current);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const submitting = useRef(false);
  const toast = useToast();
  const close = () => { if (!submitting.current) onClose(); };
  async function save() {
    if (submitting.current) return;
    if (!address.trim()) { setRefusal(t('expenses.certificate_card.address_required', locale)); return; }
    submitting.current = true; setSaving(true); setRefusal(null);
    try {
      await setWhtHandoffPayeeAddress(companyId, row.id, { payeeAddress: address.trim() });
      toast.success(t('expenses.certificate_card.address_saved', locale));
      onSaved();
    } catch (cause) { setRefusal(err(cause, locale)); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <Modal open onClose={close} closeOnBackdrop={false} size="sm"
    title={t(current ? 'expenses.certificate_card.edit_address_title' : 'expenses.certificate_card.add_address_title', locale)}
    footer={<div className="grid w-full gap-2 sm:ml-auto sm:w-max sm:max-w-full sm:auto-cols-[minmax(8rem,1fr)] sm:grid-flow-col" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <button type="button" className={`${ghostClass} w-full`} disabled={saving} aria-busy={false} onClick={close}>{t('expenses.certificate_card.close', locale)}</button>
      <button form="list-certificate-address" type="submit" className={`${btnClass} w-full`} disabled={saving} aria-busy={saving}>{t('expenses.certificate_card.save', locale)}</button>
    </div>}>
    <form id="list-certificate-address" className="space-y-3" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="block" htmlFor="list-payee-address">{t('expenses.certificate_card.address', locale)}
        <textarea id="list-payee-address" className={inputClass} rows={4} required maxLength={WHT_HANDOFF_PAYEE_ADDRESS_MAX} disabled={saving}
          value={address} onChange={event => { setAddress(event.target.value); setRefusal(null); }} />
      </label>
      {refusal && <ErrorBanner message={refusal} />}
    </form>
  </Modal>;
}
