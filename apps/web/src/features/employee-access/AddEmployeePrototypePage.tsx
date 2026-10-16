'use client';

import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { THAI_SYSTEM_ROLE_NAMES, ALL_BRANCH_ROLE_KEYS, type EmployeeLineLinkPackage, type EmployeeSummary, type RoleSummary } from '@watchdog-bms/contracts';
import { ChoiceRow } from '@/common/components/field';
import { ThaiAddressFields } from '@/common/components/field/ThaiAddressFields';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { LoadingState } from '@/common/components/state/LoadingState';
import { MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { Notice } from '@/common/components/notice';
import { primaryButtonClass, secondaryButtonClass } from '@/common/components/button/button-classes';
import { useUnsavedNavigation } from '@/common/components/unsaved-navigation/use-unsaved-navigation';
import { useToast } from '@/common/components/toast';
import { listBranches as listCompanyBranches, type Branch } from '../branch-settings/branches.api';
import { completeEmployee, createEmployee, getEmployee, issueEmployeeLineLinkToken, listRoles, updateEmployee, type CreateEmployeeResult } from './employee-access.api';
import { employeeDateToIso, formatEmployeeDateInput } from './employee-date.logic';
import { isEmployeeEmail } from './employee-email.logic';
import { EMPLOYEE_BRANCH_SCOPE_HELP, assignableRoleOptions, isOperationalRoleTargetReadOnly, isSelfEmployee, roleDisplayName } from './role-picker.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { localizedErrorMessage } from '@/common/i18n/error-message.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { formatThaiTime } from '@/common/i18n/thai-date';
import { useBranchFilter } from '../web-core-workspace/WorkspaceScope';
import { MemberPayoutAccountCard } from '../reimbursements/ReimbursementPayout';

type TitleOption = 'นาย' | 'นาง' | 'นางสาว';
/** 1–3 are the form (one at a time for a new person, all on one page for an existing one); 4 is the page shown after the save. */
type AddStep = 1 | 2 | 3 | 4;
type ValidationIssue = { message: string; fieldId: string };
type FieldErrors = Record<string, string>;
type PageProps = { companyId: string; editEmployeeId?: string; viewerUserId?: string; viewerPermissions?: string[]; viewerBranchIds?: string[] };

// Field-specific 409 messages. Codes must match create-employee.use-case.ts (identity/phone/email).
const EMPLOYEE_CONFLICT_KEYS = {
  employee_identity_conflict: 'employee.error.identity_conflict',
  employee_phone_conflict: 'employee.error.phone_conflict',
  employee_email_conflict: 'employee.error.email_conflict',
  employee_email_must_differ: 'employee.error.email_must_differ',
  employee_username_conflict: 'employee.error.username_conflict',
} as const;

const EMPLOYEE_CONFLICT_FIELDS: Partial<Record<keyof typeof EMPLOYEE_CONFLICT_KEYS, { step: AddStep; fieldId: string }>> = {
  employee_identity_conflict: { step: 1, fieldId: 'employee-identity' },
  employee_phone_conflict: { step: 2, fieldId: 'employee-phone' },
  employee_email_conflict: { step: 2, fieldId: 'employee-email' },
  employee_email_must_differ: { step: 2, fieldId: 'employee-email' },
  employee_username_conflict: { step: 1, fieldId: 'employee-username' },
};

const STEP_DEFS: Array<{ n: AddStep; label: string }> = [
  { n: 1, label: 'ข้อมูลส่วนตัว' },
  { n: 2, label: 'ช่องทางติดต่อ' },
  { n: 3, label: 'บทบาทและสาขา' },
];

const labelClass = 'text-sm font-medium text-gray-700';
const hintClass = 'text-xs text-gray-500';
const errorClass = 'text-sm text-red-600';
const sectionTitleClass = 'text-base font-semibold text-gray-900';

function digits(value: string, max: number) {
  return value.replace(/[^0-9]/g, '').slice(0, max);
}

function isoToDob(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** A Thai year typed into the ค.ศ. field is the usual slip, so the message says which year to type instead. */
function birthDateError(value: string) {
  const year = Number(/(\d{4})$/.exec(value)?.[1] ?? 0);
  return year > 2400
    ? `ปี ${year} เป็น พ.ศ. กรอกเป็น ค.ศ. คือ ${year - 543}`
    : 'วันเดือนปีเกิดไม่ถูกต้อง กรอกเป็น วัน/เดือน/ปี ค.ศ. เช่น 01/02/1995';
}

/**
 * คำนำหน้า has its own field since 2026-08-15. Rows written before that still carry it inside
 * `displayName`, so the old `startsWith` guess survives only as a fallback for them — never for a
 * record that states its own title. Delete it once no pre-split rows remain.
 */
function employeeTitle(employee: EmployeeSummary): TitleOption {
  if (employee.titlePrefix) return employee.titlePrefix;
  if (employee.displayName.startsWith('นางสาว')) return 'นางสาว';
  if (employee.displayName.startsWith('นาง')) return 'นาง';
  return 'นาย';
}

/** The stored name for a pre-split row still has the title glued on; a split row does not. */
function employeeNameWithoutTitle(employee: EmployeeSummary): string {
  if (employee.titlePrefix) return employee.displayName;
  return employee.displayName.slice(employeeTitle(employee).length).trim();
}

/**
 * One text field of this form in the shared look. The hint and the error sit outside the `<label>`,
 * so the field keeps one name ("ชื่อ *") whatever is shown under it, and the line under the field is
 * the error when there is one, else the hint (never both).
 */
function TextField({
  id,
  label,
  required = false,
  optional,
  hint,
  error,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  id: string;
  label: string;
  required?: boolean;
  optional?: string;
  hint?: string;
  error?: string;
}) {
  const lineId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className={labelClass}>
        {label}
        {required && <span className="text-red-600"> *</span>}
        {optional && <span className="font-normal text-gray-500"> {optional}</span>}
      </label>
      <input {...props} id={id} aria-describedby={lineId} aria-invalid={error ? true : undefined} className={cx('mangmee-input', error && '!border-red-500')} />
      {error
        ? <span id={`${id}-error`} role="alert" className={errorClass}>{error}</span>
        : hint && <span id={`${id}-hint`} className={hintClass}>{hint}</span>}
    </div>
  );
}

/**
 * The way to LINE for one person: a QR for their own phone and the link to send them. The address
 * itself is not printed (a three-line token nobody reads). `data-link` carries it for the browser
 * tests. The link is short-lived, so the block says until when and offers a new one.
 */
function LineLinkBlock({ name, linked, lineLink, busy, error, onIssue, onCopy }: {
  name: string;
  linked: boolean;
  lineLink: EmployeeLineLinkPackage | null;
  busy: boolean;
  error: string;
  onIssue: () => void;
  onCopy: (linkUrl: string) => void;
}) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    if (!lineLink) return;
    const left = new Date(lineLink.expiresAt).getTime() - Date.now();
    if (left <= 0) { setExpired(true); return; }
    // setTimeout holds at most about 24 days; a link never lives that long.
    const timer = window.setTimeout(() => setExpired(true), Math.min(left, 2_000_000_000));
    return () => window.clearTimeout(timer);
  }, [lineLink]);
  const usable = lineLink && !expired ? lineLink : null;
  const qr = (
    <>
      {usable ? (
        <>
          <p className="mt-1 text-sm text-gray-600">ให้ {name} สแกน QR นี้ด้วยมือถือของเขา หรือส่งลิงก์ให้เขาเปิด ใช้ได้ถึง {formatThaiTime(usable.expiresAt)}</p>
          <img src={usable.qrImageUrl} alt={`QR เชื่อม LINE ของ ${name}`} className="mt-3 h-40 w-40 rounded-lg border border-gray-200 bg-white p-1.5" />
        </>
      ) : (
        <p className="mt-1 text-sm text-gray-600">{lineLink ? 'QR นี้หมดเวลาแล้ว ออก QR ใหม่เพื่อเชื่อม' : 'ยังไม่มี QR สำหรับเชื่อม LINE'}</p>
      )}
      {error && <p role="alert" className={cx('mt-2', errorClass)}>{error}</p>}
      <ActionGroup align="start" className="mt-3">
        {usable && <button type="button" className={secondaryButtonClass} data-link={usable.linkUrl} onClick={() => onCopy(usable.linkUrl)}>คัดลอกลิงก์</button>}
        <button type="button" className={secondaryButtonClass} disabled={busy} aria-busy={busy} onClick={onIssue}>ออก QR ใหม่</button>
      </ActionGroup>
    </>
  );
  return (
    <section className="rounded-xl border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900">เชื่อม LINE</h2>
      {linked ? (
        <>
          <p className="mt-1 text-sm text-gray-600">{name} เชื่อม LINE แล้ว</p>
          <details className="mt-1">
            <summary className="cursor-pointer py-2.5 text-sm font-semibold text-gray-700">เชื่อมกับ LINE อีกครั้ง</summary>
            {qr}
          </details>
        </>
      ) : qr}
    </section>
  );
}

export function AddEmployeePrototypePage(props: PageProps) {
  // "เพิ่มพนักงานอีกคน" starts again with an empty form: a new key mounts the form anew.
  const [round, setRound] = useState(0);
  return <EmployeeForm key={round} {...props} onAddAnother={() => setRound((current) => current + 1)} />;
}

function EmployeeForm({ companyId, editEmployeeId, viewerUserId, viewerPermissions = [], viewerBranchIds, onAddAnother }: PageProps & { onAddAnother: () => void }) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const toast = useToast();
  const workspaceBranch = useBranchFilter();
  const selectedWorkspaceBranch = useRef(workspaceBranch?.branchId ?? '');
  selectedWorkspaceBranch.current = workspaceBranch?.branchId ?? '';
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [step, setStep] = useState<AddStep>(1);
  const [title, setTitle] = useState<TitleOption>('นาย');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [dob, setDob] = useState('');
  const [username, setUsername] = useState('');
  const [idCard, setIdCard] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [postal, setPostalCode] = useState('');
  const [province, setProvince] = useState('');
  const [amphoe, setAmphoe] = useState('');
  const [tambon, setTambon] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [addressOpen, setAddressOpen] = useState(false);
  const [jobTitle, setJobTitle] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [defaultBranchId, setDefaultBranchId] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CreateEmployeeResult | null>(null);
  const [editLineLink, setEditLineLink] = useState<EmployeeLineLinkPackage | null>(null);
  const [lineLinkBusy, setLineLinkBusy] = useState(false);
  const [lineLinkError, setLineLinkError] = useState('');
  const [confirmExistingUser, setConfirmExistingUser] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeSummary | null>(null);
  // The person this page added, as the server holds them. Once it is set every later save updates this
  // person: going back from the result page and saving again must never try to add them a second time.
  const [createdEmployee, setCreatedEmployee] = useState<EmployeeSummary | null>(null);
  const [draftActivated, setDraftActivated] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [activationError, setActivationError] = useState('');
  // What the server holds, as one string: the form is "changed" while it differs from this.
  const [savedForm, setSavedForm] = useState<string | null>(null);
  const isEditing = Boolean(editEmployeeId);
  const employeeActive = draftActivated || editingEmployee?.status === 'ACTIVE';
  const canReadEmployees = viewerPermissions.includes('access.employee.read');
  const canCompleteDraft = viewerPermissions.includes('access.employee.create');
  const person = editingEmployee ?? createdEmployee;
  const personId = person?.id ?? result?.employeeId;
  const listHref = `/companies/${companyId}/settings/access-overview`;

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    void (async () => {
      const [rolesResult, branchesResult, employeeResult] = await Promise.allSettled([
        listRoles(companyId),
        listCompanyBranches(companyId),
        editEmployeeId ? getEmployee(companyId, editEmployeeId) : Promise.resolve(null),
      ]);
      if (rolesResult.status === 'fulfilled') {
        const currentRoleIds = employeeResult.status === 'fulfilled' ? employeeResult.value?.roles.map((role) => role.id) : undefined;
        const assignable = assignableRoleOptions(rolesResult.value, currentRoleIds).map((role) => ({ ...role, name: roleDisplayName(role) }));
        setRoles(assignable);
        setRoleIds((current) => current.length ? current : currentRoleIds ?? []);
      } else {
        setLoadError(localizedErrorMessage(rolesResult.reason, locale, { fallback: 'error.load_failed' }));
      }
      if (branchesResult.status === 'fulfilled') {
        setBranches(branchesResult.value.filter((branch) => branch.status === 'ACTIVE'));
        const active = branchesResult.value.filter((branch) => branch.status === 'ACTIVE' && (viewerBranchIds === undefined || viewerBranchIds.includes(branch.id)));
        const initial = active.find((branch) => branch.id === selectedWorkspaceBranch.current)?.id
          ?? (active.length === 1 ? active[0]!.id : '');
        setBranchIds((current) => current.length ? current : initial ? [initial] : []);
        setDefaultBranchId((current) => current || initial);
      }
      if (employeeResult.status === 'fulfilled' && employeeResult.value) {
        const employee = employeeResult.value;
        const fallbackName = employeeNameWithoutTitle(employee).split(/\s+/);
        setEditingEmployee(employee);
        setTitle(employeeTitle(employee));
        setFirstName(employee.firstName ?? fallbackName[0] ?? '');
        setLastName(employee.lastName ?? fallbackName.slice(1).join(' '));
        setNickname(employee.nickname ?? '');
        setJobTitle(employee.jobTitle ?? '');
        setDob(isoToDob(employee.dateOfBirth));
        setEmail(employee.email ?? '');
        setPhone(employee.phoneNumber);
        setPostalCode(employee.postalCode ?? '');
        setProvince(employee.province ?? '');
        setAmphoe(employee.district ?? '');
        setTambon(employee.subdistrict ?? '');
        setAddressLine(employee.addressLine ?? '');
        setAddressOpen(Boolean(employee.postalCode || employee.province || employee.addressLine));
        setRoleIds(employee.roles.map((role) => role.id));
        if (branchesResult.status === 'fulfilled') {
          const activeBranchIds = branchesResult.value.filter((branch) => branch.status === 'ACTIVE').map((branch) => branch.id);
          const selectedBranchIds = employee.branchScopeMode === 'ALL_BRANCHES'
            ? activeBranchIds
            : employee.branchScopeBranchIds.filter((id) => activeBranchIds.includes(id));
          setBranchIds(selectedBranchIds);
          setDefaultBranchId(
            employee.defaultBranchId && selectedBranchIds.includes(employee.defaultBranchId)
              ? employee.defaultBranchId
              : selectedBranchIds[0] ?? '',
          );
        }
      } else if (employeeResult.status === 'rejected') {
        setLoadError(localizedErrorMessage(employeeResult.reason, locale, { fallback: 'error.load_failed' }));
      }
    })().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, editEmployeeId, loadAttempt]);

  const selectedRoles = roles.filter((role) => roleIds.includes(role.id));
  const selectedRoleNames = selectedRoles.map((role) => role.name).join(', ');
  // The API always rejects a self role change, so editing yourself shows the role read-only and the
  // unchanged roleIds save as a no-op (spec R4).
  const editingSelf = isSelfEmployee(editingEmployee, viewerUserId);
  const editingProtectedRole = isOperationalRoleTargetReadOnly(viewerPermissions, selectedRoles);
  // R8: an oversight role (ADMIN, FINANCE, ACCOUNTANT, ...) must hold every branch, and the server
  // rejects anything narrower — so the picker must not offer the choice.
  const allBranchRoles = selectedRoles.filter((role) => ALL_BRANCH_ROLE_KEYS.includes(role.key));
  const branchPickerLocked = allBranchRoles.length > 0;
  const branchScopeReadOnly = viewerBranchIds !== undefined && Boolean(editingEmployee && (
    editingEmployee.branchScopeMode === 'ALL_BRANCHES'
    || [...editingEmployee.branchScopeBranchIds, ...(editingEmployee.defaultBranchId ? [editingEmployee.defaultBranchId] : [])].some((id) => !viewerBranchIds.includes(id))
  ));

  useEffect(() => {
    if (!branchPickerLocked || branches.length === 0) return;
    setBranchIds(branches.map((branch) => branch.id));
    setDefaultBranchId((current) => current || (branches.length === 1 ? branches[0]!.id : ''));
  }, [branchPickerLocked, branches]);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const personName = fullName || person?.displayName || 'พนักงาน';
  // A shop with one branch has nothing to choose: the person works there and it is their main branch.
  const showBranchPicker = branches.length !== 1 || branchIds.length !== 1 || defaultBranchId !== branchIds[0];
  const lineLink = editLineLink ?? result?.lineLink ?? null;

  const formNow = JSON.stringify([title, firstName, lastName, nickname, dob, username, idCard, email, phone, postal, province, amphoe, tambon, addressLine, jobTitle, roleIds, branchIds, defaultBranchId]);
  useEffect(() => {
    if (!loading && savedForm === null) setSavedForm(formNow);
  }, [loading, savedForm, formNow]);
  const dirty = savedForm !== null && formNow !== savedForm;
  // Two choices only: the shared dialog's third button is named for a draft document, and this form saves with its own button.
  const navigation = useUnsavedNavigation({ dirty, canSave: false, saving, error: null, onSave: async () => false,
    title: 'ยังไม่ได้บันทึกสิ่งที่กรอก', description: 'ถ้าออกตอนนี้ สิ่งที่กรอกไว้จะหาย' });

  function clearFieldError(fieldId: string) {
    setError('');
    setErrors((current) => {
      if (!(fieldId in current)) return current;
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  }

  /** Every problem of one step, in the order of its fields, so one press shows them all. */
  function validate(targetStep: AddStep): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const add = (fieldId: string, message: string) => { issues.push({ fieldId, message }); };
    if (targetStep === 1) {
      if (!firstName.trim()) add('employee-first-name', 'กรอกชื่อ');
      if (!lastName.trim()) add('employee-last-name', 'กรอกนามสกุล');
      if (!personId) {
        if (!username.trim()) add('employee-username', 'กรอกชื่อผู้ใช้');
        else if (!/^[a-zA-Z0-9._-]+$/.test(username.trim())) add('employee-username', 'ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง');
      }
      if (!person && !dob) add('employee-date-of-birth', 'กรอกวันเดือนปีเกิด');
      else if (dob && !employeeDateToIso(dob)) add('employee-date-of-birth', birthDateError(dob));
      if ((!person || idCard) && !/^[0-9]{13}$/.test(idCard)) add('employee-identity', 'เลขบัตรประชาชนต้องมี 13 หลัก');
    }
    if (targetStep === 2) {
      if (!email.trim()) add('employee-email', 'กรอกอีเมล');
      else if (!isEmployeeEmail(email)) add('employee-email', 'อีเมลไม่ถูกต้อง');
      if (!phone) add('employee-phone', 'กรอกเบอร์โทรศัพท์');
      else if (!/^0[0-9]{9}$/.test(phone)) add('employee-phone', 'เบอร์โทรศัพท์ต้องมี 10 หลักและขึ้นต้นด้วย 0');
    }
    if (targetStep === 3) {
      if (!jobTitle.trim()) add('employee-job-title', 'กรอกตำแหน่งงาน');
      if (!editingSelf && !editingProtectedRole && roleIds.length !== 1) add('employee-role', 'เลือกบทบาท 1 บทบาท');
      if (branchIds.length === 0) add('employee-branches', 'เลือกอย่างน้อย 1 สาขา');
      else if (!defaultBranchId || !branchIds.includes(defaultBranchId)) add('employee-default-branch', 'เลือกสาขาหลัก');
    }
    return issues;
  }

  function showIssues(issues: ValidationIssue[]) {
    setError('');
    setErrors(Object.fromEntries(issues.map((issue) => [issue.fieldId, issue.message])));
    const first = issues[0]?.fieldId;
    if (first) window.requestAnimationFrame(() => document.getElementById(first)?.focus());
  }

  /** The first step that still has a problem, shown with all its problems; `true` when there is none. */
  function stepsAreValid(steps: AddStep[]): boolean {
    for (const candidate of steps) {
      const issues = validate(candidate);
      if (issues.length) {
        setStep(candidate);
        showIssues(issues);
        return false;
      }
    }
    return true;
  }

  function goToStep(target: AddStep) {
    if (target > step && !stepsAreValid(STEP_DEFS.map((definition) => definition.n).filter((n) => n >= step && n < target))) return;
    setStep(target);
    setError('');
    setErrors({});
  }

  /** Saves the form. Returns the person's id, or `null` when nothing was saved (the reason is on screen). */
  async function submitDraft(linkExistingUser = false): Promise<string | null> {
    setSaving(true);
    setError('');
    setErrors({});
    try {
      const profile = {
        // The stored name is the name alone; the title goes in its own field so nothing downstream
        // has to guess it back out of a concatenated string.
        displayName: fullName,
        titlePrefix: title,
        jobTitle: jobTitle.trim(),
        phoneNumber: phone,
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        nickname: nickname.trim() || (person ? null : undefined),
        dateOfBirth: employeeDateToIso(dob) ?? (person ? null : undefined),
        addressLine: addressLine.trim() || (person ? null : undefined),
        postalCode: postal || (person ? null : undefined),
        province: province.trim() || (person ? null : undefined),
        district: amphoe.trim() || (person ? null : undefined),
        subdistrict: tambon.trim() || (person ? null : undefined),
        roleIds,
      };
      const allBranches = viewerBranchIds === undefined && branchIds.length === branches.length;
      const branchScope = {
        branchScopeMode: allBranches ? 'ALL_BRANCHES' : 'SELECTED_BRANCHES',
        branchIds: allBranches ? [] : branchIds,
        defaultBranchId,
      };
      if (personId) {
        const updated = await updateEmployee(companyId, personId, {
          ...profile,
          // Profile-only edits must not resubmit legacy roles or mutate self/protected access.
          ...((editingSelf || editingProtectedRole) ? { roleIds: undefined } : {}),
          ...(branchScopeReadOnly ? {} : branchScope),
          ...(idCard && { identityType: person?.identityType ?? 'THAI_NATIONAL_ID', identityNumber: idCard }),
        });
        if (editingEmployee) setEditingEmployee(updated); else setCreatedEmployee(updated);
        setIdCard('');
        setSavedForm(null);
        // ponytail: fresh QR on each save; backend keeps a single pending token per employee
        setEditLineLink(await issueEmployeeLineLinkToken(companyId, updated.id).catch(() => null));
        return updated.id;
      }
      const created = await createEmployee(companyId, {
        ...profile,
        username: username.trim(),
        identityType: 'THAI_NATIONAL_ID',
        identityNumber: idCard,
        ...(linkExistingUser && { linkExistingUser: true }),
      });
      // The person exists from here on, whatever happens to the calls below.
      setResult(created);
      setConfirmExistingUser(false);
      setCreatedEmployee(await updateEmployee(companyId, created.employeeId, {
        ...branchScope,
      }));
      setIdCard('');
      setSavedForm(null);
      return created.employeeId;
    } catch (e) {
      // The username belongs to an existing account (e.g. an owner of another company): offer to
      // attach them here with their existing login instead of surfacing a hard conflict error.
      if ((e as { code?: string })?.code === 'employee_existing_user') {
        setConfirmExistingUser(true);
        return null;
      }
      const code = (e as { code?: keyof typeof EMPLOYEE_CONFLICT_KEYS })?.code;
      const message = code && EMPLOYEE_CONFLICT_KEYS[code]
        ? localizedErrorMessage(e, locale, { fallback: 'error.save_failed', conflictCodes: EMPLOYEE_CONFLICT_KEYS })
        : apiErrorMessage(e, locale);
      const target = code ? EMPLOYEE_CONFLICT_FIELDS[code] : undefined;
      if (target) {
        setStep(target.step);
        showIssues([{ message, fieldId: target.fieldId }]);
      } else {
        setError(message);
      }
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function activateEmployee(employeeId: string) {
    setSaving(true);
    setActivationError('');
    try {
      await completeEmployee(companyId, employeeId);
      setDraftActivated(true);
      toast.success(`เปิดใช้งาน ${personName} แล้ว`);
    } catch (e) {
      setActivationError(localizedErrorMessage(e, locale, { fallback: 'error.save_failed' }));
    } finally {
      setSaving(false);
    }
  }

  /**
   * The one save of the form. A new person is saved and switched on in the same press (the two calls
   * the page always made, one after the other); when the second is refused the person stays a draft
   * and the result page says so, with the button to try again.
   */
  async function saveEmployee(linkExistingUser = false) {
    if (!stepsAreValid(STEP_DEFS.map((definition) => definition.n))) return;
    const switchOn = !isEditing && !employeeActive && canCompleteDraft;
    const employeeId = await submitDraft(linkExistingUser);
    if (!employeeId) return;
    setStep(4);
    if (switchOn) await activateEmployee(employeeId);
    else toast.success(`บันทึกข้อมูลของ ${personName} แล้ว`);
  }

  async function issueLineLink() {
    if (!personId) return;
    setLineLinkBusy(true);
    setLineLinkError('');
    try {
      setEditLineLink(await issueEmployeeLineLinkToken(companyId, personId));
    } catch (e) {
      setLineLinkError(localizedErrorMessage(e, locale, { fallback: 'error.load_failed' }));
    } finally {
      setLineLinkBusy(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('คัดลอกแล้ว');
    } catch {
      toast.error('คัดลอกไม่ได้ จดไว้แทน');
    }
  }

  function leavePage() {
    router.push(canReadEmployees ? listHref : `/companies/${companyId}/dashboard`);
    // The shell name comes from the server layout's session, and a shared layout survives client
    // navigation — without this a self-rename stays stale in the sidebar until a full reload.
    router.refresh();
  }

  function toggleBranch(branchId: string) {
    if (branchScopeReadOnly || branchPickerLocked || (viewerBranchIds !== undefined && !viewerBranchIds.includes(branchId))) return;
    const selected = branchIds.includes(branchId);
    if (selected && branchIds.length === 1) return;
    const next = selected ? branchIds.filter((id) => id !== branchId) : [...branchIds, branchId];
    setBranchIds(next);
    if (!next.includes(defaultBranchId)) setDefaultBranchId(next[0] ?? '');
    clearFieldError('employee-branches');
  }

  function toggleAllBranches() {
    if (branchScopeReadOnly || branchPickerLocked || viewerBranchIds !== undefined) return;
    const allIds = branches.map((b) => b.id);
    const allSelected = allIds.every((id) => branchIds.includes(id));
    const next = allSelected ? (branches[0] ? [branches[0].id] : []) : allIds;
    setBranchIds(next);
    if (!next.includes(defaultBranchId)) setDefaultBranchId(next[0] ?? '');
    clearFieldError('employee-branches');
  }

  const renderPersonal = () => (
    <div className="grid gap-4 sm:grid-cols-2">
      <fieldset className="min-w-0 sm:col-span-2">
        <legend className={labelClass}>คำนำหน้า</legend>
        <div className="flex flex-wrap gap-x-6">
          {(['นาย', 'นาง', 'นางสาว'] as TitleOption[]).map((item) => (
            <ChoiceRow key={item} name="employee-title" value={item} label={item} checked={title === item} onChange={() => setTitle(item)} />
          ))}
        </div>
      </fieldset>
      <fieldset className="grid min-w-0 gap-4 sm:col-span-2 sm:grid-cols-2">
        <legend className={labelClass}>ชื่อที่แสดง</legend>
      <TextField id="employee-first-name" label="ชื่อ" required error={errors['employee-first-name']} value={firstName} onChange={(event) => { setFirstName(event.target.value); clearFieldError('employee-first-name'); }} placeholder="เช่น มีนา" />
      <TextField id="employee-last-name" label="นามสกุล" required error={errors['employee-last-name']} value={lastName} onChange={(event) => { setLastName(event.target.value); clearFieldError('employee-last-name'); }} placeholder="เช่น ใจงาม" />
      </fieldset>
      <TextField id="employee-nickname" label="ชื่อเล่น" optional="(ถ้ามี)" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="เช่น มีน" />
      {!personId && (
        <TextField id="employee-username" label="ชื่อผู้ใช้" required autoCapitalize="none" autoCorrect="off" spellCheck={false}
          hint="ใช้เข้าสู่ระบบ เป็นตัวอักษรอังกฤษหรือตัวเลข เช่น meena.j"
          error={errors['employee-username']} value={username}
          onChange={(event) => { setUsername(event.target.value); clearFieldError('employee-username'); setConfirmExistingUser(false); }} />
      )}
      <TextField id="employee-date-of-birth" label="วันเดือนปีเกิด (ค.ศ.)" required={!person} optional={person ? '(ถ้ามี)' : undefined}
        hint="เช่น 01/02/1995" error={errors['employee-date-of-birth']} value={dob}
        onChange={(event) => { setDob(formatEmployeeDateInput(event.target.value)); clearFieldError('employee-date-of-birth'); }}
        inputMode="numeric" placeholder="วว/ดด/ปปปป" maxLength={10} />
      <TextField id="employee-identity" label="เลขบัตรประชาชน" required={!person}
        hint={person ? `เลขเดิม ${person.identityMasked} กรอกเฉพาะเมื่อต้องการเปลี่ยน` : '13 หลัก'}
        error={errors['employee-identity']} value={idCard}
        onChange={(event) => { setIdCard(digits(event.target.value, 13)); clearFieldError('employee-identity'); }}
        inputMode="numeric" />
    </div>
  );

  const renderContact = () => (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="employee-email" type="email" inputMode="email" autoComplete="email" maxLength={254} label="อีเมล (ใช้เข้าสู่ระบบ)" required error={errors['employee-email']} value={email} onChange={(event) => { setEmail(event.target.value); clearFieldError('employee-email'); }} />
        <TextField id="employee-phone" type="tel" label="เบอร์โทรศัพท์" required hint="10 หลัก" error={errors['employee-phone']} value={phone} onChange={(event) => { setPhone(digits(event.target.value, 10)); clearFieldError('employee-phone'); }} inputMode="tel" maxLength={10} />
      </div>
      <details className="mt-3" open={addressOpen} onToggle={(event) => setAddressOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer py-2.5 text-sm font-semibold text-gray-700">ที่อยู่ (ถ้ามี)</summary>
        <ThaiAddressFields companyId={companyId} className="mt-1 grid gap-4 sm:grid-cols-2"
          value={{ postalCode: postal, province, district: amphoe, subdistrict: tambon }}
          onChange={(next) => { setPostalCode(next.postalCode); setProvince(next.province); setAmphoe(next.district); setTambon(next.subdistrict); }} />
        <TextField id="employee-address-line" className="mt-4" label="บ้านเลขที่ หมู่ ถนน" value={addressLine} onChange={(event) => setAddressLine(event.target.value)} placeholder="เช่น 45/1 ซอยสุขุมวิท ถนนสุขุมวิท" />
      </details>
    </div>
  );

  const renderRoleAndBranch = () => (
    <div className="grid gap-5">
      <TextField id="employee-job-title" label="ตำแหน่งงาน" required maxLength={120} className="max-w-xl"
        hint="ชื่อหน้าที่ในร้าน ไม่เกี่ยวกับสิทธิ์" error={errors['employee-job-title']} value={jobTitle}
        onChange={(event) => { setJobTitle(event.target.value); clearFieldError('employee-job-title'); }}
        placeholder="เช่น พนักงานขาย หรือหัวหน้าคลัง" />

      <fieldset id="employee-role" tabIndex={-1} className="min-w-0 outline-none">
        <legend className={labelClass}>บทบาท <span className="text-red-600" aria-hidden="true">*</span></legend>
        {editingSelf || editingProtectedRole ? (
          <>
            <p className="mt-1 text-sm font-semibold text-gray-800">{selectedRoleNames}</p>
            <p className={cx('mt-1', hintClass)}>
              {editingSelf ? 'บทบาทของตัวเองต้องให้ผู้ดูแลคนอื่นเปลี่ยนให้' : `บทบาทระดับนี้ต้องให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้ดูแลสิทธิ์เป็นผู้เปลี่ยน`}
            </p>
          </>
        ) : (
          <>
            <div className="grid gap-x-6 sm:grid-cols-2">
              {roles.map((item) => (
                <ChoiceRow key={item.id} name="employee-role" value={item.id} label={item.name}
                  checked={roleIds.length === 1 && roleIds[0] === item.id}
                  onChange={() => { setRoleIds([item.id]); clearFieldError('employee-role'); }} />
              ))}
            </div>
            {roles.length === 0 && !loading && <p className="mt-1 text-sm text-gray-500">ยังไม่มีบทบาทให้เลือก</p>}
            {errors['employee-role']
              ? <p role="alert" className={errorClass}>{errors['employee-role']}</p>
              : <p className={hintClass}>1 คนมี 1 บทบาท สิทธิ์ของแต่ละบทบาทอยู่ที่หน้าบทบาทและสิทธิ์</p>}
            {roleIds.length > 1 && <p role="status" className="mt-1 text-sm text-warning-700">ข้อมูลเดิมมีหลายบทบาท: {selectedRoleNames} เลือก 1 บทบาทเพื่อใช้แทนทั้งหมด</p>}
          </>
        )}
      </fieldset>

      {showBranchPicker && (
        <>
          <fieldset id="employee-branches" tabIndex={-1} className="min-w-0 outline-none">
            <legend className={labelClass}>สาขาที่ทำงาน</legend>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <ChoiceRow type="checkbox" label="ทุกสาขา" checked={branches.length > 0 && branchIds.length === branches.length}
                disabled={branchPickerLocked || branchScopeReadOnly || viewerBranchIds !== undefined} onChange={toggleAllBranches} />
              {branches.filter((branch) => branchIds.includes(branch.id) || viewerBranchIds === undefined || viewerBranchIds.includes(branch.id)).map((branch) => {
                const selected = branchIds.includes(branch.id);
                const last = selected && branchIds.length === 1;
                return (
                  <ChoiceRow key={branch.id} type="checkbox" label={branch.name} checked={selected}
                    disabled={last || branchPickerLocked || branchScopeReadOnly} onChange={() => toggleBranch(branch.id)} />
                );
              })}
            </div>
            {errors['employee-branches'] && <p role="alert" className={errorClass}>{errors['employee-branches']}</p>}
            {viewerBranchIds !== undefined && <p className={hintClass}>{EMPLOYEE_BRANCH_SCOPE_HELP}</p>}
            {branchPickerLocked && <p className={hintClass}>บทบาท {allBranchRoles.map((role) => role.name).join(', ')} ดูแลทั้งร้าน จึงต้องเห็นทุกสาขา</p>}
          </fieldset>

          <div className="flex max-w-md min-w-0 flex-col gap-1.5">
            <span className={labelClass}>สาขาหลัก <span className="text-red-600" aria-hidden="true">*</span></span>
            <ThemedSelect
              id="employee-default-branch"
              aria-label="สาขาหลัก"
              wrapLabel
              placeholder="เลือกสาขาหลัก"
              disabled={branchScopeReadOnly}
              aria-invalid={Boolean(errors['employee-default-branch'])}
              value={defaultBranchId}
              onChange={(event) => { setDefaultBranchId(event.target.value); clearFieldError('employee-default-branch'); }}
            >
              {branches.filter((branch) => branchIds.includes(branch.id)).map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </ThemedSelect>
            {errors['employee-default-branch']
              ? <span role="alert" className={errorClass}>{errors['employee-default-branch']}</span>
              : <span className={hintClass}>สาขาที่เลือกให้ก่อนเมื่อเขาบันทึกรายการใหม่</span>}
          </div>
        </>
      )}
    </div>
  );

  // The username is taken by an account that already exists: one question, two answers, in place of the save button.
  const renderExistingUserQuestion = () => (
    <div className="mt-6">
      <Notice tone="warning">
        ชื่อผู้ใช้ {username.trim()} มีบัญชีอยู่แล้ว ถ้าเป็นคนเดียวกัน เพิ่มเข้าร้านนี้ด้วยบัญชีเดิมได้
      </Notice>
      <ActionGroup className="mt-4">
        <button type="button" className={secondaryButtonClass} disabled={saving} aria-busy={saving}
          onClick={() => { setConfirmExistingUser(false); setStep(1); window.requestAnimationFrame(() => document.getElementById('employee-username')?.focus()); }}>แก้ชื่อผู้ใช้</button>
        <button type="button" className={primaryButtonClass} disabled={saving} aria-busy={saving} onClick={() => void saveEmployee(true)}>เพิ่มด้วยบัญชีเดิม</button>
      </ActionGroup>
    </div>
  );

  const saveButton = (
    <button type="button" className={primaryButtonClass} disabled={saving || loading} aria-busy={saving} onClick={() => void saveEmployee()}>
      {!isEditing && !employeeActive && canCompleteDraft ? 'บันทึกและเปิดใช้งาน' : 'บันทึก'}
    </button>
  );

  const renderForm = () => (
    <>
      {isEditing ? (
        <div className="grid gap-6">
          <section className="grid gap-4"><h2 className={sectionTitleClass}>ข้อมูลส่วนตัว</h2>{renderPersonal()}</section>
          <section className="grid gap-4 border-t border-gray-100 pt-5"><h2 className={sectionTitleClass}>ช่องทางติดต่อ</h2>{renderContact()}</section>
          <section className="grid gap-4 border-t border-gray-100 pt-5"><h2 className={sectionTitleClass}>บทบาทและสาขา</h2>{renderRoleAndBranch()}</section>
        </div>
      ) : (
        <>
          <ThemedSteps
            className="mb-6"
            aria-label="ขั้นตอนการเพิ่มพนักงาน"
            steps={STEP_DEFS.map((definition) => ({
              key: String(definition.n),
              label: definition.label,
              state: definition.n === step ? 'current' : definition.n < step ? 'done' : 'upcoming',
            }))}
            onStepPress={(index) => goToStep((index + 1) as AddStep)}
          />
          {step === 1 && renderPersonal()}
          {step === 2 && renderContact()}
          {step === 3 && renderRoleAndBranch()}
        </>
      )}

      {error && <Notice tone="error" className="mt-5">{error}</Notice>}

      {confirmExistingUser ? renderExistingUserQuestion() : isEditing ? (
        <ActionGroup className="mt-6">{saveButton}</ActionGroup>
      ) : (
        <ActionGroup className="mt-6">
          {step > 1 && <button type="button" className={secondaryButtonClass} disabled={saving} aria-busy={saving} onClick={() => goToStep((step - 1) as AddStep)}>กลับ</button>}
          {step < 3
            ? <button type="button" className={primaryButtonClass} disabled={loading} aria-busy={loading} onClick={() => goToStep((step + 1) as AddStep)}>ถัดไป</button>
            : saveButton}
        </ActionGroup>
      )}
    </>
  );

  const renderResult = () => (
    <div className="grid gap-4">
      {employeeActive ? (
        <Notice tone="success">
          {isEditing
            ? `บันทึกข้อมูลของ ${personName} แล้ว`
            : result?.reusedExistingAccount
              ? `เปิดใช้งานพนักงานแล้ว ${personName} เข้าร้านนี้ได้ด้วยชื่อผู้ใช้และรหัสผ่านเดิม`
              : `เปิดใช้งานพนักงานแล้ว ส่งชื่อผู้ใช้และรหัสผ่านด้านล่างให้ ${personName}`}
        </Notice>
      ) : activationError ? (
        <Notice tone="error">บันทึก {personName} เป็นร่างแล้ว แต่ยังเปิดใช้งานไม่ได้ {activationError}</Notice>
      ) : canCompleteDraft ? (
        <Notice tone="warning">{personName} ยังเป็นร่าง เข้าสู่ระบบไม่ได้จนกว่าจะเปิดใช้งาน</Notice>
      ) : (
        <Notice tone="info">บันทึกแล้ว {personName} ยังเป็นร่าง ผู้ที่มีสิทธิ์เพิ่มพนักงานต้องเป็นคนเปิดใช้งาน</Notice>
      )}

      {result && (
        <section className="rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900">ชื่อผู้ใช้และรหัสผ่าน</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className={hintClass}>ชื่อผู้ใช้</dt>
              <dd className="mt-0.5 break-all text-base font-semibold text-gray-900">{result.username}</dd>
            </div>
            {!result.reusedExistingAccount && (
              <div className="min-w-0">
                <dt className={hintClass}>รหัสผ่านครั้งแรก</dt>
                <dd data-secret className="mt-0.5 break-all text-base font-semibold text-gray-900">{result.temporaryPassword}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-sm text-gray-600">
            {result.reusedExistingAccount ? 'ไม่มีการตั้งรหัสผ่านใหม่ เขาใช้รหัสผ่านเดิมของบัญชีนี้' : 'เขาต้องตั้งรหัสผ่านใหม่เมื่อเข้าสู่ระบบครั้งแรก'}
          </p>
          <ActionGroup align="start" className="mt-3">
            <button type="button" className={secondaryButtonClass}
              onClick={() => void copyText(result.reusedExistingAccount ? result.username : `ชื่อผู้ใช้: ${result.username}\nรหัสผ่าน: ${result.temporaryPassword}`)}>
              {result.reusedExistingAccount ? 'คัดลอกชื่อผู้ใช้' : 'คัดลอกชื่อผู้ใช้และรหัสผ่าน'}
            </button>
          </ActionGroup>
        </section>
      )}

      {employeeActive && (
        <LineLinkBlock name={personName} linked={Boolean(person?.lineLinked)} lineLink={lineLink} busy={lineLinkBusy} error={lineLinkError}
          onIssue={() => void issueLineLink()} onCopy={(linkUrl) => void copyText(linkUrl)} />
      )}

      <ActionGroup className="mt-2">
        <button type="button" className={secondaryButtonClass} disabled={saving} onClick={() => { setActivationError(''); setStep(isEditing ? 1 : 3); }}>แก้ไขข้อมูล</button>
        {!isEditing && employeeActive && <button type="button" className={secondaryButtonClass} onClick={onAddAnother}>เพิ่มพนักงานอีกคน</button>}
        {!employeeActive && canCompleteDraft && personId
          ? <button type="button" className={primaryButtonClass} disabled={saving} aria-busy={saving} onClick={() => void activateEmployee(personId)}>{activationError ? 'เปิดใช้งานอีกครั้ง' : 'เปิดใช้งานพนักงาน'}</button>
          : <button type="button" className={primaryButtonClass} onClick={leavePage}>{canReadEmployees ? 'ไปรายชื่อพนักงาน' : 'ไปหน้าแรก'}</button>}
      </ActionGroup>
    </div>
  );

  // An edit page that could not read its person must not turn into an empty "add" form under an "edit" title.
  const personMissing = isEditing && !loading && !editingEmployee;

  return (
    <MangmeePage
      back={canReadEmployees ? <BackLink href={listHref} label="กลับไปรายชื่อพนักงาน" /> : undefined}
      title={isEditing ? (editingEmployee ? `แก้ไขข้อมูล ${editingEmployee.displayName}` : 'แก้ไขข้อมูลพนักงาน') : 'เพิ่มพนักงาน'}
    >
      {loadError && (
        <Notice tone="error" action={<button type="button" className={secondaryButtonClass} disabled={loading} aria-busy={loading} onClick={() => setLoadAttempt((current) => current + 1)}>ลองอีกครั้ง</button>}>
          {loadError}
        </Notice>
      )}

      {!personMissing && (
        <MangmeeCard className="p-4 sm:p-6">
          {loading ? <LoadingState label="กำลังโหลด..." /> : step === 4 && personId ? renderResult() : renderForm()}
        </MangmeeCard>
      )}

      {/* One card beside the form, saved on its own: where this employee's claims are paid back.
          Offered only where the company uses reimbursements; the server holds a branch-limited
          editor to employees inside their own branches, the same reading as the branch picker above.
          Not for a draft or any other employee who is not active yet: the account owner is told of
          every change, and that notice reaches active members only (the server refuses the same). */}
      {editingEmployee && employeeActive && viewerPermissions.includes('reimbursement.create') && (
        <MemberPayoutAccountCard
          embedded
          companyId={companyId}
          {...(!editingSelf && { memberUserId: editingEmployee.userId })}
          canEdit={!branchScopeReadOnly}
          description="ใช้คืนเงินเมื่อพนักงานเบิกค่าใช้จ่าย เมื่อคนอื่นตั้งหรือแก้ให้ พนักงานจะได้รับแจ้งเตือนให้ตรวจทุกครั้ง"
        />
      )}
      {navigation.dialog}
    </MangmeePage>
  );
}
