'use client';

import type React from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { useRouter } from 'next/navigation';
import { ALL_BRANCH_ROLE_KEYS, type EmployeeLineLinkPackage, type EmployeeSummary, type RoleSummary, type ThaiAddressOption } from '@watchdog-bms/contracts';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { LoadingState } from '@/common/components/state/LoadingState';
import { MangmeeBranchChip, MangmeeCard, cx } from '@/common/components/mangmee';
import { useToast } from '@/common/components/toast';
import { listBranches as listCompanyBranches, type Branch } from '../branch-settings/branches.api';
import { completeEmployee, createEmployee, getEmployee, issueEmployeeLineLinkToken, listRoles, listThaiAddresses, updateEmployee, type CreateEmployeeResult } from './employee-access.api';
import { QrLinkCard } from './EmployeeAccessPages';
import { employeeDateToIso, formatEmployeeDateInput } from './employee-date.logic';
import { assignableRoleOptions, isSelfEmployee } from './role-picker.logic';
import { localizedErrorMessage } from '@/common/i18n/error-message.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';

type TitleOption = 'นาย' | 'นาง' | 'นางสาว';
type AddStep = 1 | 2 | 3 | 4;

// Field-specific 409 messages. Codes must match create-employee.use-case.ts (identity/phone/email).
const EMPLOYEE_CONFLICT_KEYS = {
  employee_identity_conflict: 'employee.error.identity_conflict',
  employee_phone_conflict: 'employee.error.phone_conflict',
  employee_email_conflict: 'employee.error.email_conflict',
  employee_email_must_differ: 'employee.error.email_must_differ',
  employee_username_conflict: 'employee.error.username_conflict',
} as const;

const STEP_DEFS: Array<{ n: AddStep; label: string }> = [
  { n: 1, label: 'ข้อมูลส่วนตัว' },
  { n: 2, label: 'ช่องทางติดต่อ' },
  { n: 3, label: 'ตำแหน่งและสาขา' },
  { n: 4, label: 'เข้าใช้งาน' },
];

function digits(value: string, max: number) {
  return value.replace(/[^0-9]/g, '').slice(0, max);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function isoToDob(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
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

function TextField({
  label,
  required = false,
  optional,
  className,
  inputClassName,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  required?: boolean;
  optional?: string;
  inputClassName?: string;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[15px] font-semibold text-gray-700">
        {label}
        {required && <span className="text-error-500"> *</span>}
        {optional && <span className="font-normal text-gray-400"> {optional}</span>}
      </span>
      <input
        {...props}
        className={cx(
          'h-11 w-full rounded-lg border border-gray-300 bg-white px-3.5 text-base text-gray-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-400',
          inputClassName,
        )}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  placeholder,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const labelId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useCloseOnOutsideClick(detailsRef, useCallback(() => {
    if (detailsRef.current?.open) detailsRef.current.removeAttribute('open');
  }, []));

  function select(nextValue: string) {
    onChange(nextValue);
    detailsRef.current?.removeAttribute('open');
    summaryRef.current?.focus();
  }

  function moveOptionFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      detailsRef.current?.removeAttribute('open');
      summaryRef.current?.focus();
      return;
    }
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  return (
    <div className="block">
      <span id={labelId} className="mb-1.5 block text-[15px] font-semibold text-gray-700">{label}</span>
      <details ref={detailsRef} className="group relative">
        <summary
          ref={summaryRef}
          aria-label={`${label}: ${value || placeholder}`}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          onClick={(event) => { if (disabled) event.preventDefault(); }}
          className={cx(
            'flex h-11 list-none items-center justify-between rounded-lg border border-gray-300 bg-white px-3.5 text-base outline-none transition [&::-webkit-details-marker]:hidden',
            disabled
              ? 'cursor-not-allowed bg-gray-50 text-gray-400'
              : 'cursor-pointer text-gray-800 hover:border-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 group-open:border-brand-500 group-open:ring-2 group-open:ring-brand-100',
          )}
        >
          <span className={value ? 'text-gray-800' : 'text-gray-400'}>{value || placeholder}</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0 text-gray-500 transition group-open:rotate-180">
            <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div
          role="listbox"
          aria-labelledby={labelId}
          onKeyDown={moveOptionFocus}
          className="absolute z-30 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-[var(--shadow-theme-md)]"
        >
          {[placeholder, ...options].map((item, index) => {
            const optionValue = index === 0 ? '' : item;
            const selected = optionValue === value;
            return (
              <button
                key={optionValue || 'placeholder'}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => select(optionValue)}
                className={cx(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[15px] font-semibold outline-none transition focus:ring-2 focus:ring-inset focus:ring-brand-300',
                  selected ? 'bg-brand-25 text-brand-700' : 'text-gray-700 hover:bg-gray-50',
                )}
              >
                <span>{item}</span>
                {selected && <span aria-hidden="true" className="text-brand-600">✓</span>}
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function SummaryValue({ value }: { value: string }) {
  const empty = !value;
  return (
    <div className={cx('min-w-0 break-words text-[14.5px] font-semibold', empty ? 'text-gray-300' : 'text-gray-700')}>
      {empty ? 'ยังไม่กรอก' : value}
    </div>
  );
}

function LineOaCard({ lineLink, enabled }: { lineLink?: EmployeeLineLinkPackage | null; enabled: boolean }) {
  return (
    <div className="rounded-[14px] border border-brand-100 bg-[#F5FBF6] p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-[#06C755] text-[12.5px] font-extrabold text-white">L</span>
        <span className="text-[15px] font-extrabold text-gray-800">เชื่อม LINE OA</span>
      </div>
      <div className="mb-3 text-[13px] font-medium leading-6 text-gray-400">
        {enabled ? 'ให้พนักงานสแกน QR / กดลิงก์ เพื่อผูก LINE เข้าระบบ' : 'กด “เสร็จสิ้น” เพื่อเปิดใช้งานพนักงานก่อน แล้วจึงสแกน QR'}
      </div>
      {!enabled ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700">
          LINE จะพร้อมเชื่อมหลังเปิดใช้งานพนักงาน
        </div>
      ) : lineLink ? (
        <QrLinkCard linkUrl={lineLink.linkUrl} qrImageUrl={lineLink.qrImageUrl} expiresAt={lineLink.expiresAt} />
      ) : (
        <div className="text-sm text-gray-400">ไม่สามารถออกลิงก์เชื่อม LINE ได้ในขณะนี้</div>
      )}
    </div>
  );
}

const ROLE_COLOR_BY_KEY: Record<string, string> = {
  OWNER: '#16A34A', ADMIN: '#0BA5EC', MANAGER: '#2E90FA', SALES: '#F79009',
  INVENTORY: '#7A5AF8', FINANCE: '#DD2590', ACCOUNTANT: '#12B76A', MARKETING: '#F63D68', STAFF: '#667085',
  AUDITOR_READONLY: '#06AED4',
};
function colorForRole(role?: RoleSummary): string {
  if (!role) return '#667085';
  return ROLE_COLOR_BY_KEY[role.key] ?? '#7A5AF8';
}

export function AddEmployeePrototypePage({ companyId, editEmployeeId, viewerUserId }: { companyId: string; editEmployeeId?: string; viewerUserId?: string }) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const toast = useToast();
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  const [addressOptions, setAddressOptions] = useState<ThaiAddressOption[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressLookupMessage, setAddressLookupMessage] = useState('');
  const [roleId, setRoleId] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [defaultBranchId, setDefaultBranchId] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CreateEmployeeResult | null>(null);
  const [editLineLink, setEditLineLink] = useState<EmployeeLineLinkPackage | null>(null);
  const [confirmExistingUser, setConfirmExistingUser] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeSummary | null>(null);
  const [draftActivated, setDraftActivated] = useState(false);
  const [error, setError] = useState('');
  const isEditing = Boolean(editEmployeeId);
  const employeeActive = draftActivated || editingEmployee?.status === 'ACTIVE';

  useEffect(() => {
    setLoading(true);
    void (async () => {
      const [rolesResult, branchesResult, employeeResult] = await Promise.allSettled([
        listRoles(companyId),
        listCompanyBranches(companyId),
        editEmployeeId ? getEmployee(companyId, editEmployeeId) : Promise.resolve(null),
      ]);
      if (rolesResult.status === 'fulfilled') {
        const currentRoleId = employeeResult.status === 'fulfilled' ? employeeResult.value?.roles[0]?.id : undefined;
        const assignable = assignableRoleOptions(rolesResult.value, currentRoleId);
        setRoles(assignable);
        setRoleId((current) => current || assignable[0]?.id || '');
      } else {
        setLoadError(localizedErrorMessage(rolesResult.reason, locale, { fallback: 'error.load_failed' }));
      }
      if (branchesResult.status === 'fulfilled') {
        setBranches(branchesResult.value);
        setBranchIds((current) => (current.length ? current : branchesResult.value[0] ? [branchesResult.value[0].id] : []));
        setDefaultBranchId((current) => current || branchesResult.value[0]?.id || '');
      }
      if (employeeResult.status === 'fulfilled' && employeeResult.value) {
        const employee = employeeResult.value;
        const fallbackName = employeeNameWithoutTitle(employee).split(/\s+/);
        setEditingEmployee(employee);
        setTitle(employeeTitle(employee));
        setFirstName(employee.firstName ?? fallbackName[0] ?? '');
        setLastName(employee.lastName ?? fallbackName.slice(1).join(' '));
        setNickname(employee.nickname ?? '');
        setDob(isoToDob(employee.dateOfBirth));
        setEmail(employee.email ?? '');
        setPhone(employee.phoneNumber);
        setPostalCode(employee.postalCode ?? '');
        setProvince(employee.province ?? '');
        setAmphoe(employee.district ?? '');
        setTambon(employee.subdistrict ?? '');
        setAddressLine(employee.addressLine ?? '');
        setRoleId(employee.roles[0]?.id ?? '');
        if (branchesResult.status === 'fulfilled') {
          const selectedBranchIds = employee.branchScopeMode === 'ALL_BRANCHES'
            ? branchesResult.value.map((branch) => branch.id)
            : employee.branchScopeBranchIds;
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
  }, [companyId, editEmployeeId]);

  useEffect(() => {
    let cancelled = false;
    if (postal.length < 3) {
      setAddressOptions([]);
      setAddressLoading(false);
      setAddressLookupMessage('');
      return;
    }

    setAddressLoading(true);
    setAddressLookupMessage('');
    const timer = window.setTimeout(() => {
      void listThaiAddresses(companyId, postal).then((rows) => {
        if (cancelled) return;
        setAddressOptions(rows);
        if (!rows.length) {
          setAddressLookupMessage('ไม่พบข้อมูลใน master กรุณากรอกที่อยู่เอง');
          return;
        }

        const provinceOptions = unique(rows.map((row) => row.provinceTh));
        const nextProvince = province || (provinceOptions.length === 1 ? provinceOptions[0]! : '');
        const districtOptions = unique(rows.filter((row) => row.provinceTh === nextProvince).map((row) => row.districtTh));
        const nextDistrict = amphoe || (districtOptions.length === 1 ? districtOptions[0]! : '');
        const subdistrictOptions = rows
          .filter((row) => row.provinceTh === nextProvince && row.districtTh === nextDistrict)
          .map((row) => row.subdistrictTh);
        setProvince(nextProvince);
        setAmphoe(nextDistrict);
        setTambon((current) => current || (subdistrictOptions.length === 1 ? subdistrictOptions[0]! : ''));
      })
      .catch(() => {
        if (!cancelled) {
          setAddressOptions([]);
          setAddressLookupMessage('โหลด master data ไม่สำเร็จ กรุณากรอกที่อยู่เอง');
        }
      })
        .finally(() => { if (!cancelled) setAddressLoading(false); });
    }, 300);

    return () => { cancelled = true; window.clearTimeout(timer); };
    // Fetch only when the postal code changes; current saved selections are reconciled in the response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, postal]);

  const selectedRole = roles.find((r) => r.id === roleId);
  // The API always rejects a self role change, so editing yourself shows the role read-only and the
  // unchanged roleIds save as a no-op (spec R4).
  const editingSelf = isSelfEmployee(editingEmployee, viewerUserId);
  // R8: an oversight role (ADMIN, FINANCE, ACCOUNTANT, ...) must hold every branch, and the server
  // rejects anything narrower — so the picker must not offer the choice.
  const branchPickerLocked = Boolean(selectedRole && ALL_BRANCH_ROLE_KEYS.includes(selectedRole.key));

  useEffect(() => {
    if (!branchPickerLocked || branches.length === 0) return;
    setBranchIds(branches.map((branch) => branch.id));
    setDefaultBranchId((current) => current || branches[0]!.id);
  }, [branchPickerLocked, branches]);

  const provinces = unique([...addressOptions.map((row) => row.provinceTh), ...(province ? [province] : [])]);
  const districts = unique([
    ...addressOptions.filter((row) => row.provinceTh === province).map((row) => row.districtTh),
    ...(amphoe ? [amphoe] : []),
  ]);
  const subdistricts = unique([
    ...addressOptions
      .filter((row) => row.provinceTh === province && row.districtTh === amphoe)
      .map((row) => row.subdistrictTh),
    ...(tambon ? [tambon] : []),
  ]);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const avatarInitial = fullName ? `${firstName.trim()[0] ?? ''}${lastName.trim()[0] ?? ''}` : '?';
  // Preview only. Naming it `displayName` is what made the title look like part of the stored name;
  // what gets stored is `fullName` plus `titlePrefix`, kept apart.
  const previewName = fullName ? `${title}${fullName}` : 'พนักงานใหม่';
  const defaultBranchName = branches.find((branch) => branch.id === defaultBranchId)?.name ?? '';

  const summaryRows = [
    { label: 'อีเมล', value: email.trim() },
    { label: 'เบอร์โทร', value: phone.trim() },
    { label: 'สาขาหลัก', value: defaultBranchName },
    { label: 'ตำแหน่ง', value: selectedRole?.name ?? '' },
  ];

  function setPostal(value: string) {
    const code = digits(value, 5);
    setPostalCode(code);
    setProvince('');
    setAmphoe('');
    setTambon('');
  }

  function validate(targetStep: AddStep) {
    if (targetStep === 1) {
      if (!firstName.trim()) return 'กรุณากรอกชื่อ';
      if (!lastName.trim()) return 'กรุณากรอกนามสกุล';
      if (!editingEmployee && !dob) return 'กรุณากรอกวันเดือนปีเกิด';
      if (dob && !employeeDateToIso(dob)) return 'กรุณากรอกวันเกิดจริง รูปแบบ DD/MM/YYYY และใช้ปี ค.ศ.';
      if (!editingEmployee && !/^[a-zA-Z0-9._-]+$/.test(username.trim())) return 'Username ใช้ได้เฉพาะ a-z, A-Z, 0-9, จุด, ขีดกลาง และขีดล่าง';
      if ((!editingEmployee || idCard) && !/^[0-9]{13}$/.test(idCard)) return 'เลขบัตรประชาชนต้องมี 13 หลัก';
    }
    if (targetStep === 2) {
      if (!/^[^@\s]+@[^@\s]+$/.test(email.trim())) return 'อีเมลไม่ถูกต้อง';
      if (!/^0[0-9]{9}$/.test(phone)) return 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก (ขึ้นต้นด้วย 0)';
    }
    if (targetStep === 3) {
      if (!roleId) return 'เลือกตำแหน่ง';
      if (branchIds.length === 0) return 'เลือกอย่างน้อย 1 สาขา';
      if (!defaultBranchId || !branchIds.includes(defaultBranchId)) return 'เลือกสาขาหลัก';
    }
    return '';
  }

  async function goToStep(target: AddStep) {
    if (target <= step) {
      setStep(target);
      setError('');
      return;
    }
    for (let candidate = step; candidate < target; candidate += 1) {
      const validationError = validate(candidate as AddStep);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    if (target === 4) {
      const saved = await submitDraft();
      if (!saved) return;
    }
    setStep(target);
    setError('');
  }

  async function submitDraft(linkExistingUser = false): Promise<boolean> {
    setSaving(true);
    setError('');
    try {
      const profile = {
        // The stored name is the name alone; the title goes in its own field so nothing downstream
        // has to guess it back out of a concatenated string.
        displayName: fullName || previewName,
        titlePrefix: title,
        phoneNumber: phone,
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        nickname: nickname.trim() || (editingEmployee ? null : undefined),
        dateOfBirth: employeeDateToIso(dob) ?? (editingEmployee ? null : undefined),
        addressLine: addressLine.trim() || (editingEmployee ? null : undefined),
        postalCode: postal || (editingEmployee ? null : undefined),
        province: province.trim() || (editingEmployee ? null : undefined),
        district: amphoe.trim() || (editingEmployee ? null : undefined),
        subdistrict: tambon.trim() || (editingEmployee ? null : undefined),
        roleIds: [roleId],
      };
      const branchScope = {
        branchScopeMode: branchIds.length === branches.length ? 'ALL_BRANCHES' : 'SELECTED_BRANCHES',
        branchIds: branchIds.length === branches.length ? [] : branchIds,
        defaultBranchId,
      };
      if (editingEmployee) {
        const updated = await updateEmployee(companyId, editingEmployee.id, {
          ...profile,
          ...branchScope,
          ...(idCard && { identityType: editingEmployee.identityType, identityNumber: idCard }),
        });
        setEditingEmployee(updated);
        // ponytail: fresh QR each save-to-step-4; backend keeps a single pending token per employee
        setEditLineLink(await issueEmployeeLineLinkToken(companyId, updated.id).catch(() => null));
        return true;
      }
      const created = await createEmployee(companyId, {
        ...profile,
        username: username.trim(),
        identityType: 'THAI_NATIONAL_ID',
        identityNumber: idCard,
        ...(linkExistingUser && { linkExistingUser: true }),
      });
      await updateEmployee(companyId, created.employeeId, {
        ...branchScope,
      });
      setResult(created);
      setConfirmExistingUser(false);
      return true;
    } catch (e) {
      // The username belongs to an existing account (e.g. an owner of another company): offer to
      // attach them here with their existing login instead of surfacing a hard conflict error.
      if ((e as { code?: string })?.code === 'employee_existing_user') {
        setConfirmExistingUser(true);
        setError('');
        return false;
      }
      setError(localizedErrorMessage(e, locale, { fallback: 'error.save_failed', conflictCodes: EMPLOYEE_CONFLICT_KEYS }));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function confirmLinkExistingUser() {
    const saved = await submitDraft(true);
    if (saved) {
      setStep(4);
      setError('');
    }
  }

  function nextStep() {
    const validationError = validate(step);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (step < 3) {
      setStep((step + 1) as AddStep);
      setError('');
      return;
    }
    if (step === 3) {
      void goToStep(4);
      return;
    }
    void finishEmployee();
  }

  async function finishEmployee() {
    if (employeeActive) {
      router.push(`/companies/${companyId}/settings/access-overview`);
      // The shell name comes from the server layout's session, and a shared layout survives client
      // navigation — without this a self-rename stays stale in the sidebar until a full reload.
      router.refresh();
      return;
    }
    const employeeId = editingEmployee?.id ?? result?.employeeId;
    if (!employeeId) return;
    setSaving(true);
    setError('');
    try {
      await completeEmployee(companyId, employeeId);
      setDraftActivated(true);
      toast.success('เปิดใช้งานพนักงานเรียบร้อยแล้ว');
    } catch (e) {
      setError(localizedErrorMessage(e, locale, { fallback: 'error.save_failed' }));
    } finally {
      setSaving(false);
    }
  }

  function toggleBranch(branchId: string) {
    const selected = branchIds.includes(branchId);
    if (selected && branchIds.length === 1) return;
    const next = selected ? branchIds.filter((id) => id !== branchId) : [...branchIds, branchId];
    setBranchIds(next);
    if (!next.includes(defaultBranchId)) setDefaultBranchId(next[0] ?? '');
    setError('');
  }

  function toggleAllBranches() {
    const allIds = branches.map((b) => b.id);
    const allSelected = allIds.every((id) => branchIds.includes(id));
    const next = allSelected ? (branches[0] ? [branches[0].id] : []) : allIds;
    setBranchIds(next);
    if (!next.includes(defaultBranchId)) setDefaultBranchId(next[0] ?? '');
    setError('');
  }

  const nextLabel = step < 3
    ? 'ถัดไป ›'
    : step === 3
      ? (saving ? 'กำลังบันทึก...' : editingEmployee?.status === 'ACTIVE' ? 'บันทึกการแก้ไข' : 'บันทึกแบบร่าง')
      : (saving ? 'กำลังเปิดใช้งาน...' : employeeActive ? 'ไปหน้าภาพรวมสิทธิ์' : 'เสร็จสิ้น');

  return (
    <div className="mangmee-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <nav className="text-sm font-semibold text-gray-500">
            มั่งมี <span className="mx-2 text-gray-300">/</span> <span className="text-gray-700">{isEditing ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน'}</span>
          </nav>
          <h1 className="mt-8 text-[30px] font-extrabold leading-tight text-gray-900">{isEditing ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน'}</h1>
          <p className="mt-3 text-base font-semibold text-gray-500">
            {isEditing ? 'แก้ไขข้อมูลพนักงาน ตำแหน่ง และสาขาที่สังกัดทีละขั้น' : 'สร้างบัญชีพนักงานใหม่ กำหนดตำแหน่งและสาขาที่สังกัด · เจ้าของร้านสร้างได้เท่านั้น'}
          </p>
        </div>
        <MangmeeBranchChip label={t('branch.scope.company_wide', locale)} />
      </div>

      {loadError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>}

      <div className="grid gap-5">
        <MangmeeCard className="flex flex-wrap items-center gap-[18px] p-4 sm:p-[18px_22px]">
          <div className="flex min-w-0 shrink-0 items-center gap-3.5">
            <div className="flex h-[52px] w-[52px] items-center justify-center rounded-xl text-[17px] font-extrabold text-white" style={{ backgroundColor: colorForRole(selectedRole) }}>
              {avatarInitial}
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-extrabold text-gray-900">{previewName}</div>
              {selectedRole && (
                <span className="mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: `${colorForRole(selectedRole)}1F`, color: colorForRole(selectedRole) }}>
                  {selectedRole.name}
                </span>
              )}
            </div>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-2.5 md:grid-cols-4">
            {summaryRows.map((row) => (
              <div key={row.label} className="min-w-0">
                <div className="text-sm text-gray-400">{row.label}</div>
                <SummaryValue value={row.value} />
              </div>
            ))}
          </div>
        </MangmeeCard>

        <MangmeeCard className="p-5 sm:p-[26px]">
          <div className="text-[19px] font-extrabold text-gray-900">{isEditing ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มพนักงานใหม่'}</div>
          <div className="mt-1 text-[15px] font-medium text-gray-500">{isEditing ? 'แก้ไขข้อมูลทีละขั้น · พนักงาน Draft จะยังใช้งานไม่ได้จนกด “เสร็จสิ้น”' : 'สร้างบัญชีผู้ใช้ทีละขั้น · ระบบเก็บเป็นแบบร่างจนกด “เสร็จสิ้น”'}</div>

          <ThemedSteps
            className="mb-[22px] mt-[22px]"
            aria-label="ขั้นตอนการเพิ่มพนักงาน"
            steps={STEP_DEFS.map((definition) => ({
              key: String(definition.n),
              label: definition.label,
              state: definition.n === step ? 'current' : definition.n < step ? 'done' : 'upcoming',
              onSelect: () => void goToStep(definition.n),
            }))}
          />

          {step === 1 && (loading ? <LoadingState label="กำลังโหลด..." /> : (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[200px_1fr_1fr]">
                <div>
                  <div className="mb-1.5 text-[15px] font-semibold text-gray-700">คำนำหน้า <span className="text-error-500">*</span></div>
                  <div className="flex gap-1.5 rounded-[10px] bg-gray-100 p-1">
                    {(['นาย', 'นาง', 'นางสาว'] as TitleOption[]).map((item) => (
                      <button key={item} type="button" onClick={() => { setTitle(item); setError(''); }} className={cx('h-11 flex-1 rounded-md text-sm font-extrabold transition sm:h-9', title === item ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600')}>
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
                <TextField label="ชื่อ" required value={firstName} onChange={(event) => { setFirstName(event.target.value); setError(''); }} placeholder="เช่น มีนา" />
                <TextField label="นามสกุล" required value={lastName} onChange={(event) => { setLastName(event.target.value); setError(''); }} placeholder="เช่น ใจงาม" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="ชื่อเล่น" optional="(ใช้แสดงในหน้าจองคิวและสิทธิ์รายบุคคล)" value={nickname} onChange={(event) => { setNickname(event.target.value); setError(''); }} placeholder="เช่น มีน" />
                {!editingEmployee && <TextField label="Username" required value={username} onChange={(event) => { setUsername(event.target.value); setError(''); setConfirmExistingUser(false); }} placeholder="เช่น somchai.j" />}
                <TextField label="วันเดือนปีเกิด (ค.ศ.)" required={!editingEmployee} optional={editingEmployee ? '(ถ้ามี)' : undefined} value={dob} onChange={(event) => { setDob(formatEmployeeDateInput(event.target.value)); setError(''); }} inputMode="numeric" placeholder="DD/MM/YYYY เช่น 28/09/1998" maxLength={10} />
                <TextField
                  label="เลขบัตรประชาชน"
                  required={!editingEmployee}
                  optional={editingEmployee ? `(เดิม ${editingEmployee.identityMasked} · กรอกเมื่อต้องการเปลี่ยน)` : undefined}
                  value={idCard}
                  onChange={(event) => { setIdCard(digits(event.target.value, 13)); setError(''); }}
                  inputMode="numeric"
                  placeholder={editingEmployee ? 'กรอกเลข 13 หลักใหม่' : 'เลข 13 หลัก'}
                  inputClassName="tracking-[.04em]"
                />
              </div>
            </div>
          ))}

          {step === 2 && (
            <div>
              <div className="mb-3 text-[13px] font-extrabold tracking-[.04em] text-brand-600">1 · ช่องทางติดต่อ</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="อีเมล (ใช้เข้าสู่ระบบ)" required value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} placeholder="name@room45.co" />
                <TextField label="เบอร์โทรศัพท์" required value={phone} onChange={(event) => { setPhone(digits(event.target.value, 10)); setError(''); }} inputMode="tel" maxLength={10} placeholder="08xxxxxxxx (10 หลัก)" inputClassName="tracking-[.04em]" />
              </div>

              <div className="mb-3 mt-6 border-t border-gray-100 pt-5 text-[13px] font-extrabold tracking-[.04em] text-brand-600">2 · ที่อยู่ <span className="font-normal normal-case text-gray-400">(ถ้ามี)</span></div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <TextField label="รหัสไปรษณีย์" value={postal} onChange={(event) => setPostal(event.target.value)} inputMode="numeric" maxLength={5} placeholder="เช่น 10330" inputClassName="tracking-[.08em]" />
                {addressOptions.length ? (
                  <SelectField label="จังหวัด" value={province} options={provinces} placeholder="— เลือกจังหวัด —" onChange={(value) => { setProvince(value); setAmphoe(''); setTambon(''); }} />
                ) : (
                  <TextField label="จังหวัด" value={province} onChange={(event) => setProvince(event.target.value)} placeholder="กรอกจังหวัด" />
                )}
                {addressOptions.length ? (
                  <SelectField label="อำเภอ/เขต" value={amphoe} options={districts} placeholder="— เลือกอำเภอ/เขต —" disabled={!province} onChange={(value) => { setAmphoe(value); setTambon(''); }} />
                ) : (
                  <TextField label="อำเภอ/เขต" value={amphoe} onChange={(event) => setAmphoe(event.target.value)} placeholder="กรอกอำเภอ/เขต" />
                )}
                {addressOptions.length ? (
                  <SelectField label="ตำบล/แขวง" value={tambon} options={subdistricts} placeholder="— เลือกตำบล/แขวง —" onChange={setTambon} />
                ) : (
                  <TextField label="ตำบล/แขวง" value={tambon} onChange={(event) => setTambon(event.target.value)} placeholder="กรอกตำบล/แขวง" />
                )}
                <TextField className="sm:col-span-2 xl:col-span-3" label="บ้านเลขที่ / หมู่ / ถนน" value={addressLine} onChange={(event) => setAddressLine(event.target.value)} placeholder="เช่น 45/1 ซอยสุขุมวิท ถนนสุขุมวิท" />
              </div>
              {(addressLoading || addressLookupMessage) && (
                <div className={cx('mt-2 text-sm', addressLookupMessage ? 'text-warning-600' : 'text-gray-400')}>
                  {addressLoading ? 'กำลังค้นหา master data ที่อยู่...' : addressLookupMessage}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="mb-2 text-[15px] font-semibold text-gray-700">ตำแหน่ง (1 คน มีได้ 1 ตำแหน่ง)</div>
              {editingSelf ? (
                <>
                  <span className="inline-flex rounded-[9px] border border-gray-200 bg-gray-50 px-3.5 py-2 text-[14.5px] font-extrabold text-gray-500">
                    {selectedRole?.name ?? '—'}
                  </span>
                  <div className="mt-2 text-sm font-medium text-gray-400">ตำแหน่งของตัวเองต้องให้ผู้ดูแลคนอื่นเปลี่ยนให้</div>
                </>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  {roles.map((item) => (
                    <button key={item.id} type="button" onClick={() => { setRoleId(item.id); setError(''); }} className={cx('rounded-[9px] border px-3.5 py-2 text-[14.5px] font-extrabold transition', roleId === item.id ? 'border-brand-300 bg-brand-25 text-brand-600' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200')}>
                      {item.name}
                    </button>
                  ))}
                  {roles.length === 0 && <span className="text-sm text-gray-400">ยังไม่มีบทบาทให้เลือก</span>}
                </div>
              )}

              <div className="mb-2 mt-[18px] text-[15px] font-semibold text-gray-700">
                สาขาที่สังกัด <span className="font-normal text-gray-400">(เลือกได้มากกว่า 1 สาขา)</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={toggleAllBranches} disabled={branchPickerLocked} className={cx('inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[14.5px] font-extrabold transition', branchIds.length === branches.length && branches.length > 0 ? 'border-brand-300 bg-brand-25 text-brand-600' : 'border-gray-200 bg-white text-gray-500', branchPickerLocked && 'cursor-default')}>
                  <span>{branchIds.length === branches.length && branches.length > 0 ? '✓' : '+'}</span>
                  ทุกสาขา
                </button>
                {branches.map((branch) => {
                  const selected = branchIds.includes(branch.id);
                  const last = selected && branchIds.length === 1;
                  return (
                    <button key={branch.id} type="button" onClick={() => toggleBranch(branch.id)} disabled={last || branchPickerLocked} className={cx('inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[14.5px] font-extrabold transition', selected ? 'border-brand-300 bg-brand-25 text-brand-600' : 'border-gray-200 bg-white text-gray-500 hover:border-brand-200', last || branchPickerLocked ? 'cursor-default' : 'cursor-pointer')}>
                      <span className={selected ? 'text-brand-500' : 'text-gray-300'}>{selected ? '✓' : '+'}</span>
                      {branch.name}
                    </button>
                  );
                })}
              </div>
              {branchPickerLocked && (
                <div className="mt-2 text-sm font-medium text-gray-400">
                  ตำแหน่ง{selectedRole?.name ?? ''} ดูแลภาพรวมทั้งบริษัท จึงต้องเห็นข้อมูลทุกสาขา — จำกัดสาขาไม่ได้
                </div>
              )}
              <label className="mt-4 block max-w-md">
                <span className="mb-1.5 block text-[15px] font-semibold text-gray-700">
                  สาขาหลัก (Default Branch) <span className="text-error-500">*</span>
                </span>
                <ThemedSelect
                  value={defaultBranchId}
                  onChange={(event) => { setDefaultBranchId(event.target.value); setError(''); }}
                  className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3.5 text-base text-gray-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  {branches.filter((branch) => branchIds.includes(branch.id)).map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </ThemedSelect>
                <span className="mt-1.5 block text-sm font-medium text-gray-400">
                  ระบบใช้สาขานี้เป็นค่าเริ่มต้นสำหรับการจองและรายการใหม่ของพนักงาน
                </span>
              </label>
            </div>
          )}

          {step === 4 && (result || editingEmployee) && (
            <div>
              <div className={cx(
                'mb-4 rounded-[10px] border px-4 py-3 text-sm font-semibold',
                employeeActive ? 'border-brand-100 bg-brand-25 text-brand-700' : 'border-amber-200 bg-amber-50 text-amber-800',
              )}>
                {employeeActive
                  ? 'เปิดใช้งานพนักงานแล้ว สามารถส่งข้อมูลเข้าใช้งานและสแกน QR เชื่อม LINE ได้'
                  : 'ข้อมูลนี้ยังเป็นแบบร่าง พนักงานจะเข้าใช้งานเว็บและเชื่อม LINE ได้หลังจากกด “เสร็จสิ้น”'}
              </div>
              {result ? <><div className="grid items-stretch gap-4 sm:grid-cols-2">
                <div className="flex flex-col rounded-[14px] border border-gray-200 p-4">
                  <div className="text-[15px] font-extrabold text-gray-800">บัญชีเข้าระบบเว็บ</div>
                  <div className="mb-2.5 mt-0.5 text-[13px] font-medium text-gray-400">ใช้เข้าหน้าเว็บแอดมิน มั่งมี</div>
                  <div className="text-sm font-semibold text-gray-700">Username</div>
                  <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[15px] font-extrabold text-gray-800">{result.username}</div>
                  {result.reusedExistingAccount ? (
                    <>
                      <div className="mt-3 rounded-lg border border-brand-100 bg-[#F5FBF6] px-3 py-2.5 text-[13px] font-semibold leading-6 text-gray-600">ผู้ใช้นี้มีบัญชีในระบบอยู่แล้ว — เข้าใช้งานบริษัทนี้ด้วยรหัสผ่านเดิม ไม่มีการตั้งรหัสผ่านใหม่</div>
                      <div className="mt-auto pt-3 text-[12.5px] font-medium leading-6 text-gray-400">หลังเปิดใช้งาน บริษัทนี้จะปรากฏในบัญชีเดิมของพนักงานเมื่อเข้าระบบครั้งถัดไป</div>
                    </>
                  ) : (
                    <>
                      <div className="mb-1.5 mt-3 text-sm font-semibold text-gray-700">รหัสผ่าน</div>
                      <div className="flex h-[42px] items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 py-0 pl-3 pr-1.5">
                        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-extrabold tracking-[.06em] text-gray-800">{result.temporaryPassword}</span>
                        <button type="button" onClick={() => void navigator.clipboard?.writeText(result.temporaryPassword)} className="shrink-0 px-1.5 text-[13px] font-extrabold text-brand-600">คัดลอก</button>
                      </div>
                      <div className="mt-auto pt-3 text-[12.5px] font-medium leading-6 text-gray-400">ใช้วันเดือนปีเกิดรูปแบบ DDMMYYYY · ระบบจะให้พนักงานตั้งรหัสผ่านใหม่เมื่อเข้าใช้งานครั้งแรก</div>
                    </>
                  )}
                </div>

                <LineOaCard lineLink={result.lineLink} enabled={employeeActive} />
              </div>

              <div className="mt-[18px] flex flex-wrap items-center gap-4 rounded-[14px] border border-gray-200 bg-gray-50 px-[22px] py-5">
                <div className="min-w-[180px] flex-1">
                  <div className="text-base font-extrabold text-gray-900">ส่งข้อมูลเข้าใช้งานให้พนักงาน</div>
                  <div className="mt-0.5 text-[13px] font-medium text-gray-600">{result.reusedExistingAccount ? 'แจ้งพนักงานว่าเข้าใช้งานบริษัทนี้ได้ด้วยบัญชีเดิมที่มีอยู่แล้ว — ไม่ต้องส่งรหัสผ่านใหม่' : 'ต้องตั้งค่าอีเมล (SMTP) ของบริษัทก่อนจึงจะส่งอัตโนมัติได้ — ตอนนี้กรุณาส่ง Username/รหัสผ่านด้านบนให้พนักงานเอง'}</div>
                </div>
              </div>
              </> : (
                <div className="grid items-stretch gap-4 sm:grid-cols-2">
                  <div className="flex flex-col items-center justify-center rounded-[14px] border border-brand-100 bg-brand-25 px-5 py-6 text-center">
                    <div className="text-lg font-extrabold text-gray-900">ตรวจสอบและบันทึกข้อมูลครบแล้ว</div>
                    <div className="mt-2 text-sm font-semibold text-gray-500">{employeeActive ? 'เชื่อม LINE ได้แล้ว หรือไปหน้าภาพรวมสิทธิ์เพื่อจัดการต่อ' : 'กด “เสร็จสิ้น” เพื่อเปิดใช้งานพนักงาน'}</div>
                  </div>
                  <LineOaCard lineLink={editLineLink} enabled={employeeActive} />
                </div>
              )}
            </div>
          )}

          {confirmExistingUser && (
            <div className="mt-4 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <div className="font-extrabold">Username นี้มีบัญชีในระบบอยู่แล้ว</div>
              <div className="mt-1 font-medium leading-6">หากเป็นคนเดียวกัน (เช่น เจ้าของอีกบริษัท) กด “ยืนยันเพิ่มเข้าบริษัท” เพื่อเพิ่มเข้าบริษัทนี้โดยใช้บัญชีเดิม — พนักงานจะเข้าระบบด้วยรหัสผ่านเดิม ไม่มีการตั้งรหัสใหม่ · <b>ต้องกรอกอีเมล (ขั้นตอนช่องทางติดต่อ) ที่ไม่ซ้ำกับอีเมลบัญชีเดิม</b> · หากเป็นคนละคน กรุณาแก้ไข Username ให้ไม่ซ้ำ</div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={() => void confirmLinkExistingUser()} disabled={saving} className="flex h-10 items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-extrabold text-white hover:bg-brand-600 disabled:opacity-60">ยืนยันเพิ่มเข้าบริษัท</button>
                <button type="button" onClick={() => { setConfirmExistingUser(false); setStep(1); }} className="flex h-10 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-extrabold text-gray-600 hover:bg-gray-50">แก้ไข Username</button>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-[9px] border border-[#FECDCA] bg-error-50 px-3.5 py-2.5 text-sm font-semibold text-error-700">
              ⚠ {error}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2.5 border-t border-gray-100 pt-[18px]">
            <button type="button" onClick={() => { if (step > 1) { setStep((step - 1) as AddStep); setError(''); } }} disabled={step <= 1} className={cx('flex h-11 shrink-0 items-center justify-center rounded-lg px-3.5 text-base font-extrabold sm:px-[18px]', step <= 1 ? 'cursor-default text-gray-300' : 'border border-gray-300 text-gray-600 hover:bg-gray-50')}>
              ‹ ย้อนกลับ
            </button>
            <div className="hidden text-[15px] font-semibold text-gray-400 sm:block">ขั้นที่ {step} จาก 4</div>
            <button type="button" onClick={nextStep} disabled={saving} className="flex h-[46px] shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-500 px-5 text-base font-extrabold text-white shadow-sm hover:bg-brand-600 disabled:opacity-60 sm:px-[26px]">
              {nextLabel}
            </button>
          </div>
        </MangmeeCard>
      </div>
    </div>
  );
}
