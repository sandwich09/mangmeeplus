'use client';

import { useState, type ReactNode } from 'react';
import { COMPANY_TEAM_NOTE_WORDS as N, type ExecutiveCompanyNoteResult, type ExecutivePeriod, type ExecutiveReportNote } from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { Modal } from '@/common/components/modal';
import { TeamNoteBody, useTeamNote, type TeamNote } from '../system-partners/PartnerTeamNote';
import { getExecutiveCompanyNote, patchExecutiveCompanyNote } from './executive-reports.api';

/** A saved or re-read note replaces the one in the report on screen. */
export type NoteChange = (companyId: string, change: ExecutiveCompanyNoteResult) => void;
type Props = { companyId: string; note: ExecutiveReportNote; canEdit: boolean; period: ExecutivePeriod; onChange?: NoteChange };

const noteOf = ({ note, canEditNote }: ExecutiveCompanyNoteResult): TeamNote => ({ ...note, canManage: canEditNote });
/** The admin console's note behaviour (one editor, one set of words) over the report's own routes. */
function useExecutiveNote({ companyId, note, canEdit, period, onChange }: Props, editing = false, onSaved?: () => void) {
  const read = (result: ExecutiveCompanyNoteResult) => { onChange?.(companyId, result); return noteOf(result); };
  return useTeamNote({
    load: () => getExecutiveCompanyNote(companyId, { from: period.from ?? period.month, to: period.to ?? period.month }).then(read),
    save: body => patchExecutiveCompanyNote(companyId, body).then(read),
  }, { initial: noteOf({ note, canEditNote: canEdit }), editing, onSaved });
}

/** The company page's note: every reader of the report reads it; an account with the note right changes it in place. */
export function ExecutiveCompanyNote({ readOnly, ...props }: Props & { readOnly?: ReactNode }) {
  return <div className="space-y-3"><TeamNoteBody {...useExecutiveNote(props)} readOnly={readOnly} /></div>;
}

function NoteDialog({ companyName, close, ...props }: Props & { companyName: string; close: () => void }) {
  const note = useExecutiveNote(props, true, close);
  const { saving, draft, base } = note.state;
  return <Modal open onClose={() => { if (!saving) close(); }} closeOnBackdrop={draft === base}
    title={<><span className="block">{N.title}</span><span className="block truncate text-sm font-normal text-gray-600">{companyName}</span></>}>
    <div className="mangmee-safe-bottom space-y-3"><TeamNoteBody {...note} onCancel={close} /></div>
  </Modal>;
}
/** The list's edit action: the same editor in a dialog, opened on the note as the row shows it. */
export function ExecutiveNoteAction(props: Props & { companyName: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" variant="secondary" onClick={() => setOpen(true)}>{N.edit}</Button>
    {open && <NoteDialog {...props} close={() => setOpen(false)} />}
  </>;
}
