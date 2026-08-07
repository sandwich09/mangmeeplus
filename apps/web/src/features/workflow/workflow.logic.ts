// Pure client-side helpers for the workflow console (mirror server rules for UX only).
import { formatThaiDateTime as formatSharedThaiDateTime } from '@/common/i18n/thai-date';

export const WORKFLOW_TABS = ['templates', 'rules', 'runs', 'tasks', 'dead-letters', 'webhooks'] as const;
export type WorkflowTab = (typeof WORKFLOW_TABS)[number];

/**
 * Each tab is offered only when the session can run its initial list request.
 * Webhooks intentionally uses `manage`: the controller uses that key for reads too.
 */
const WORKFLOW_TAB_PERMISSIONS: Record<WorkflowTab, readonly string[]> = {
  templates: ['workflow.template.read'],
  rules: ['workflow.rule.read'],
  runs: ['workflow.run.read'],
  tasks: ['workflow.task.read'],
  'dead-letters': ['workflow.dead_letter.read'],
  webhooks: ['workflow.webhook.manage'],
};

export function visibleWorkflowTabs(permissions: readonly string[]): WorkflowTab[] {
  return WORKFLOW_TABS.filter((tab) =>
    WORKFLOW_TAB_PERMISSIONS[tab].some((key) => permissions.includes(key)),
  );
}

/** Unknown or hidden `?tab=` values fall back to the first tab this session can use. */
export function parseWorkflowTab(
  value: string | null | undefined,
  visible: readonly WorkflowTab[] = WORKFLOW_TABS,
): WorkflowTab {
  return visible.includes(value as WorkflowTab) ? (value as WorkflowTab) : (visible[0] ?? 'templates');
}

export function validateWebhookForm(input: { name: string; url: string; secretRef: string; allowedEventTypes: string }): string | null {
  if (!input.name || input.name.trim() === '') return 'กรุณาระบุชื่อ';
  if (!/^https:\/\//.test(input.url)) return 'URL ต้องเป็น https://';
  if (!input.secretRef || input.secretRef.trim() === '') return 'กรุณาระบุ signing secret';
  if (!input.allowedEventTypes || input.allowedEventTypes.trim() === '') return 'กรุณาระบุ event type ที่อนุญาตอย่างน้อย 1 รายการ';
  return null;
}

export function parseAllowedEventTypes(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function parseJsonSafely(raw: string): { value?: unknown; error?: string } {
  if (!raw || raw.trim() === '') return { error: 'กรุณาระบุ JSON' };
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { error: 'รูปแบบ JSON ไม่ถูกต้อง' };
  }
}

export function formatDateTime(iso?: string): string {
  return formatSharedThaiDateTime(iso, '-');
}
