import { authedApiFetch } from '@/common/api/authed-fetch';

export type WhtIncomeCategory = {
  code: string;
  nameTh: string;
  formType: string;
  defaultRate: string;
  status: string;
};

const ROOT = '/v1/system/wht-income-categories';
const options = { cache: 'no-store', suppressErrorToast: true } as const;

export function listWhtIncomeCategories(signal?: AbortSignal) {
  return authedApiFetch<WhtIncomeCategory[]>(ROOT, { ...options, signal });
}

export function setWhtIncomeCategoryStatus(code: string, status: 'ACTIVE' | 'DRAFT') {
  return authedApiFetch<WhtIncomeCategory>(`${ROOT}/${encodeURIComponent(code)}`, {
    ...options, method: 'PATCH', body: JSON.stringify({ status }),
  });
}
