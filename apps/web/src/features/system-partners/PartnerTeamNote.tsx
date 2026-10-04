'use client';
import React, { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  COMPANY_TEAM_NOTE_MAX_LENGTH, COMPANY_TEAM_NOTE_WORDS as W, type CompanyTeamNoteDto, type PutCompanyTeamNoteBody,
} from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { emitToast } from '@/common/feedback/toast-bus';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { getPartnerTeamNote, putPartnerTeamNote } from './system-partners.api';

/** The note as every screen reads it: the admin console's card and the executive report's block and dialog. */
export type TeamNote = Pick<CompanyTeamNoteDto, 'text' | 'version' | 'updatedAt' | 'canManage'> & { updatedBy: { displayName: string } | null };
/** Where a screen reads the note again and saves it. The words, the counter and what happens on a conflict are the same everywhere. */
export type TeamNoteSource = { load: () => Promise<TeamNote>; save: (body: PutCompanyTeamNoteBody) => Promise<TeamNote> };

type NoteState = {
  note: TeamNote | null; loading: boolean; editing: boolean; draft: string;
  /** The saved text the draft started from. */
  base: string;
  saving: boolean; error: string | null; conflict: boolean;
};
type NoteActions = { onEdit: () => void; onSave: () => void; onCancel: () => void; onDraft: (value: string) => void; onReload: () => void };
const INITIAL: NoteState = { note: null, loading: true, editing: false, draft: '', base: '', saving: false, error: null, conflict: false };

/** The note itself, without a frame: its text or the field to change it, who changed it last, and what went wrong. */
export function TeamNoteBody({ state, onEdit, onSave, onCancel, onDraft, onReload, readOnly = W.readOnly }: { state: NoteState; readOnly?: ReactNode } & NoteActions) {
  const { note, loading, editing, draft, base, saving, error, conflict } = state;
  const countId = useId();
  const field = useRef<HTMLTextAreaElement>(null), problem = useRef<HTMLDivElement>(null);
  const busy = saving || loading;
  // While a draft is open the keyboard stays in the note: on the field when editing starts and once the note has been read again,
  // on the message when a step fails (a pressed button that turns busy lets go of the focus). A frame later, so a dialog that opens
  // with the field has placed its own focus first.
  useEffect(() => {
    if (!editing || busy) return;
    const frame = requestAnimationFrame(() => (error ? problem.current : field.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editing, busy, error]);
  // Exactly what the field's own limit counts: every character in it, also the spaces and line breaks at its end.
  const count = draft.length;
  const changed = note?.updatedAt && note.updatedBy && <p className="text-sm text-gray-600">{W.lastChanged(note.updatedBy.displayName, formatThaiDateTime(note.updatedAt))}</p>;
  // Read again while editing, the saved note can differ from what the draft started from: it is shown above the draft, which stays as typed.
  const latest = editing && !!note && note.text !== base;
  if (loading && !editing) return <p role="status">{W.loading}</p>;
  return <>
    {error && <div ref={problem} tabIndex={-1} role="alert" className="space-y-2 text-red-800 outline-none">
      <p>{error}</p>
      <Button type="button" variant="secondary" loading={loading} onClick={onReload}>{W.reload}</Button>
    </div>}
    {note && <>
      {editing ? <>
        {latest && <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="whitespace-pre-wrap text-sm text-gray-900">{note.text || W.empty}</p>
          {changed}
        </div>}
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); onSave(); }}>
          <textarea ref={field} aria-label={W.title} aria-describedby={countId} className="block min-h-32 w-full rounded-lg border border-gray-300 p-3 text-base"
            maxLength={COMPANY_TEAM_NOTE_MAX_LENGTH} value={draft} disabled={busy} onChange={event => onDraft(event.target.value)} />
          <p id={countId} className="text-sm tabular-nums text-gray-600">{W.count(count)}</p>
          {count > COMPANY_TEAM_NOTE_MAX_LENGTH && <p role="alert">{W.tooLong}</p>}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={saving} disabled={loading || !!error || conflict || !note.canManage || count > COMPANY_TEAM_NOTE_MAX_LENGTH}>{W.save}</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>{W.cancel}</Button>
          </div>
          {!note.canManage && <p className="text-sm text-gray-600">{readOnly}</p>}
        </form>
      </> : <>
        <p className="whitespace-pre-wrap text-sm text-gray-900">{note.text || W.empty}</p>
        {note.canManage ? <Button type="button" variant="secondary" disabled={!!error} onClick={onEdit}>{W.edit}</Button>
          : <p className="text-sm text-gray-600">{readOnly}</p>}
      </>}
      {!latest && changed}
    </>}
  </>;
}

export function PartnerTeamNoteView(props: { state: NoteState } & NoteActions) {
  return <section aria-label={W.title} className="min-w-0 space-y-4 rounded-xl border border-gray-200 bg-white p-5 [overflow-wrap:anywhere]">
    <h2 className="font-semibold text-gray-900">{W.title}</h2>
    <p className="text-sm text-gray-600">{W.description}</p>
    <TeamNoteBody {...props} />
  </section>;
}

/**
 * One note behaviour for every screen. `initial` is a note the screen already holds (no first read); `editing` opens straight
 * on the field (a dialog); `onSaved` runs after the save is confirmed.
 */
export function useTeamNote(source: TeamNoteSource, { initial, editing = false, onSaved }: { initial?: TeamNote; editing?: boolean; onSaved?: () => void } = {}): { state: NoteState } & NoteActions {
  const [state, setState] = useState<NoteState>(() => initial
    ? { ...INITIAL, loading: false, note: initial, editing, draft: editing ? initial.text : '', base: initial.text } : INITIAL);
  const generation = useRef(0);
  const saving = useRef(false);
  async function load() {
    const token = ++generation.current;
    // A draft is never discarded by reading again: only the saved note is replaced.
    setState(current => current.editing ? { ...current, loading: true } : { ...INITIAL });
    try {
      const note = await source.load();
      if (token === generation.current) setState(current => ({ ...current, loading: false, note, error: null, conflict: false }));
    } catch (cause) {
      if (token === generation.current) setState(current => ({ ...current, loading: false,
        error: (cause as { status?: number })?.status === 403 ? W.denied : W.loadFailed }));
    }
  }
  useEffect(() => { if (!initial) void load(); return () => { generation.current++; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The screen read its report again and brought another version of the note: show it, unless a draft is open (saving it will say so).
  useEffect(() => {
    if (initial) setState(current => current.editing || current.note?.version === initial.version ? current : { ...current, note: initial });
  }, [initial?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!state.note?.canManage || state.loading || state.error || state.conflict || saving.current || state.draft.length > COMPANY_TEAM_NOTE_MAX_LENGTH) return;
    const token = generation.current;
    saving.current = true;
    setState(current => ({ ...current, saving: true }));
    try {
      const note = await source.save({ text: state.draft, expectedVersion: state.note.version });
      if (token !== generation.current) return;
      setState({ ...INITIAL, loading: false, note });
      // The result is said where it is always in view, however long the note is.
      emitToast({ tone: 'success', message: W.saved });
      onSaved?.();
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
  return { state, onReload: () => void load(), onSave: () => void save(),
    onEdit: () => setState(current => ({ ...current, editing: true, draft: current.note?.text ?? '', base: current.note?.text ?? '' })),
    onCancel: () => setState(current => ({ ...current, editing: false, draft: '' })),
    onDraft: draft => setState(current => ({ ...current, draft })) };
}

export default function PartnerTeamNote({ companyId }: { companyId: string }) {
  return <PartnerTeamNoteView {...useTeamNote({ load: () => getPartnerTeamNote(companyId), save: body => putPartnerTeamNote(companyId, body) })} />;
}
