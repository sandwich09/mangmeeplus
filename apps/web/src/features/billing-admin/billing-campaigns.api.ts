// The requests behind the promotion-campaign screens (wire shapes: the "Admin campaign API" note at the end of
// packages/contracts/src/billing.ts). Same wrapper as BillingConfigurationPage: no cache, no toast (the screen words its
// own errors), Idempotency-Key where the contract asks for one.
import type {
  BillingConfigurationOperation,
  BillingPromotionCampaignDetail,
  BillingPromotionCampaignList,
  BillingPromotionCampaignReport,
  BillingPromotionDraftInput,
  BillingPromotionPreviewInput,
  BillingPromotionPreviewResult,
  BillingPromotionStateInput,
} from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import type { CampaignOperationStep } from './billing-campaigns.logic';

const call = <T,>(path: string, body?: unknown, key?: string) => authedApiFetch<T>(`/system/billing${path}`, {
  cache: 'no-store', suppressErrorToast: true,
  ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) } }),
});
const id = encodeURIComponent;

export const listCampaigns = () => call<BillingPromotionCampaignList>('/promotion-campaigns');
export const getCampaign = (campaignId: string) => call<BillingPromotionCampaignDetail>(`/promotion-campaigns/${id(campaignId)}`);
export const getCampaignReport = (campaignId: string, cursor?: string | null) =>
  call<BillingPromotionCampaignReport>(`/promotion-campaigns/${id(campaignId)}/report${cursor ? `?cursor=${id(cursor)}` : ''}`);
/** "บันทึกร่าง": no campaignId creates the campaign; the key makes a retried create return the first result. */
export const saveCampaignDraft = (input: BillingPromotionDraftInput, key: string) => call<BillingPromotionCampaignDetail>('/promotion-campaign-drafts', input, key);
export const discardCampaignDraft = (campaignId: string, draftVersion: number) => call<BillingPromotionCampaignList>(`/promotion-campaign-drafts/${id(campaignId)}/discard`, { draftVersion });
/** "ตรวจสอบก่อนเปิด" (PUBLISH) and "กลับมาเปิด" (RESUME): both open an ordinary configuration change. */
export const previewCampaign = (campaignId: string, input: BillingPromotionPreviewInput) => call<BillingPromotionPreviewResult>(`/promotion-campaigns/${id(campaignId)}/preview`, input);
/** "พักแคมเปญ" / "จบแคมเปญ": one step, needs the password confirmation done on this session. */
export const closeCampaign = (campaignId: string, action: 'pause' | 'end', input: BillingPromotionStateInput, key: string) =>
  call<BillingPromotionCampaignDetail>(`/promotion-campaigns/${id(campaignId)}/${action}`, input, key);
export const confirmPassword = (password: string) => call<{ reauthenticatedUntil: string }>('/reauthenticate', { password });
/** "ส่งคำขอ" / "อนุมัติและเปิดใช้" / "ยกเลิกคำขอ": the existing configuration-change routes, exactly as BillingConfigurationPage calls them. */
export const stepOperation = (operation: BillingConfigurationOperation, step: CampaignOperationStep) =>
  call<BillingConfigurationOperation>(`/configuration-changes/${id(operation.id)}/${step}`,
    { expectedVersion: operation.version, ...(step === 'cancel' ? {} : { previewHash: operation.previewHash }) }, step === 'submit' ? `billing-config-${operation.id}` : undefined);
