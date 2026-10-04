'use client';
import React, { useEffect, useRef, useState } from 'react';
import {
  COMPANY_TEAM_NOTE_MAX_LENGTH, COMPANY_TEAM_NOTE_WORDS as W, type CompanyTeamNoteDto,
} from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { getPartnerTeamNote, putPartnerTeamNote } from './system-partners.api';

type NoteState = {
  note: CompanyTeamNoteDto | null; loading: boolean; editing: boolean; draft: string;
  saving: boolean; error: string | null; conflict: boolean; saved: boolean;
};
const INITIAL: NoteState = { note: null, loading: true, editing: false, draft: '', saving: false, error: null, conflict: false, saved: false };

export function PartnerTeamNoteView({ state, onEdit, onSave, onCancel, onDraft, onReload }: {
  state: NoteState; onEdit: () => void; onSave: () => void; onCancel: () => void;
  onDraft: (value: string) => void; onReload: () => void;
}) {
  const { note, loading, editing, draft, saving, error, conflict, saved } = state;
  const count = draft.trim().length;
  return <section aria-label={W.title} className="min-w-0 space-y-4 rounded-xl border border-gray-200 bg-white p-5 [overflow-wrap:anywhere]">
    <h2 className="font-semibold text-gray-900">{W.title}</h2>
    <p className="text-sm text-gray-600">{W.description}</p>
    {loading ? <p role="status">{W.loading}</p> : <>
      {error && <div role="alert" className="space-y-2 text-red-800">
        <p>{error}</p>
        <Button type="button" variant="secondary" onClick={onReload}>{editing ? W.reloadDiscard : W.reload}</Button>
      </div>}
      {note && <>
        {editing ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); onSave(); }}>
          <label className="block space-y-2">
            <span className="text-sm font-medium">{W.title}</span>
            <textarea aria-label={W.title} aria-describedby="company-team-note-count" className="min-h-32 w-full rounded-lg border border-gray-300 p-3 text-base"
              maxLength={COMPANY_TEAM_NOTE_MAX_LENGTH} value={draft} disabled={saving} onChange={event => onDraft(event.target.value)} />
          </label>
          <p id="company-team-note-count" className="text-sm text-gray-600">{W.count(count)}</p>
          {count > COMPANY_TEAM_NOTE_MAX_LENGTH && <p role="alert">{W.tooLong}</p>}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={saving} disabled={ !!error || conflict || !note.canManage || count > COMPANY_TEAM_NOTE_MAX_LENGTH}>{W.save}</Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>{W.cancel}</Button>
          </div>
        </form> : <>
          <p className="whitespace-pre-wrap text-sm text-gray-900">{note.text || W.empty}</p>
          {note.canManage ? <Button type="button" variant="secondary" disabled={!!error} onClick={onEdit}>{W.edit}</Button>
            : <p className="text-sm text-gray-600">{W.readOnly}</p>}
        </>}
        {note.updatedAt && note.updatedBy && <p className="text-sm text-gray-600">{W.lastChanged(note.updatedBy.displayName, formatThaiDateTime(note.updatedAt))}</p>}
        {saved && <p role="status" className="text-sm text-brand-800">{W.saved}</p>}
      </>}
    </>}
  </section>;
}

export default function PartnerTeamNote({ companyId }: { companyId: string }) {
  const [state, setState] = useState<NoteState>(INITIAL);
  const generation = useRef(0);
  const saving = useRef(false);
  async function load() {
    const token = ++generation.current;
    setState({ ...INITIAL });
    try {
      const note = await getPartnerTeamNote(companyId);
      if (token === generation.current) setState({ ...INITIAL, loading: false, note });
    } catch (cause) {
      if (token === generation.current) setState({ ...INITIAL, loading: false,
        error: (cause as { status?: number })?.status === 403 ? W.denied : W.loadFailed });
    }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!state.note?.canManage || state.error || state.conflict || saving.current || state.draft.trim().length > COMPANY_TEAM_NOTE_MAX_LENGTH) return;
    const token = generation.current;
    saving.current = true;
    setState(current => ({ ...current, saving: true, saved: false }));
    try {
      const note = await putPartnerTeamNote(companyId, { text: state.draft, expectedVersion: state.note.version });
      if (token === generation.current) setState({ ...INITIAL, loading: false, note, saved: true });
    } catch (cause) {
      if (token !== generation.current) return;
      const failure = cause as { status?: number; code?: string };
      const conflict = failure.code === 'company_team_note_version_conflict';
      const error = conflict ? W.conflict : failure.status === 403 ? W.editDenied
        : failure.code === 'company_team_note_too_long' ? W.tooLong
        : failure.status === 400 ? W.invalid : failure.status === 404 ? W.notFound : W.saveUnknown;
      setState(current => ({ ...current, saving: false, error, conflict }));
    } finally { saving.current = false; }
  }
  return <PartnerTeamNoteView state={state} onReload={() => void load()} onSave={() => void save()}
    onEdit={() => setState(current => ({ ...current, editing: true, draft: current.note?.text ?? '', saved: false }))}
    onCancel={() => setState(current => ({ ...current, editing: false, draft: '', saved: false }))}
    onDraft={draft => setState(current => ({ ...current, draft, saved: false }))} />;
}
