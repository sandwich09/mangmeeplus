#!/usr/bin/env bash
# Production deploy path for ECS Express Mode.
#
# Run from repo root:
#   AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-ecs-express/deploy.sh all
#
# Targets:
#   api-web     combined API + Next.js web service
#   ai-gateway  AI Gateway service
#   workers     BullMQ workers (repeat jobs: outbox drain, scans, CRM SLA scan)
#   all         steady state: concurrent waves (uat: all three at once;
#               production: ai-gateway + workers, then api-web), then a UAT api-web
#               refresh only if the AI Gateway endpoint moved. Bootstrap and
#               workstation runs stay sequential:
#               api-web -> ai-gateway -> api-web -> workers

set -euo pipefail

TARGET="${1:-all}"
MANIFEST_INPUT="${PRODUCTION_IMAGE_MANIFEST:-}"
CRM_AI_OUTBOUND_ALLOWED_DOMAINS_INPUT="${CRM_AI_OUTBOUND_ALLOWED_DOMAINS:-}"
WORKFLOW_WEBHOOK_ALLOWED_HOSTS_INPUT="${WORKFLOW_WEBHOOK_ALLOWED_HOSTS:-}"
CLAMAV_HOST_INPUT="${CLAMAV_HOST:-}"
REIMBURSEMENT_WRITE_QUIESCE_INPUT="${REIMBURSEMENT_WRITE_QUIESCE:-false}"
REIMBURSEMENT_BRIDGE_INPUT="${REIMBURSEMENT_BRIDGE:-false}"
PARTIAL_INCIDENT_READONLY_INPUT="${PARTIAL_INCIDENT_READONLY:-false}"
MAINTENANCE_BOOTSTRAP_READONLY_INPUT="${MAINTENANCE_BOOTSTRAP_READONLY:-false}"
LINE_WEB_LOGIN_ENABLED_INPUT="${LINE_WEB_LOGIN_ENABLED:-}"
LINE_WEB_HANDOFF_ENABLED_INPUT="${LINE_WEB_HANDOFF_ENABLED:-}"
LINE_AI_EXACT_GREETING_ENABLED_INPUT="${LINE_AI_EXACT_GREETING_ENABLED:-}"
LINE_AI_ADVISOR_MODE_INPUT="${LINE_AI_ADVISOR_MODE:-}"
LINE_AI_LOADING_ON_ACCEPT_ENABLED_INPUT="${LINE_AI_LOADING_ON_ACCEPT_ENABLED:-}"
LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED_INPUT="${LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED:-false}"
LINE_AI_FUSED_PLAN_SHADOW_ENABLED_INPUT="${LINE_AI_FUSED_PLAN_SHADOW_ENABLED:-}"
LINE_AI_PREPARED_SIMPLE_READ_ENABLED_INPUT="${LINE_AI_PREPARED_SIMPLE_READ_ENABLED:-}"
LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES_INPUT="${LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES:-}"
LINE_AI_DRAFT_EDIT_ENABLED_INPUT="${LINE_AI_DRAFT_EDIT_ENABLED:-}"
AI_BUDGET_SPLIT_ACTIVATION_ENABLED_INPUT="${AI_BUDGET_SPLIT_ACTIVATION_ENABLED:-}"
# Owner 2026-09-07: activate receipt recovery and draft continuity in both environments.
LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED_INPUT="${LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED:-true}"
LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED_INPUT="${LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED:-true}"
LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED_INPUT="${LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED:-true}"
LINE_AI_FLEX_TEXT_FALLBACK_ENABLED_INPUT="${LINE_AI_FLEX_TEXT_FALLBACK_ENABLED:-true}"
LINE_AI_BUFFER_DEBOUNCE_MS_INPUT="${LINE_AI_BUFFER_DEBOUNCE_MS:-}"
EXTERNAL_SIGNUP_ENABLED_INPUT="${EXTERNAL_SIGNUP_ENABLED:-}"
# Owner 2026-09-06: signup, auto approval and quota default to the UAT values in both environments.
LINE_SIGNUP_ENABLED_INPUT="${LINE_SIGNUP_ENABLED:-}"
LINE_SIGNUP_APPROVAL_MODE_INPUT="${LINE_SIGNUP_APPROVAL_MODE:-}"
LINE_SIGNUP_AUTO_DAILY_CAP_INPUT="${LINE_SIGNUP_AUTO_DAILY_CAP:-20}"
LINE_SIGNUP_WARMUP_SLIPS_INPUT="${LINE_SIGNUP_WARMUP_SLIPS:-15}"
LINE_FREE_AI_BUDGET_SATANG_INPUT="${LINE_FREE_AI_BUDGET_SATANG:-8000}"
LINE_SIGNUP_ADMIN_REMINDER_MINUTES_INPUT="${LINE_SIGNUP_ADMIN_REMINDER_MINUTES:-60}"
# §15.6: how many trial shops must exhaust their AI budget in one Bangkok day before ops is told.
# Same value in both environments — it is an ops threshold, not a customer-facing switch.
LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY_INPUT="${LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY:-5}"
LINE_SIGNUP_BUSINESS_DAYS_INPUT="${LINE_SIGNUP_BUSINESS_DAYS:-MON-SAT}"
LINE_SIGNUP_BUSINESS_HOURS_INPUT="${LINE_SIGNUP_BUSINESS_HOURS:-09:00-18:00}"
RECEIPT_QUOTA_ENFORCED_INPUT="${RECEIPT_QUOTA_ENFORCED:-}"
EMAIL_PROVIDER_INPUT="${EMAIL_PROVIDER:-}"
SES_REGION_INPUT="${SES_REGION:-ap-southeast-1}"
SES_FROM_ADDRESS_INPUT="${SES_FROM_ADDRESS:-contact@mangmeeplus.com}"
PRODUCTION_SERVING_MODE_INPUT="${PRODUCTION_SERVING_MODE:-}"
RELEASE_MODE_INPUT="${RELEASE_MODE:-}"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-14}"
LOG_KMS_KEY_ID="${LOG_KMS_KEY_ID:-}"
SECURITY_ALERT_TOPIC_ARN="${SECURITY_ALERT_TOPIC_ARN:-}"
REGION="${AWS_REGION:-ap-southeast-1}"
DEPLOY_ENV="${DEPLOY_ENV:-production}"
# UAT gets parked at zero between test cycles. Every update payload used to hardcode 1/2, so the
# next deploy restarted it — and its Fargate bill — without anyone asking. Production stays pinned:
# infra/security/collect-production-a5-current-health.sh asserts the live service still reads
# exactly {minTaskCount:1,maxTaskCount:2,AVERAGE_CPU,70}, so an override there breaks signed
# evidence instead of saving money.
EXPRESS_MIN_TASKS="${ECS_EXPRESS_MIN_TASKS:-1}"
EXPRESS_MAX_TASKS="${ECS_EXPRESS_MAX_TASKS:-2}"
for express_count in "$EXPRESS_MIN_TASKS" "$EXPRESS_MAX_TASKS"; do
  case "$express_count" in
    ''|*[!0-9]*)
      echo "ERROR: ECS_EXPRESS_MIN_TASKS/ECS_EXPRESS_MAX_TASKS must be non-negative integers" >&2
      exit 1
      ;;
  esac
done
if [ "$EXPRESS_MAX_TASKS" -lt "$EXPRESS_MIN_TASKS" ]; then
  echo "ERROR: ECS_EXPRESS_MAX_TASKS ($EXPRESS_MAX_TASKS) is below ECS_EXPRESS_MIN_TASKS ($EXPRESS_MIN_TASKS)" >&2
  exit 1
fi
if [ "$DEPLOY_ENV" = production ] \
  && { [ "$EXPRESS_MIN_TASKS" != 1 ] || [ "$EXPRESS_MAX_TASKS" != 2 ]; }; then
  echo "ERROR: production capacity is pinned to 1/2; A5 health evidence asserts that exact shape" >&2
  exit 1
fi
case "$DEPLOY_ENV" in
  production) RESOURCE_STAGE="prod" ;;
  uat) RESOURCE_STAGE="uat" ;;
  *) echo "ERROR: DEPLOY_ENV must be production or uat" >&2; exit 2 ;;
esac
case "$PRODUCTION_SERVING_MODE_INPUT" in
  maintenance_only|live) ;;
  '')
    if [ "$DEPLOY_ENV" = production ]; then
      echo "ERROR: PRODUCTION_SERVING_MODE is required in production and must be maintenance_only or live" >&2
      exit 2
    fi
    PRODUCTION_SERVING_MODE_INPUT=live
    ;;
  *) echo "ERROR: PRODUCTION_SERVING_MODE must be exactly maintenance_only or live" >&2; exit 2 ;;
esac
case "$REIMBURSEMENT_WRITE_QUIESCE_INPUT" in
  true|false) ;;
  *) echo "ERROR: REIMBURSEMENT_WRITE_QUIESCE must be exactly true or false" >&2; exit 2 ;;
esac
case "$REIMBURSEMENT_BRIDGE_INPUT" in true|false) ;; *)
  echo "ERROR: REIMBURSEMENT_BRIDGE must be exactly true or false" >&2
  exit 2
esac
case "$PARTIAL_INCIDENT_READONLY_INPUT" in true|false) ;; *)
  echo "ERROR: PARTIAL_INCIDENT_READONLY must be exactly true or false" >&2; exit 2 ;;
esac
case "$MAINTENANCE_BOOTSTRAP_READONLY_INPUT" in true|false) ;; *)
  echo "ERROR: MAINTENANCE_BOOTSTRAP_READONLY must be exactly true or false" >&2; exit 2 ;;
esac
# P12-1 web LINE login (OAuth Authorization Code + PKCE; LINE Login journey spec). Owner approved
# 2026-08-28 enabled on UAT for live verification. 2026-08-30: the P12 activation gate PASSED —
# Owner-provided LINE console evidence (provider Mangmeeplus 2005422657, Admin role, Messaging API
# + LINE Login channels under the same provider, login channel 2011037668 Published, production
# callback https://mangmeeplus.com/api/auth/line-login/callback registered; recorded in
# docs/agent-memory/line-login-p12-delivery.md) — so LINE web login now defaults ON in BOTH
# environments, and LINE_WEB_HANDOFF_ENABLED below followed it on 2026-08-30 (parity decision).
if [ -z "$LINE_WEB_LOGIN_ENABLED_INPUT" ]; then
  LINE_WEB_LOGIN_ENABLED_INPUT=true
fi
case "$LINE_WEB_LOGIN_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_WEB_LOGIN_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
# P12-3b LINE→web deep-link handoff. Owner approved 2026-08-29 enabling on UAT after the Q2
# link-preview measurement PASSED (evidence in line-deeplink-company-access-mismatch.md). The P12
# activation gate then passed, and the Owner parity decision 2026-08-30 aligned production with
# UAT: this defaults ON in BOTH environments, with no environment branch and no fail-closed block
# (asserted by production-serving-mode.spec.sh). Only maintenance_only serving mode forces it off.
if [ -z "$LINE_WEB_HANDOFF_ENABLED_INPUT" ]; then
  LINE_WEB_HANDOFF_ENABLED_INPUT=true
fi
case "$LINE_WEB_HANDOFF_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_WEB_HANDOFF_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
# LINE exact standalone greeting 0-call lane (latency spec §11.2; advisor plan Phase 0). Owner
# approved 2026-08-22 as the UAT default so the lane's baseline can be measured; production stays
# off until the lane passes its activation gates, so an explicit production `true` fails closed.
if [ -z "$LINE_AI_EXACT_GREETING_ENABLED_INPUT" ]; then
  LINE_AI_EXACT_GREETING_ENABLED_INPUT=true
fi
case "$LINE_AI_EXACT_GREETING_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_AI_EXACT_GREETING_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
# Advisor Slice A (advisor spec §9; Owner 2026-08-27 "A+B"): UAT runs the SOCIAL direct-answer
# lane by default so the single-call casual path can be measured; production stays off until the
# lane passes its activation gates, so any explicit non-off production value fails closed.
if [ -z "$LINE_AI_ADVISOR_MODE_INPUT" ]; then
  LINE_AI_ADVISOR_MODE_INPUT=social
fi
case "$LINE_AI_ADVISOR_MODE_INPUT" in off|social|knowledge|company) ;; *)
  echo "ERROR: LINE_AI_ADVISOR_MODE must be one of off|social|knowledge|company" >&2; exit 2 ;;
esac
# Brain-Real lanes (docs/specs/mangmee-brain-real-answers-spec.md §9). Owner 2026-08-30 parity
# decision after a week of UAT measurement: production now runs the SAME conversational and
# speed lanes as UAT (loading-on-accept, fused-plan shadow, prepared-simple-read, deterministic
# families, 1000 ms debounce, advisor social, exact greeting, web handoff). Only the debounce
# cohort EXPERIMENT stays production-blocked below. Explicit variables still override.
if [ -z "$LINE_AI_LOADING_ON_ACCEPT_ENABLED_INPUT" ]; then
  LINE_AI_LOADING_ON_ACCEPT_ENABLED_INPUT=true
fi
if [ -z "$LINE_AI_FUSED_PLAN_SHADOW_ENABLED_INPUT" ]; then
  LINE_AI_FUSED_PLAN_SHADOW_ENABLED_INPUT=true
fi
if [ -z "$LINE_AI_PREPARED_SIMPLE_READ_ENABLED_INPUT" ]; then
  LINE_AI_PREPARED_SIMPLE_READ_ENABLED_INPUT=true
fi
# Owner 2026-09-06 enabled draft edit in both environments; UAT J1-J4 still supplies acceptance.
if [ -z "$LINE_AI_DRAFT_EDIT_ENABLED_INPUT" ]; then
  LINE_AI_DRAFT_EDIT_ENABLED_INPUT=true
fi
# Owner 2026-09-18 (ADR 0013 §9): the SPLIT activation gate is open in both environments. This only
# lets a System Admin SAVE a SPLIT budget policy for a company; it changes no company by itself —
# every company stays SHARED until an admin saves one, so both stages carry the same value.
if [ -z "$AI_BUDGET_SPLIT_ACTIVATION_ENABLED_INPUT" ]; then
  AI_BUDGET_SPLIT_ACTIVATION_ENABLED_INPUT=true
fi
# Debounce: Owner selected 1,000 ms as the primary candidate (spec decision 2026-08-22);
# UAT runs it as the canary default, production keeps the shipped 2,000 ms until the
# cohort gates pass. Numeric-only; the app clamps its own bounds.
if [ -z "$LINE_AI_BUFFER_DEBOUNCE_MS_INPUT" ]; then
  LINE_AI_BUFFER_DEBOUNCE_MS_INPUT=1000
fi
case "$LINE_AI_BUFFER_DEBOUNCE_MS_INPUT" in ''|*[!0-9]*)
  echo "ERROR: LINE_AI_BUFFER_DEBOUNCE_MS must be a positive integer (milliseconds)" >&2; exit 2 ;;
esac
# Every compiled family (prepared-simple-read-formatter.ts `COMPILED_FORMATTERS`), the SAME default in
# both environments since the 2026-08-30 parity pass — production does NOT refuse a non-empty allowlist
# (only `maintenance_only` blanks it, further down). Owner decision 2026-09-18 (spec §6): the R5 families
# are on in Production too. Unknown keys can only narrow, never widen: `activePreparedFamilies` filters
# the compiled registry, so a key here that has no compiled formatter is inert.
if [ -z "$LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES_INPUT" ]; then
  LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES_INPUT="sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric,tax.get_vat_summary::single_metric,inventory.list_low_stock::list,procurement.get_ap_outstanding::single_metric,procurement.get_ap_outstanding::list,crm.get_customer_summary::single_metric,crm.get_customer_summary::list"
fi
case "$LINE_AI_LOADING_ON_ACCEPT_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_AI_LOADING_ON_ACCEPT_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
case "$LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
if [ "$DEPLOY_ENV" = production ] && [ "$LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED_INPUT" = true ]; then
  echo "ERROR: LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED=true is not activated for production yet" >&2
  exit 2
fi
# Owner 2026-09-06: align signup/draft switches with UAT; email delivery remains deferred.
if [ -z "$EXTERNAL_SIGNUP_ENABLED_INPUT" ]; then
  EXTERNAL_SIGNUP_ENABLED_INPUT=true
fi
case "$EXTERNAL_SIGNUP_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: EXTERNAL_SIGNUP_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
# Signup and receipt quota are enabled together by the same recorded Owner decision.
if [ -z "$LINE_SIGNUP_ENABLED_INPUT" ]; then
  LINE_SIGNUP_ENABLED_INPUT=true
fi
case "$LINE_SIGNUP_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_SIGNUP_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
if [ -z "$RECEIPT_QUOTA_ENFORCED_INPUT" ]; then
  RECEIPT_QUOTA_ENFORCED_INPUT=true
fi
case "$RECEIPT_QUOTA_ENFORCED_INPUT" in true|false) ;; *)
  echo "ERROR: RECEIPT_QUOTA_ENFORCED must be exactly true or false" >&2; exit 2 ;;
esac
# AUTO_FREE is the approved default; operators can still explicitly select MANUAL.
if [ -z "$LINE_SIGNUP_APPROVAL_MODE_INPUT" ]; then
  LINE_SIGNUP_APPROVAL_MODE_INPUT=AUTO_FREE
fi
case "$LINE_SIGNUP_APPROVAL_MODE_INPUT" in MANUAL|AUTO_FREE) ;; *)
  echo "ERROR: LINE_SIGNUP_APPROVAL_MODE must be exactly MANUAL or AUTO_FREE" >&2; exit 2 ;;
esac
# The remaining P10-L knobs are shaped, not gated. Each pattern is the EXACT counterpart of its
# `apiConfigSchema` rule (packages/config/src/index.ts): anything this lets through and zod does not
# is a task revision that crash-loops on boot instead of a deploy that stops here.
# `nonnegative()` — 0 is a legal daily cap (it means "queue everything").
case "$LINE_SIGNUP_AUTO_DAILY_CAP_INPUT" in ''|*[!0-9]*)
  echo "ERROR: LINE_SIGNUP_AUTO_DAILY_CAP must be a non-negative integer" >&2; exit 2 ;;
esac
# `positive()` — 0 fails zod, so it must fail here too. A ceiling of zero would also mean a trial
# shop whose very first receipt is refused.
assert_positive_int() {
  case "$2" in ''|*[!0-9]*) ;; *) [ "$2" -gt 0 ] && return 0 ;; esac
  echo "ERROR: $1 must be a positive integer" >&2
  exit 2
}
assert_positive_int LINE_SIGNUP_WARMUP_SLIPS "$LINE_SIGNUP_WARMUP_SLIPS_INPUT"
assert_positive_int LINE_FREE_AI_BUDGET_SATANG "$LINE_FREE_AI_BUDGET_SATANG_INPUT"
assert_positive_int LINE_SIGNUP_ADMIN_REMINDER_MINUTES "$LINE_SIGNUP_ADMIN_REMINDER_MINUTES_INPUT"
assert_positive_int LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY "$LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY_INPUT"
if [[ ! "$LINE_SIGNUP_BUSINESS_DAYS_INPUT" =~ ^(MON|TUE|WED|THU|FRI|SAT|SUN)-(MON|TUE|WED|THU|FRI|SAT|SUN)$ ]]; then
  echo "ERROR: LINE_SIGNUP_BUSINESS_DAYS must look like MON-SAT" >&2; exit 2
fi
if [[ ! "$LINE_SIGNUP_BUSINESS_HOURS_INPUT" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  echo "ERROR: LINE_SIGNUP_BUSINESS_HOURS must look like 09:00-18:00" >&2; exit 2
fi
if [ -z "$EMAIL_PROVIDER_INPUT" ]; then
  if [ "$DEPLOY_ENV" = uat ]; then EMAIL_PROVIDER_INPUT=postmark; else EMAIL_PROVIDER_INPUT=postmark; fi
fi
case "$EMAIL_PROVIDER_INPUT" in disabled|ses|postmark) ;; *)
  echo "ERROR: EMAIL_PROVIDER must be exactly disabled, ses or postmark for cloud deploys" >&2; exit 2 ;;
esac
if [ "$DEPLOY_ENV" = production ] && [ "$EMAIL_PROVIDER_INPUT" = ses ]; then
  echo "ERROR: EMAIL_PROVIDER=ses is not activated for production yet" >&2
  exit 2
fi
if [ "$EMAIL_PROVIDER_INPUT" = ses ] && [ -z "$SES_FROM_ADDRESS_INPUT" ]; then
  if [ "$DEPLOY_ENV" = uat ]; then SES_FROM_ADDRESS_INPUT="contact@mangmeeplus.com"; else
    echo "ERROR: SES_FROM_ADDRESS is required when EMAIL_PROVIDER=ses" >&2; exit 2
  fi
fi
# Bounce/complaint feedback (spec §4D): both ride the ses provider gate. Empty values keep todays
# behaviour exactly — sends carry no configuration set and /v1/public/ses-events refuses everything
# (fail closed), so production stays inert until its email round is activated above.
SES_CONFIGURATION_SET_VALUE="${SES_CONFIGURATION_SET:-}"
SES_EVENTS_TOPIC_ARN_VALUE="${SES_EVENTS_TOPIC_ARN:-}"
if [ "$EMAIL_PROVIDER_INPUT" = ses ]; then
  SES_CONFIGURATION_SET_VALUE="${SES_CONFIGURATION_SET_VALUE:-mangmee-transactional}"
  SES_EVENTS_TOPIC_ARN_VALUE="${SES_EVENTS_TOPIC_ARN_VALUE:-arn:aws:sns:${SES_REGION_INPUT}:311414082667:mangmee-ses-events}"
fi
case "$LINE_AI_FUSED_PLAN_SHADOW_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_AI_FUSED_PLAN_SHADOW_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
case "$LINE_AI_PREPARED_SIMPLE_READ_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_AI_PREPARED_SIMPLE_READ_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
case "$LINE_AI_DRAFT_EDIT_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_AI_DRAFT_EDIT_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
case "$AI_BUDGET_SPLIT_ACTIVATION_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: AI_BUDGET_SPLIT_ACTIVATION_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
case "$LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
case "$LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
case "$LINE_AI_FLEX_TEXT_FALLBACK_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_AI_FLEX_TEXT_FALLBACK_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
case "$LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED_INPUT" in true|false) ;; *)
  echo "ERROR: LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED must be exactly true or false" >&2; exit 2 ;;
esac
# Family keys are `${tool}::${answerShape}` (apps/ai-gateway/.../prepared-simple-read-formatter.ts),
# comma-separated. Reject anything outside that charset here: the value is interpolated into a task
# definition, and a stray quote/space/newline would either break the JSON or smuggle an entry past the
# gateway's narrowing. An unknown-but-well-formed key is already inert (activePreparedFamilies only
# NARROWS the compiled registry), so the charset is the only check this layer owes.
if [ -n "$LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES_INPUT" ]; then
  if [[ ! "$LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES_INPUT" =~ ^[A-Za-z0-9.:,_-]+$ ]]; then
    echo "ERROR: LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES must be a comma-separated allowlist of" >&2
    echo "       family keys (letters, digits, '.', ':', ',', '_', '-' only)" >&2
    exit 2
  fi
fi
if [ "$PRODUCTION_SERVING_MODE_INPUT" = maintenance_only ]; then
  maintenance_intent_valid=false
  if [ "$RELEASE_MODE_INPUT" = promotion ]; then
    if { [ "$TARGET" = all ] && [ "$REIMBURSEMENT_BRIDGE_INPUT" = false ]; } \
      || { [ "$TARGET" = api-web ] && [ "$REIMBURSEMENT_BRIDGE_INPUT" = true ]; }; then
      [ "$PARTIAL_INCIDENT_READONLY_INPUT" = false ] \
        && [ "$MAINTENANCE_BOOTSTRAP_READONLY_INPUT" = false ] \
        && maintenance_intent_valid=true
    fi
  elif { [ "$RELEASE_MODE_INPUT" = fast-promotion ] \
      || [ "$RELEASE_MODE_INPUT" = passport-promotion ]; } \
    && [ "$TARGET" = all ] \
    && [ "$REIMBURSEMENT_BRIDGE_INPUT" = false ] \
    && [ "$PARTIAL_INCIDENT_READONLY_INPUT" = false ] \
    && [ "$MAINTENANCE_BOOTSTRAP_READONLY_INPUT" = false ]; then
    maintenance_intent_valid=true
  elif [ "$RELEASE_MODE_INPUT" = maintenance-bootstrap ] \
    && [ "$TARGET" = all ] \
    && [ "$REIMBURSEMENT_BRIDGE_INPUT" = false ] \
    && [ "$PARTIAL_INCIDENT_READONLY_INPUT" = false ] \
    && [ "$MAINTENANCE_BOOTSTRAP_READONLY_INPUT" = true ]; then
    maintenance_intent_valid=true
  fi
  if [ "$DEPLOY_ENV" != production ] || [ "$maintenance_intent_valid" != true ] \
    || [ -z "$MANIFEST_INPUT" ] || [[ ! "${SOURCE_SHA:-}" =~ ^[0-9a-f]{40}$ ]] \
    || [ "$REIMBURSEMENT_WRITE_QUIESCE_INPUT" != true ]; then
    echo "ERROR: maintenance_only requires an immutable quiesced all-target bootstrap, promotion bridge, or coordinated promotion" >&2
    exit 2
  fi
fi
if { [ "$MAINTENANCE_BOOTSTRAP_READONLY_INPUT" = true ] \
    || [ "$RELEASE_MODE_INPUT" = maintenance-bootstrap ]; } \
  && { [ "$DEPLOY_ENV" != production ] || [ "$RELEASE_MODE_INPUT" != maintenance-bootstrap ] \
    || [ "$TARGET" != all ] || [ "$PRODUCTION_SERVING_MODE_INPUT" != maintenance_only ] \
    || [ "$REIMBURSEMENT_WRITE_QUIESCE_INPUT" != true ] || [ -z "$MANIFEST_INPUT" ] \
    || [[ ! "${SOURCE_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || [ "$REIMBURSEMENT_BRIDGE_INPUT" != false ] \
    || [ "$PARTIAL_INCIDENT_READONLY_INPUT" != false ]; }; then
  echo "ERROR: maintenance bootstrap requires production target=all, maintenance_only, quiesce=true, one immutable manifest and no bridge/partial mode" >&2
  exit 2
fi
if [ "$PARTIAL_INCIDENT_READONLY_INPUT" = true ] \
  && { [ "$DEPLOY_ENV" != production ] || [ "$TARGET" = all ]; }; then
  echo "ERROR: the read-only incident path is production single-service only" >&2
  exit 2
fi
if [ "$REIMBURSEMENT_BRIDGE_INPUT" = true ] \
  && { [ "$DEPLOY_ENV" != production ] || [ "$TARGET" != api-web ] \
    || [ "$REIMBURSEMENT_WRITE_QUIESCE_INPUT" != true ] || [ -z "$MANIFEST_INPUT" ] \
    || [ "$PARTIAL_INCIDENT_READONLY_INPUT" != false ] \
    || [ "$MAINTENANCE_BOOTSTRAP_READONLY_INPUT" != false ]; }; then
  echo "ERROR: reimbursement bridge requires production api-web, quiesce=true, one immutable manifest and no incident mode" >&2
  exit 2
fi
RESOURCE_PREFIX="watchdog-bms-${RESOURCE_STAGE}"
# Shared with Kamal; only non-secret values and environment-scoped secret ARNs reach this JSON.
POSTMARK_DEPLOYMENT="$(python3 "$(dirname "${BASH_SOURCE[0]}")/../postmark/config.py" --environment "$DEPLOY_ENV" --provider "${EMAIL_PROVIDER:-}")"
EMAIL_PROVIDER_INPUT="$(jq -r '.provider' <<<"$POSTMARK_DEPLOYMENT")"
PARAM_PREFIX="/watchdog-bms/${DEPLOY_ENV}"
SECRET_PREFIX="watchdog-bms/${DEPLOY_ENV}"
CLUSTER_NAME="${ECS_CLUSTER_NAME:-$RESOURCE_PREFIX}"
if [ "$DEPLOY_ENV" = "uat" ] && [ "$CLUSTER_NAME" != "watchdog-bms-uat" ]; then
  echo "ERROR: UAT cluster must be watchdog-bms-uat" >&2
  exit 2
fi
case "$TARGET" in
  api-web|ai-gateway|workers|all)
    if [ "$PARTIAL_INCIDENT_READONLY_INPUT" = true ] \
      || [ "$REIMBURSEMENT_BRIDGE_INPUT" = true ] \
      || [ "$MAINTENANCE_BOOTSTRAP_READONLY_INPUT" = true ]; then
      [ -n "${DEPLOYMENT_EVIDENCE_DIR:-}" ] || {
        echo "ERROR: no-database rollout requires DEPLOYMENT_EVIDENCE_DIR" >&2
        exit 2
      }
    elif [[ ! "${RELEASE_PARENT_OPERATION_ID:-}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
      || [ -z "${RELEASE_TASK_IMAGE:-}" ] || [ -z "${DEPLOYMENT_EVIDENCE_DIR:-}" ]; then
      echo "ERROR: service rollout requires RELEASE_PARENT_OPERATION_ID, RELEASE_TASK_IMAGE and DEPLOYMENT_EVIDENCE_DIR from the successful pre-deploy release task" >&2
      exit 2
    fi
    ;;
  s3-cors) ;;
  *) echo "Usage: $0 [api-web|ai-gateway|workers|s3-cors|all]" >&2; exit 2 ;;
esac
if [ -z "$WORKFLOW_WEBHOOK_ALLOWED_HOSTS_INPUT" ]; then
  echo "ERROR: WORKFLOW_WEBHOOK_ALLOWED_HOSTS must be an explicit comma-separated production allowlist," >&2
  echo "       or 'none' to deny every outbound webhook. Do not invent a placeholder host." >&2
  exit 2
fi
WORKFLOW_WEBHOOK_ALLOWED_HOSTS="$WORKFLOW_WEBHOOK_ALLOWED_HOSTS_INPUT"
if [ -z "$CLAMAV_HOST_INPUT" ]; then
  echo "ERROR: CLAMAV_HOST must point to the private malware-scanning service" >&2
  exit 2
fi
if [ "$DEPLOY_ENV" = "production" ] && { [ -z "$LOG_KMS_KEY_ID" ] || [ -z "$SECURITY_ALERT_TOPIC_ARN" ]; }; then
  echo "ERROR: LOG_KMS_KEY_ID and SECURITY_ALERT_TOPIC_ARN are required for production monitoring" >&2
  exit 2
fi
# CloudWatch accepts one day upward. The floor here used to be 30, which meant the retention
# policy the environments actually run (production 14, UAT 3) could not be expressed at all:
# a deploy rejected it before ever reaching the per-environment pin below.
[[ "$LOG_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || {
  echo "ERROR: LOG_RETENTION_DAYS must be a positive integer" >&2
  exit 2
}
# Each environment is pinned to exactly one value, in both directions. ensure_log_group() rewrites
# retention on every log group it touches on every deploy, so an unpinned value would quietly
# become the new policy at the next deploy without anyone deciding it - which is how the groups
# came to disagree with the documentation in the first place.
if [ "$DEPLOY_ENV" = "production" ] && [ "$LOG_RETENTION_DAYS" -ne 14 ]; then
  echo "ERROR: production LOG_RETENTION_DAYS must be exactly 14" >&2
  exit 2
fi
if [ "$DEPLOY_ENV" = "uat" ] && [ "$LOG_RETENTION_DAYS" -ne 3 ]; then
  echo "ERROR: uat LOG_RETENTION_DAYS must be exactly 3" >&2
  exit 2
fi
CLAMAV_HOST="$CLAMAV_HOST_INPUT"
AWS_BIN="${AWS_BIN:-/opt/homebrew/bin/aws}"
if [ ! -x "$AWS_BIN" ]; then
  AWS_BIN="$(command -v aws)"
fi
DOCKER_BIN="${DOCKER_BIN:-/opt/homebrew/bin/docker}"
if [ ! -x "$DOCKER_BIN" ]; then
  DOCKER_BIN="$(command -v docker)"
fi
export DOCKER_BUILDKIT=1
CREATED_DOCKER_CONFIG=''
if [ -z "${DOCKER_CONFIG:-}" ]; then
  DOCKER_CONFIG="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-docker-config.XXXXXX")"
  CREATED_DOCKER_CONFIG="$DOCKER_CONFIG"
  if [ -d /Applications/Docker.app/Contents/Resources/cli-plugins ]; then
    ln -s /Applications/Docker.app/Contents/Resources/cli-plugins "$DOCKER_CONFIG/cli-plugins"
  elif [ -d "${HOME:-}/.docker/cli-plugins" ]; then
    ln -s "${HOME}/.docker/cli-plugins" "$DOCKER_CONFIG/cli-plugins"
  fi
  export DOCKER_CONFIG
fi

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy "$AWS_BIN" "$@"
}

# The same no-overwrite SSM mutex is used by the Redis migration helper. This closes the race where
# deploy could pass a read-only lock check and mutate ECS while migration acquired the lock.
# shellcheck source=infra/uat/lib-runtime-mutex.sh
. infra/uat/lib-runtime-mutex.sh
cleanup_deploy() {
  uat_runtime_mutex_release
  [ -z "$CREATED_DOCKER_CONFIG" ] || rm -rf "$CREATED_DOCKER_CONFIG"
}
trap cleanup_deploy EXIT

ACCOUNT_ID="$(aws_cmd sts get-caller-identity --query Account --output text --region "$REGION")"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
if [ -n "$CRM_AI_OUTBOUND_ALLOWED_DOMAINS_INPUT" ]; then
  CRM_AI_OUTBOUND_ALLOWED_DOMAINS="$CRM_AI_OUTBOUND_ALLOWED_DOMAINS_INPUT"
elif [ "$DEPLOY_ENV" = "production" ]; then
  CRM_AI_OUTBOUND_ALLOWED_DOMAINS="mangmeeplus.com"
else
  CRM_AI_OUTBOUND_ALLOWED_DOMAINS="uat.mangmeeplus.com"
fi

# M-05: a workstation .env is tuned for local development, so it must not select the
# production model — same rule as the image manifest below.
#
# Owner decisions 2026-07-28: production runs `global.` profiles under the recorded
# cross-border transfer exception, NOT a geographic profile — and the chat role is
# DELIBERATELY upgraded from the previously-live claude-haiku-4-5 to Sonnet 4.6
# ("แชทใช้ sonnet-4-6 global ได้เลย", chat-cost implication accepted). Both roles now pin
# Sonnet 4.6; the two variables stay separate because the roles are load-bearing —
# if the split ever diverges again, change one variable, and the allowlist below
# already handles either case.
# The only invocable Anthropic APAC profile in ap-southeast-1 is
# claude-3-5-sonnet-20241022-v2 (claude-sonnet-4-* is published but provider-marked
# Legacy → "Access denied"), which is generations behind both roles; PDPA allows the
# transfer with recorded safeguards, so the exception is the intended mechanism.
#
# The approval reference is deliberately NOT hardcoded: it identifies a data-protection
# approval with a named owner, so it must come from the deploy environment and is
# checked here rather than at container boot — a canary that boot-fails mid-bake trips
# the rollback alarm instead of telling you the reference is missing. The §5 approval
# must name BOTH models (register §2.1).
PROD_CHAT_MODEL="global.anthropic.claude-sonnet-4-6"
PROD_DOC_MODEL="global.anthropic.claude-sonnet-4-6"
# Allowlist covers both roles without shipping a duplicate entry when they coincide.
PROD_MODEL_ALLOWLIST="$PROD_CHAT_MODEL"
[ "$PROD_DOC_MODEL" != "$PROD_CHAT_MODEL" ] && PROD_MODEL_ALLOWLIST="$PROD_CHAT_MODEL,$PROD_DOC_MODEL"
if [ "$DEPLOY_ENV" = production ] && [ "$PRODUCTION_SERVING_MODE_INPUT" = maintenance_only ]; then
  BEDROCK_MODEL_ID="apac.anthropic.claude-3-5-sonnet-20241022-v2:0"
  DOCUMENT_AI_MODEL_ID="$BEDROCK_MODEL_ID"
  APPROVED_AI_MODEL_IDS="$BEDROCK_MODEL_ID"
  AI_GLOBAL_INFERENCE_PROFILE_APPROVED=""
elif [ "$DEPLOY_ENV" = "production" ]; then
  BEDROCK_MODEL_ID="$PROD_CHAT_MODEL"
  DOCUMENT_AI_MODEL_ID="$PROD_DOC_MODEL"
  AI_GLOBAL_INFERENCE_PROFILE_APPROVED="true"
  if [ -z "${AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF:-}" ]; then
    echo "ERROR: AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF is required to deploy production." >&2
    echo "       Production runs global Bedrock inference profiles ($BEDROCK_MODEL_ID," >&2
    echo "       $DOCUMENT_AI_MODEL_ID), which may process a turn outside APPROVED_AI_REGIONS." >&2
    echo "       Set it to the data-protection approval reference recorded in" >&2
    echo "       docs/security-evidence/p1-ai-processor-lawful-basis-register.md (M-05 / G-02)." >&2
    echo "       To deploy without an approval, use an approved geographic profile:" >&2
    echo "       APPROVED_AI_MODEL_IDS/BEDROCK_MODEL_ID=apac.anthropic.claude-3-5-sonnet-20241022-v2:0" >&2
    exit 2
  fi
  # The exception permits `global.` in the allowlist, but the models must still be IN it,
  # so production names its models explicitly instead of inheriting the geographic-only
  # DEFAULT_APPROVED_AI_MODEL_IDS. That default stays `global.`-free on purpose: the
  # exception is a production decision, not a change to the safe baseline.
  APPROVED_AI_MODEL_IDS="$PROD_MODEL_ALLOWLIST"
else
  # UAT. Its task definition also sets APP_ENV=production, so the same M-05 rule applies
  # and a workstation .env pinning a `global.` model would boot-fail the gateway.
  # UAT mirrors production when an approval reference is supplied — that is what makes a
  # UAT run evidence about production, especially for receipt OCR. Without one it falls
  # back to the regional profile instead of failing the deploy: UAT must not be blocked
  # waiting on DPO sign-off, and it carries no approval of its own to spend.
  if [ -n "${AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF:-}" ]; then
    # Mirror production's real model split, or the UAT run is not evidence about prod.
    BEDROCK_MODEL_ID="$PROD_CHAT_MODEL"
    DOCUMENT_AI_MODEL_ID="$PROD_DOC_MODEL"
    APPROVED_AI_MODEL_IDS="$PROD_MODEL_ALLOWLIST"
    AI_GLOBAL_INFERENCE_PROFILE_APPROVED="true"
  else
    BEDROCK_MODEL_ID="apac.anthropic.claude-3-5-sonnet-20241022-v2:0"
    DOCUMENT_AI_MODEL_ID="$BEDROCK_MODEL_ID"
    APPROVED_AI_MODEL_IDS="$BEDROCK_MODEL_ID"
    AI_GLOBAL_INFERENCE_PROFILE_APPROVED=""
    echo "NOTE: UAT is deploying on the regional profile ($BEDROCK_MODEL_ID)." >&2
    echo "      Production runs $PROD_CHAT_MODEL (chat) +" >&2
    echo "      $PROD_DOC_MODEL (documents), so AI behaviour here is" >&2
    echo "      NOT evidence about production. Set AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF" >&2
    echo "      to the recorded approval to mirror production." >&2
  fi
fi

# One serving-mode decision feeds every process. Live retains the existing values; maintenance
# disables every asynchronous/customer-facing AI path while health endpoints stay available.
SERVING_CRM_AUTO_REPLY_ENABLED="${CRM_AUTO_REPLY_ENABLED:-false}"
SERVING_AI_ENABLED=true
SERVING_MODEL_PROVIDER="${MODEL_PROVIDER:-disabled}"
SERVING_APPROVED_AI_PROVIDERS="${APPROVED_AI_PROVIDERS:-}"
SERVING_QUEUE_ENABLED=true
SERVING_MAINTENANCE_ACTIVE=false
SERVING_LINE_WEB_LOGIN_ENABLED="$LINE_WEB_LOGIN_ENABLED_INPUT"
SERVING_LINE_WEB_HANDOFF_ENABLED="$LINE_WEB_HANDOFF_ENABLED_INPUT"
SERVING_LINE_AI_EXACT_GREETING_ENABLED="$LINE_AI_EXACT_GREETING_ENABLED_INPUT"
SERVING_LINE_AI_ADVISOR_MODE="$LINE_AI_ADVISOR_MODE_INPUT"
SERVING_LINE_AI_LOADING_ON_ACCEPT_ENABLED="$LINE_AI_LOADING_ON_ACCEPT_ENABLED_INPUT"
SERVING_LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED="$LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED_INPUT"
SERVING_LINE_AI_FUSED_PLAN_SHADOW_ENABLED="$LINE_AI_FUSED_PLAN_SHADOW_ENABLED_INPUT"
SERVING_LINE_AI_PREPARED_SIMPLE_READ_ENABLED="$LINE_AI_PREPARED_SIMPLE_READ_ENABLED_INPUT"
SERVING_LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES="$LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES_INPUT"
SERVING_LINE_AI_DRAFT_EDIT_ENABLED="$LINE_AI_DRAFT_EDIT_ENABLED_INPUT"
SERVING_AI_BUDGET_SPLIT_ACTIVATION_ENABLED="$AI_BUDGET_SPLIT_ACTIVATION_ENABLED_INPUT"
SERVING_LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED="$LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED_INPUT"
SERVING_LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED="$LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED_INPUT"
SERVING_LINE_AI_FLEX_TEXT_FALLBACK_ENABLED="$LINE_AI_FLEX_TEXT_FALLBACK_ENABLED_INPUT"
SERVING_LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED="$LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED_INPUT"
SERVING_EXTERNAL_SIGNUP_ENABLED="$EXTERNAL_SIGNUP_ENABLED_INPUT"
SERVING_LINE_SIGNUP_ENABLED="$LINE_SIGNUP_ENABLED_INPUT"
SERVING_RECEIPT_QUOTA_ENFORCED="$RECEIPT_QUOTA_ENFORCED_INPUT"
SERVING_EMAIL_PROVIDER="$EMAIL_PROVIDER_INPUT"
if [ "$PRODUCTION_SERVING_MODE_INPUT" = maintenance_only ]; then
  SERVING_CRM_AUTO_REPLY_ENABLED=false
  SERVING_AI_ENABLED=false
  SERVING_MODEL_PROVIDER=disabled
  SERVING_QUEUE_ENABLED=false
  SERVING_MAINTENANCE_ACTIVE=true
  SERVING_LINE_WEB_LOGIN_ENABLED=false
  SERVING_LINE_WEB_HANDOFF_ENABLED=false
  SERVING_LINE_AI_EXACT_GREETING_ENABLED=false
  SERVING_LINE_AI_ADVISOR_MODE=off
  SERVING_LINE_AI_LOADING_ON_ACCEPT_ENABLED=false
  SERVING_LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED=false
  SERVING_LINE_AI_FUSED_PLAN_SHADOW_ENABLED=false
  SERVING_LINE_AI_PREPARED_SIMPLE_READ_ENABLED=false
  SERVING_LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES=""
  SERVING_LINE_AI_DRAFT_EDIT_ENABLED=false
  SERVING_AI_BUDGET_SPLIT_ACTIVATION_ENABLED=false
  SERVING_LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=false
  SERVING_LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED=false
  SERVING_LINE_AI_FLEX_TEXT_FALLBACK_ENABLED=false
  SERVING_LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED=false
  SERVING_EXTERNAL_SIGNUP_ENABLED=false
  # A quiesced runtime takes no new shops and refuses no receipts: both P10-L switches go dark with
  # every other customer-facing one.
  SERVING_LINE_SIGNUP_ENABLED=false
  SERVING_RECEIPT_QUOTA_ENFORCED=false
  SERVING_EMAIL_PROVIDER=disabled
fi
if [ "$DEPLOY_ENV" = production ] && [ "$PRODUCTION_SERVING_MODE_INPUT" = live ] \
  && { [ "$TARGET" = all ] || [ "$TARGET" = ai-gateway ]; }; then
  case "$SERVING_MODEL_PROVIDER" in bedrock|openai) ;; *)
    echo "ERROR: production live AI rollout requires explicit MODEL_PROVIDER=bedrock or openai" >&2
    exit 2
  esac
  approved_providers=",${SERVING_APPROVED_AI_PROVIDERS//[[:space:]]/},"
  case "$approved_providers" in *",${SERVING_MODEL_PROVIDER},"*) ;; *)
    echo "ERROR: production live MODEL_PROVIDER must appear in APPROVED_AI_PROVIDERS" >&2
    exit 2
  esac
fi

# Do not let a workstation .env select a different artifact or source revision.
PRODUCTION_IMAGE_MANIFEST="$MANIFEST_INPUT"
if [ -n "$PRODUCTION_IMAGE_MANIFEST" ]; then
  PRODUCTION_IMAGE_MANIFEST="$(cd "$(dirname "$PRODUCTION_IMAGE_MANIFEST")" && pwd -P)/$(basename "$PRODUCTION_IMAGE_MANIFEST")"
  COMMIT="$(bash infra/docker/validate-production-manifest.sh "$PRODUCTION_IMAGE_MANIFEST" "$ACCOUNT_ID" "$REGION")"
  git cat-file -e "${COMMIT}^{commit}"
else
  COMMIT="$(git rev-parse HEAD)"
fi
# SHA is the IMAGE TAG only. The containers receive the FULL commit as GIT_SHA, because that is the
# build id the launch control plane records on every gate transition and the guard compares against
# (F1.5.1): a 12-char prefix is an abbreviation, not an immutable build identity. Both must match
# what run-release-task.sh injects, or the release-task seeder attests a build the services deny.
SHA="${COMMIT:0:12}"
if [ "$PRODUCTION_SERVING_MODE_INPUT" = maintenance_only ] && [ "$SOURCE_SHA" != "$COMMIT" ]; then
  echo "ERROR: maintenance_only SOURCE_SHA does not match the immutable manifest commit" >&2
  exit 2
fi
if [ "$PARTIAL_INCIDENT_READONLY_INPUT" = true ]; then
  [ "${PARTIAL_INCIDENT_READONLY_PROVED_SHA:-}" = "$COMMIT" ] \
    && [ "${RELEASE_DATABASE_COMPATIBILITY_PROVED_SHA:-}" = "$COMMIT" ] || {
    echo "ERROR: read-only incident proof is absent or belongs to another source" >&2
    exit 2
  }
  if [ "$TARGET" = api-web ] \
    && [ "${PARTIAL_INCIDENT_BUILD_AUTHORITY_PROVED_SHA:-}" != "$COMMIT" ]; then
    echo "ERROR: incident api-web source is not already accepted and unretired" >&2
    exit 2
  fi
fi
if [ "$MAINTENANCE_BOOTSTRAP_READONLY_INPUT" = true ]; then
  [ "${MAINTENANCE_BOOTSTRAP_READONLY_PROVED_SHA:-}" = "$COMMIT" ] \
    && [ "${RELEASE_DATABASE_COMPATIBILITY_PROVED_SHA:-}" = "$COMMIT" ] || {
    echo "ERROR: maintenance bootstrap proof is absent or belongs to another source" >&2
    exit 2
  }
fi
if [ "$REIMBURSEMENT_BRIDGE_INPUT" = true ] \
  && [ "${REIMBURSEMENT_BRIDGE_PROVED_SHA:-}" != "$COMMIT" ]; then
  echo "ERROR: reimbursement bridge proof is absent or belongs to another source" >&2
  exit 2
fi

if [ "$DEPLOY_ENV" = "production" ]; then
  EXECUTION_ROLE="ecsTaskExecutionRole"
  RELEASE_TASK_ROLE="watchdog-bms-release-task-role"
  INFRA_ROLE="ecsInfrastructureRoleForExpressServices"
  API_TASK_ROLE="watchdog-bms-ecs-express-api-role"
  AI_TASK_ROLE="watchdog-bms-ecs-express-ai-gateway-role"
  WORKERS_TASK_ROLE="watchdog-bms-ecs-express-workers-role"
  EXECUTION_POLICY_NAME="watchdog-bms-ecs-execution-secrets"
  RELEASE_TASK_POLICY_NAME="watchdog-bms-release-task-ecs-read"
  API_POLICY_NAME="watchdog-bms-prod-api-runtime"
  AI_POLICY_NAME="watchdog-bms-ai-gateway-runtime"
  WORKERS_CLEANUP_POLICY_NAME="watchdog-bms-prod-workers-object-version-cleanup"
  API_SERVICE_NAME="watchdog-bms-api-web-pub"
  # -v2 is the live service. The original watchdog-bms-ai-gateway was deleted on 2026-07-03 after
  # its control-plane state broke, and its SSM ARN was repointed here - but this constant was left
  # on the old name. Following the SSM ARN is enough to *call* UpdateExpressGatewayService, which is
  # why README says the script tracks the live services automatically; the name is also used to
  # validate the returned service-revision ARN, and that check rejected the real service with
  # "incomplete active configuration". Nothing caught it because production ai-gateway had never
  # been deployed until now. Keep this equal to the service the SSM parameter points at.
  AI_SERVICE_NAME="watchdog-bms-ai-gateway-v2"
  WORKERS_SERVICE_NAME="watchdog-bms-workers"
else
  EXECUTION_ROLE="watchdog-bms-uat-ecs-execution-role"
  RELEASE_TASK_ROLE="watchdog-bms-uat-release-task-role"
  INFRA_ROLE="watchdog-bms-uat-ecs-infrastructure-role"
  API_TASK_ROLE="watchdog-bms-uat-ecs-api-role"
  AI_TASK_ROLE="watchdog-bms-uat-ecs-ai-gateway-role"
  WORKERS_TASK_ROLE="watchdog-bms-uat-ecs-workers-role"
  EXECUTION_POLICY_NAME="watchdog-bms-uat-ecs-execution-secrets"
  RELEASE_TASK_POLICY_NAME="watchdog-bms-uat-release-task-ecs-read"
  API_POLICY_NAME="watchdog-bms-uat-api-runtime"
  AI_POLICY_NAME="watchdog-bms-uat-ai-gateway-runtime"
  WORKERS_CLEANUP_POLICY_NAME="watchdog-bms-uat-workers-object-version-cleanup"
  API_SERVICE_NAME="watchdog-bms-uat-api-web"
  AI_SERVICE_NAME="watchdog-bms-uat-ai-gateway"
  WORKERS_SERVICE_NAME="watchdog-bms-uat-workers"
fi
APP_SG_NAME="${RESOURCE_PREFIX}-app-egress-sg"
AI_SG_NAME="${RESOURCE_PREFIX}-ai-egress-sg"
S3_BUCKET="${S3_BUCKET:-${RESOURCE_PREFIX}-${ACCOUNT_ID}}"

put_param() {
  aws_cmd ssm put-parameter --name "$1" --type String --value "$2" --overwrite --region "$REGION" >/dev/null
}

get_param() {
  local error_file value
  error_file="$(mktemp "${TMPDIR:-/tmp}/watchdog-bms-ssm-read.XXXXXX")"
  if value="$(aws_cmd ssm get-parameter --name "$1" --query Parameter.Value --output text --region "$REGION" 2>"$error_file")"; then
    rm -f "$error_file"
    printf '%s' "$value"
    return 0
  fi
  if grep -q 'ParameterNotFound' "$error_file"; then
    rm -f "$error_file"
    return 0
  fi
  cat "$error_file" >&2
  rm -f "$error_file"
  return 1
}

STORED_S3_BUCKET="$(get_param "${PARAM_PREFIX}/s3-bucket")"
S3_BUCKET="${STORED_S3_BUCKET:-${RESOURCE_PREFIX}-${ACCOUNT_ID}}"
if [[ ! "$S3_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  echo "ERROR: S3 bucket name is invalid" >&2
  exit 2
fi
WORKERS_CLEANUP_POLICY_FILE="/tmp/watchdog-bms-workers-object-version-cleanup-policy.json"
sed "s/<S3_BUCKET>/${S3_BUCKET}/g" \
  infra/security/object-version-cleanup-worker-policy.template.json > "$WORKERS_CLEANUP_POLICY_FILE"
if [ "$DEPLOY_ENV" = "uat" ] && [ "$S3_BUCKET" != "watchdog-bms-uat-${ACCOUNT_ID}" ]; then
  echo "ERROR: UAT S3 bucket must be watchdog-bms-uat-${ACCOUNT_ID}" >&2
  exit 2
fi

secret_arn() {
  # Retry transient describe-secret failures. A silently-empty ARN gets dropped
  # by map(select(.valueFrom != "")) below, so a required secret vanishes from
  # the container and prod config validation fails -> canary rollback.
  local id="$1" arn=""
  for _ in 1 2 3; do
    arn="$(aws_cmd secretsmanager describe-secret --secret-id "$id" --query ARN --output text --region "$REGION" 2>/dev/null || true)"
    case "$arn" in
      arn:aws:*) printf '%s' "$arn"; return 0 ;;
    esac
    sleep 2
  done
  printf '%s' "$arn"
}

# preflight, ensure_ecs_roles and ensure_cluster are per-service today. Wave mode
# runs them exactly once before the first wave and exports WATCHDOG_COMMON_ENSURED
# (inherited by the wave subshells) so the concurrent rollouts skip them: they are
# whole-environment work, and ensure_ecs_roles in particular writes SHARED /tmp
# policy files that concurrent runs would tear. Deliberately independent of
# ECS_DEPLOY_MANAGE_IAM — the read-only branch races on nothing but is redundant.
preflight() {
  # Resolve all required references before creating/updating any service or infrastructure.
  # Maintenance may deliberately disable outbound mail but cannot claim customer readiness.
  if [ "$SERVING_EMAIL_PROVIDER" = postmark ]; then
    local mail_name mail_ref mail_arn
    while IFS=$'\t' read -r mail_name mail_ref; do
      mail_arn="$(secret_arn "$mail_ref")"
      case "$mail_arn" in
        arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/"$DEPLOY_ENV"/postmark/*) ;;
        *) echo "ERROR: Required environment-scoped mail/OTP secret is missing: $mail_name" >&2; exit 2 ;;
      esac
    done < <(jq -r '.secrets | to_entries[] | [.key,.value] | @tsv' <<<"$POSTMARK_DEPLOYMENT")
    python3 "$(dirname "${BASH_SOURCE[0]}")/../postmark/config.py" --environment "$DEPLOY_ENV" --preflight
  fi
  if [ "$DEPLOY_ENV" = uat ] && [ "$UAT_RUNTIME_MUTEX_HELD" != true ]; then
    uat_runtime_mutex_acquire "deploy-${TARGET}" || {
      echo "ERROR: UAT Redis migration/deploy mutex is active or cannot be acquired; no service mutation is allowed" >&2
      exit 1
    }
  fi
  if [ -n "${WATCHDOG_COMMON_ENSURED:-}" ]; then
    return 0
  fi
  if [ -z "$PRODUCTION_IMAGE_MANIFEST" ] && ! "$DOCKER_BIN" info >/dev/null 2>&1; then
    echo "ERROR: Docker daemon is not running or not reachable by $DOCKER_BIN" >&2
    exit 1
  fi
  if ! aws_cmd ecs describe-clusters --clusters "$CLUSTER_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo "ERROR: AWS principal cannot describe ECS clusters; grant ECS Express/Fargate permissions before deploy." >&2
    exit 1
  fi
}

manifest_image() {
  jq -er --arg service "$1" --arg repository "$2" \
    '.images[] | select(.service == $service and .repository == $repository) | .image' \
    "$PRODUCTION_IMAGE_MANIFEST"
}

require_api_release_tasks() {
  if [ "$REIMBURSEMENT_BRIDGE_INPUT" = true ]; then
    return 0
  fi
  if [ "${RELEASE_TASKS_APPLIED_SHA:-}" = "$SHA" ]; then
    return 0
  fi
  if [ "$DEPLOY_ENV" = production ] \
    && [ "${RELEASE_DATABASE_COMPATIBILITY_PROVED_SHA:-}" = "$COMMIT" ]; then
    return 0
  fi
  {
    echo "ERROR: API runtime is dist-only and cannot run migrations/admin sync." >&2
    echo "Run an approved release path that proves the exact database catalog for $SHA." >&2
    echo "Production must use RELEASE_DATABASE_COMPATIBILITY_PROVED_SHA from release-prepare; do not fabricate RELEASE_TASKS_APPLIED_SHA." >&2
  }
  exit 1
}

put_secret() {
  local name="$1"
  local value="$2"
  if aws_cmd secretsmanager describe-secret --secret-id "$name" --region "$REGION" >/dev/null 2>&1; then
    aws_cmd secretsmanager put-secret-value --secret-id "$name" --secret-string "$value" --region "$REGION" >/dev/null
  else
    aws_cmd secretsmanager create-secret --name "$name" --secret-string "$value" --region "$REGION" >/dev/null
  fi
}

ensure_pdpa_pseudonymization_secrets() {
  local current_name="${SECRET_PREFIX}/pdpa-pseudonymization-key"
  local previous_name="${SECRET_PREFIX}/pdpa-pseudonymization-previous-keys"
  if ! aws_cmd secretsmanager describe-secret --secret-id "$current_name" --region "$REGION" >/dev/null 2>&1; then
    put_secret "$current_name" "$(openssl rand -hex 32)"
  fi
  if ! aws_cmd secretsmanager describe-secret --secret-id "$previous_name" --region "$REGION" >/dev/null 2>&1; then
    local prior_root
    prior_root="$(aws_cmd secretsmanager get-secret-value --secret-id "${SECRET_PREFIX}/credential-encryption-key" --query SecretString --output text --region "$REGION")"
    case "$prior_root" in
      ''|*[!0-9a-f]*) echo "ERROR: existing credential encryption key is not lowercase 64-hex; cannot bootstrap PDPA lookup compatibility" >&2; exit 1 ;;
    esac
    if [ "${#prior_root}" -ne 64 ]; then
      echo "ERROR: existing credential encryption key is not 64 hex characters; cannot bootstrap PDPA lookup compatibility" >&2
      exit 1
    fi
    put_secret "$previous_name" "$prior_root"
  fi
}

ensure_ai_actor_delegation_secret() {
  local name="${SECRET_PREFIX}/ai-actor-delegation-signing-key"
  if ! aws_cmd secretsmanager describe-secret --secret-id "$name" --region "$REGION" >/dev/null 2>&1; then
    put_secret "$name" "$(openssl rand -hex 32)"
  fi
}

ensure_role() {
  local role_name="$1"
  local trust_json="$2"
  if aws_cmd iam get-role --role-name "$role_name" >/dev/null 2>&1; then
    return 0
  fi
  # get-role can blip transiently even when the role exists; tolerate the
  # resulting EntityAlreadyExists so a network hiccup does not abort the deploy.
  if ! aws_cmd iam create-role --role-name "$role_name" --assume-role-policy-document "$trust_json" >/dev/null 2>&1; then
    if ! aws_cmd iam get-role --role-name "$role_name" >/dev/null 2>&1; then
      echo "ERROR: could not create or find IAM role $role_name" >&2
      exit 1
    fi
  fi
}

ensure_service_linked_role() {
  local service_name="$1"
  local role_name="$2"
  if aws_cmd iam get-role --role-name "$role_name" >/dev/null 2>&1; then
    return
  fi
  if ! aws_cmd iam create-service-linked-role --aws-service-name "$service_name" >/dev/null; then
    echo "ERROR: missing iam:CreateServiceLinkedRole for $service_name ($role_name)" >&2
    exit 1
  fi
}

ensure_ecs_roles() {
  if [ -n "${WATCHDOG_COMMON_ENSURED:-}" ]; then
    return 0
  fi
  if [ "${ECS_DEPLOY_MANAGE_IAM:-true}" = "false" ]; then
    for role_name in \
      AWSServiceRoleForECS \
      AWSServiceRoleForElasticLoadBalancing \
      AWSServiceRoleForApplicationAutoScaling_ECSService \
      "$EXECUTION_ROLE" "$RELEASE_TASK_ROLE" "$INFRA_ROLE" "$API_TASK_ROLE" "$AI_TASK_ROLE" "$WORKERS_TASK_ROLE"; do
      if ! aws_cmd iam get-role --role-name "$role_name" >/dev/null 2>&1; then
        echo "ERROR: required existing IAM role not found: $role_name" >&2
        exit 1
      fi
    done
    local release_policy workers_cleanup_policy
    if ! release_policy="$(aws_cmd iam get-role-policy \
      --role-name "$RELEASE_TASK_ROLE" --policy-name "$RELEASE_TASK_POLICY_NAME" \
      --query PolicyDocument --output json --region "$REGION")"; then
      echo "ERROR: cannot verify inline policy ${RELEASE_TASK_POLICY_NAME} on ${RELEASE_TASK_ROLE}; run the environment control-plane setup first" >&2
      exit 1
    fi
    local expected_ssm_resource="arn:aws:ssm:${REGION}:${ACCOUNT_ID}:parameter${PARAM_PREFIX}/ecs-express-*-service-arn"
    if ! jq -e --arg ssm "$expected_ssm_resource" '
      [.Statement[]? | select(.Effect == "Allow")] as $allows
      | ($allows | length) == 2
        and all($allows[]; has("Action") and (has("NotAction") | not))
        and any($allows[];
          (.Resource == "*" or .Resource == ["*"])
          and ((.Action | if type == "array" then sort else [.] end)
            == (["ecs:DescribeExpressGatewayService", "ecs:DescribeServiceDeployments", "ecs:ListServiceDeployments"] | sort)))
        and any($allows[];
          .Resource == $ssm
          and ((.Action | if type == "array" then sort else [.] end) == ["ssm:GetParameter","ssm:PutParameter"]))
    ' <<< "$release_policy" >/dev/null; then
      echo "ERROR: ${RELEASE_TASK_ROLE} must allow only exact ECS recovery reads and the environment service-cache SSM path; refresh its control-plane policy" >&2
      exit 1
    fi
    if ! workers_cleanup_policy="$(aws_cmd iam get-role-policy \
      --role-name "$WORKERS_TASK_ROLE" --policy-name "$WORKERS_CLEANUP_POLICY_NAME" \
      --query PolicyDocument --output json --region "$REGION")"; then
      echo "ERROR: cannot verify inline policy ${WORKERS_CLEANUP_POLICY_NAME} on ${WORKERS_TASK_ROLE}; run the environment control-plane setup first" >&2
      exit 1
    fi
    printf '%s' "$workers_cleanup_policy" | jq -S . > /tmp/watchdog-bms-workers-cleanup-policy-actual.json
    jq -S . "$WORKERS_CLEANUP_POLICY_FILE" > /tmp/watchdog-bms-workers-cleanup-policy-expected.json
    if ! cmp -s /tmp/watchdog-bms-workers-cleanup-policy-actual.json /tmp/watchdog-bms-workers-cleanup-policy-expected.json; then
      echo "ERROR: ${WORKERS_TASK_ROLE}/${WORKERS_CLEANUP_POLICY_NAME} is not the exact least-privilege object-version cleanup policy" >&2
      exit 1
    fi
    return
  fi

  ensure_service_linked_role "ecs.amazonaws.com" "AWSServiceRoleForECS"
  ensure_service_linked_role "elasticloadbalancing.amazonaws.com" "AWSServiceRoleForElasticLoadBalancing"
  ensure_service_linked_role "ecs.application-autoscaling.amazonaws.com" "AWSServiceRoleForApplicationAutoScaling_ECSService"

  ensure_role "$EXECUTION_ROLE" '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  aws_cmd iam attach-role-policy \
    --role-name "$EXECUTION_ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy >/dev/null 2>&1 || true
  cat > /tmp/watchdog-bms-ecs-execution-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["secretsmanager:GetSecretValue"], "Resource": "arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:${SECRET_PREFIX}/*" },
    { "Effect": "Allow", "Action": ["ssm:GetParameters"], "Resource": "arn:aws:ssm:${REGION}:${ACCOUNT_ID}:parameter${PARAM_PREFIX}/*" }
  ]
}
EOF
  aws_cmd iam put-role-policy \
    --role-name "$EXECUTION_ROLE" \
    --policy-name "$EXECUTION_POLICY_NAME" \
    --policy-document file:///tmp/watchdog-bms-ecs-execution-policy.json

  ensure_role "$RELEASE_TASK_ROLE" '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  cat > /tmp/watchdog-bms-release-task-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["ecs:DescribeExpressGatewayService","ecs:DescribeServiceDeployments","ecs:ListServiceDeployments"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["ssm:GetParameter","ssm:PutParameter"], "Resource": "arn:aws:ssm:${REGION}:${ACCOUNT_ID}:parameter${PARAM_PREFIX}/ecs-express-*-service-arn" }
  ]
}
EOF
  aws_cmd iam put-role-policy \
    --role-name "$RELEASE_TASK_ROLE" \
    --policy-name "$RELEASE_TASK_POLICY_NAME" \
    --policy-document file:///tmp/watchdog-bms-release-task-policy.json

  ensure_role "$INFRA_ROLE" '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs.amazonaws.com"},"Action":"sts:AssumeRole","Sid":"AllowAccessInfrastructureForECSExpressServices"}]}'
  aws_cmd iam attach-role-policy \
    --role-name "$INFRA_ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices >/dev/null 2>&1 || true

  ensure_role "$API_TASK_ROLE" '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  # SES send rights follow the provider gate; Production email remains deferred.
  SES_POLICY_STATEMENT=""
  if [ "$SERVING_EMAIL_PROVIDER" = ses ]; then
    SES_POLICY_STATEMENT=",
    { \"Effect\": \"Allow\", \"Action\": [\"ses:SendEmail\",\"ses:SendRawEmail\"], \"Resource\": \"*\", \"Condition\": { \"StringEquals\": { \"ses:FromAddress\": \"${SES_FROM_ADDRESS_INPUT}\" } } }"
  fi
  cat > /tmp/watchdog-bms-ecs-api-task-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["secretsmanager:GetSecretValue"], "Resource": "arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:${SECRET_PREFIX}/*" },
    { "Effect": "Allow", "Action": ["ssm:GetParameter"], "Resource": "arn:aws:ssm:${REGION}:${ACCOUNT_ID}:parameter${PARAM_PREFIX}/*" },
    { "Effect": "Allow", "Action": ["s3:ListBucketVersions","s3:GetBucketObjectLockConfiguration"], "Resource": "arn:aws:s3:::${S3_BUCKET}" },
    { "Effect": "Allow", "Action": ["s3:GetObject","s3:GetObjectVersion","s3:GetObjectRetention","s3:GetObjectLegalHold","s3:PutObject","s3:DeleteObject"], "Resource": "arn:aws:s3:::${S3_BUCKET}/*" }${SES_POLICY_STATEMENT}
  ]
}
EOF
  aws_cmd iam put-role-policy \
    --role-name "$API_TASK_ROLE" \
    --policy-name "$API_POLICY_NAME" \
    --policy-document file:///tmp/watchdog-bms-ecs-api-task-policy.json

  ensure_role "$AI_TASK_ROLE" '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  local agentcore_arn="${AGENTCORE_RUNTIME_ARN:-}"
  # A malformed ARN does not fail anything at deploy time - the gateway boots green and only fails
  # when a user actually sends a message, as an AgentCore invoke error with no obvious cause. The
  # live service carried one truncated 8 characters short for weeks. Shape-check it here so a bad
  # value cannot reach a task definition.
  if [[ ! "$agentcore_arn" =~ ^arn:aws:bedrock-agentcore:[a-z0-9-]+:[0-9]{12}:runtime/[A-Za-z0-9_]+-[A-Za-z0-9]{10}$ ]]; then
    echo "ERROR: AGENTCORE_RUNTIME_ARN is not a well-formed AgentCore runtime ARN: ${agentcore_arn}" >&2
    exit 2
  fi
  # The foundation-model ARN stays region-wildcarded on purpose. Production runs a
  # `global.` inference profile under the recorded transfer exception, and a global
  # profile invokes the underlying foundation model in whichever region it routes to —
  # pinning that ARN to ${REGION} would deny every request the profile forwards.
  # The inference-profile ARNs are still account- and region-scoped, and only the two
  # prefixes we actually use are permitted. Drop the `global.anthropic.*` entry if the
  # transfer approval is ever withdrawn (see AI_GLOBAL_INFERENCE_PROFILE_APPROVED).
  cat > /tmp/watchdog-bms-ecs-ai-task-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["bedrock-agentcore:InvokeAgentRuntime"], "Resource": ["${agentcore_arn}", "${agentcore_arn}/runtime-endpoint/*"] },
    { "Effect": "Allow", "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], "Resource": ["arn:aws:bedrock:*::foundation-model/anthropic.*", "arn:aws:bedrock:${REGION}:${ACCOUNT_ID}:inference-profile/apac.anthropic.*", "arn:aws:bedrock:${REGION}:${ACCOUNT_ID}:inference-profile/global.anthropic.*"] }
  ]
}
EOF
  aws_cmd iam put-role-policy \
    --role-name "$AI_TASK_ROLE" \
    --policy-name "$AI_POLICY_NAME" \
    --policy-document file:///tmp/watchdog-bms-ecs-ai-task-policy.json

  # Workers otherwise call the API over HTTP. This dedicated task policy grants only exact-version
  # deletion under the three failed-write prefixes; the API task role deliberately lacks it.
  ensure_role "$WORKERS_TASK_ROLE" '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  aws_cmd iam put-role-policy \
    --role-name "$WORKERS_TASK_ROLE" \
    --policy-name "$WORKERS_CLEANUP_POLICY_NAME" \
    --policy-document "file://${WORKERS_CLEANUP_POLICY_FILE}"
}

ensure_cluster() {
  if [ -n "${WATCHDOG_COMMON_ENSURED:-}" ]; then
    return 0
  fi
  local cluster_arn
  cluster_arn="$(aws_cmd ecs describe-clusters --clusters "$CLUSTER_NAME" --query 'clusters[0].clusterArn' --output text --region "$REGION" 2>/dev/null || true)"
  if [ -z "$cluster_arn" ] || [ "$cluster_arn" = "None" ]; then
    aws_cmd ecs create-cluster --cluster-name "$CLUSTER_NAME" --region "$REGION" >/dev/null
  fi
}

ensure_ai_security_group() {
  local vpc_id sg_id
  vpc_id="$(aws_cmd ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text --region "$REGION")"
  sg_id="$(aws_cmd ec2 describe-security-groups --filters Name=group-name,Values="$AI_SG_NAME" Name=vpc-id,Values="$vpc_id" --query 'SecurityGroups[0].GroupId' --output text --region "$REGION" 2>/dev/null || true)"
  if [ -z "$sg_id" ] || [ "$sg_id" = "None" ]; then
    aws_cmd ec2 create-security-group --group-name "$AI_SG_NAME" \
      --description 'WatchDog BMS AI egress; never authorize on RDS or Redis' \
      --vpc-id "$vpc_id" --region "$REGION" >/dev/null
  fi
}

network_json() {
  local vpc_id
  local app_sg
  local subnets
  local subnet_mode="${ECS_EXPRESS_SUBNET_MODE:-public}"
  vpc_id="$(aws_cmd ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text --region "$REGION")"
  local security_group_name="${1:-$APP_SG_NAME}"
  app_sg="$(aws_cmd ec2 describe-security-groups --filters Name=group-name,Values="$security_group_name" Name=vpc-id,Values="$vpc_id" --query 'SecurityGroups[0].GroupId' --output text --region "$REGION")"
  if [ "$subnet_mode" = "private" ]; then
    subnets="$(aws_cmd ec2 describe-subnets \
      --filters Name=tag:Name,Values=watchdog-bms-prod-app-private-a,watchdog-bms-prod-app-private-b Name=vpc-id,Values="$vpc_id" \
      --query 'Subnets[].SubnetId' --output json --region "$REGION")"
  else
    subnets="$(aws_cmd ec2 describe-subnets \
      --filters Name=vpc-id,Values="$vpc_id" \
      --query 'Subnets[?MapPublicIpOnLaunch==`true`].SubnetId' --output json --region "$REGION")"
  fi
  if [ -z "$app_sg" ] || [ "$app_sg" = "None" ] || [ "$subnets" = "[]" ]; then
    echo "ERROR: expected existing ${DEPLOY_ENV} ${subnet_mode} subnets and ${security_group_name}; run the environment bootstrap before ECS deploy." >&2
    exit 1
  fi
  jq -n --arg sg "$app_sg" --argjson subnets "$subnets" '{securityGroups:[$sg], subnets:$subnets}'
}

ensure_log_group() {
  local log_group="$1"
  local metric_name
  metric_name="$(tr '/-' '_' <<<"$log_group" | tr -cd '[:alnum:]_')"
  aws_cmd logs create-log-group --log-group-name "$log_group" --region "$REGION" >/dev/null 2>&1 || true
  aws_cmd logs put-retention-policy --log-group-name "$log_group" --retention-in-days "$LOG_RETENTION_DAYS" --region "$REGION"
  if [ -n "$LOG_KMS_KEY_ID" ]; then
    aws_cmd logs associate-kms-key --log-group-name "$log_group" --kms-key-id "$LOG_KMS_KEY_ID" --region "$REGION"
  fi
  if [[ "$log_group" == *"-api-web" ]]; then
    aws_cmd logs put-metric-filter \
      --log-group-name "$log_group" \
      --filter-name line-ai-accepted \
      --filter-pattern '{ $.msg = "line.ai.accepted" }' \
      --metric-transformations "metricName=${metric_name}_line_ai_accepted,metricNamespace=WatchDog/LineAI,metricValue=1,defaultValue=0" \
      --region "$REGION"
    local terminal_class
    for terminal_class in delivered clarification intentional_noop permission_refusal feature_disabled \
      budget_refusal provider_unavailable timeout delivery_pending failed_terminal; do
      aws_cmd logs put-metric-filter \
        --log-group-name "$log_group" \
        --filter-name "line-ai-terminal-${terminal_class}" \
        --filter-pattern "{ \$.msg = \"line.ai.terminal\" && \$.terminalClass = \"${terminal_class}\" }" \
        --metric-transformations "metricName=${metric_name}_line_ai_${terminal_class},metricNamespace=WatchDog/LineAI,metricValue=1,defaultValue=0" \
        --region "$REGION"
    done
  fi
  if [ -n "$SECURITY_ALERT_TOPIC_ARN" ]; then
    aws_cmd logs put-metric-filter \
      --log-group-name "$log_group" \
      --filter-name security-high-risk \
      --filter-pattern '{ ($.riskLevel = "CRITICAL") || ($.riskLevel = "HIGH") || ($.msg = "ai.provider.failure") || ($.msg = "ai.tool.invoke.denied") }' \
      --metric-transformations "metricName=${metric_name},metricNamespace=WatchDog/Security,metricValue=1,defaultValue=0" \
      --region "$REGION"
    aws_cmd cloudwatch put-metric-alarm \
      --alarm-name "${RESOURCE_PREFIX}-${metric_name}-security" \
      --namespace WatchDog/Security \
      --metric-name "$metric_name" \
      --statistic Sum \
      --period 60 \
      --evaluation-periods 1 \
      --datapoints-to-alarm 1 \
      --threshold 1 \
      --comparison-operator GreaterThanOrEqualToThreshold \
      --treat-missing-data notBreaching \
      --alarm-actions "$SECURITY_ALERT_TOPIC_ARN" \
      --region "$REGION"
  fi
}

ecr_login() {
  aws_cmd ecr get-login-password --region "$REGION" \
    | "$DOCKER_BIN" login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com" >/dev/null
}

build_clean_image() {
  local dockerfile="$1"
  local image="$2"
  shift 2
  SOURCE_COMMIT="$COMMIT" bash infra/docker/build-clean-production-image.sh "$DOCKER_BIN" "$dockerfile" "$image" "$@"
}

immutable_image_ref() {
  local repository="$1"
  local tagged_image="$2"
  local tag="${tagged_image##*:}"
  local digest
  digest="$(aws_cmd ecr describe-images \
    --repository-name "$repository" \
    --image-ids "imageTag=$tag" \
    --query 'imageDetails[0].imageDigest' \
    --output text \
    --region "$REGION")"
  case "$digest" in
    sha256:*) printf '%s@%s' "${tagged_image%:*}" "$digest" ;;
    *) echo "ERROR: ECR did not return an immutable digest for $tagged_image" >&2; exit 1 ;;
  esac
}

normalize_url() {
  case "$1" in
    http*) printf '%s' "${1%/}" ;;
    *) printf 'https://%s' "${1%/}" ;;
  esac
}

ensure_s3_upload_controls() {
  aws_cmd s3api put-bucket-versioning \
    --bucket "$S3_BUCKET" \
    --versioning-configuration Status=Enabled \
    --region "$REGION" >/dev/null
  aws_cmd s3api put-bucket-lifecycle-configuration \
    --bucket "$S3_BUCKET" \
    --lifecycle-configuration file://infra/object-storage-lifecycle.json \
    --region "$REGION" >/dev/null
  if [ "$(aws_cmd s3api get-bucket-versioning --bucket "$S3_BUCKET" --query Status --output text --region "$REGION")" != "Enabled" ]; then
    echo "ERROR: S3 versioning is required for immutable evidence" >&2
    exit 1
  fi
  local lifecycle_actual lifecycle_expected
  lifecycle_actual="$(mktemp "${TMPDIR:-/tmp}/watchdog-s3-lifecycle-actual.XXXXXX")"
  lifecycle_expected="$(mktemp "${TMPDIR:-/tmp}/watchdog-s3-lifecycle-expected.XXXXXX")"
  aws_cmd s3api get-bucket-lifecycle-configuration --bucket "$S3_BUCKET" --region "$REGION" \
    | jq -S '{Rules:(.Rules|sort_by(.ID))}' > "$lifecycle_actual"
  jq -S '{Rules:(.Rules|sort_by(.ID))}' infra/object-storage-lifecycle.json > "$lifecycle_expected"
  if ! cmp -s "$lifecycle_actual" "$lifecycle_expected"; then
    echo "ERROR: S3 lifecycle readback differs from infra/object-storage-lifecycle.json" >&2
    rm -f "$lifecycle_actual" "$lifecycle_expected"
    exit 1
  fi
  rm -f "$lifecycle_actual" "$lifecycle_expected"
}

ensure_s3_cors() {
  # The browser PUTs the receipt straight to the presigned S3 URL, so the bucket
  # itself answers the preflight. Without a CORS rule S3 replies 403 and every
  # upload dies as "Failed to fetch".
  local origins=""
  if [ -n "${PUBLIC_DOMAIN_URL:-}" ]; then
    origins="$(normalize_url "$PUBLIC_DOMAIN_URL")"
  fi
  local web_url
  web_url="$(get_param "${PARAM_PREFIX}/web-public-base-url")"
  if [ -n "$web_url" ]; then
    origins="${origins}${origins:+$'\n'}$(normalize_url "$web_url")"
  fi
  if [ -z "$origins" ]; then
    echo "ERROR: no origin for S3 CORS (set PUBLIC_DOMAIN_URL or deploy api-web first)" >&2
    exit 1
  fi

  printf '%s\n' "$origins" | jq -Rs '{
    CORSRules: [{
      AllowedOrigins: (split("\n") | map(select(length > 0)) | unique),
      AllowedMethods: ["PUT", "GET", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag", "x-amz-version-id"],
      MaxAgeSeconds: 3000
    }]
  }' > /tmp/watchdog-bms-s3-cors.json

  # Non-fatal: the deploy principal may only hold object-level S3 rights. Warn
  # loudly rather than fail a deploy that has already rolled out successfully.
  if ! aws_cmd s3api put-bucket-cors \
    --bucket "$S3_BUCKET" \
    --cors-configuration file:///tmp/watchdog-bms-s3-cors.json \
    --region "$REGION"; then
    echo "[s3-cors] WARN: cannot set CORS on $S3_BUCKET (needs s3:PutBucketCORS)." >&2
    echo "[s3-cors] WARN: receipt uploads will fail until this is applied manually:" >&2
    cat /tmp/watchdog-bms-s3-cors.json >&2
    return 0
  fi
  echo "[s3-cors] bucket=$S3_BUCKET origins=$(echo "$origins" | tr '\n' ' ')"
}

service_url() {
  local arn="$1"
  # H-14: private-subnet ECS Express services expose a PRIVATE ingress path
  # instead of PUBLIC; callers pick which endpoint kind they expect.
  local access_type="${2:-PUBLIC}"
  local endpoint
  endpoint="$(aws_cmd ecs describe-express-gateway-service \
    --service-arn "$arn" \
    --query "service.activeConfigurations[0].ingressPaths[?accessType==\`${access_type}\`].endpoint | [0]" \
    --output text --region "$REGION" 2>/dev/null || true)"
  if [ -z "$endpoint" ] || [ "$endpoint" = "None" ]; then
    return 1
  fi
  normalize_url "$endpoint"
}

# shellcheck source=infra/prod-ecs-express/lib-wait-for-service-url.sh
. "$(dirname "$0")/lib-wait-for-service-url.sh"
# shellcheck source=infra/prod-ecs-express/lib-uat-fast-rollout.sh
. "$(dirname "$0")/lib-uat-fast-rollout.sh"
# shellcheck source=infra/prod-ecs-express/lib-prod-rollout-config.sh
. "$(dirname "$0")/lib-prod-rollout-config.sh"

record_deployment_evidence() {
  local service_name="$1" service_arn="$2" deployment_arn="$3" target_revision="$4" proven_noop="$5"
  [ -n "${DEPLOYMENT_EVIDENCE_DIR:-}" ] || return 0
  if [ "$proven_noop" != "true" ] && { [ -z "$deployment_arn" ] || [ "$deployment_arn" = "None" ]; }; then
    echo "ERROR: no exact deployment ARN was captured for ${service_name}" >&2
    return 1
  fi
  local key="$service_name"
  case "$service_name" in
    *api-web*) key="api-web" ;;
    *ai-gateway*) key="ai-gateway" ;;
    *workers*) key="workers" ;;
  esac
  local evidence_id
  evidence_id="${deployment_arn:-$target_revision}"
  evidence_id="${evidence_id##*/}"
  if [[ ! "$evidence_id" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "ERROR: ${service_name} evidence has no safe exact deployment/revision identity" >&2
    return 1
  fi
  mkdir -p "$DEPLOYMENT_EVIDENCE_DIR/history"
  jq -n \
    --arg service "$key" --arg serviceArn "$service_arn" --arg deploymentArn "$deployment_arn" \
    --arg targetRevisionArn "$target_revision" --arg sourceSha "$COMMIT" --argjson noOp "$proven_noop" \
    '{service:$service,serviceArn:$serviceArn,deploymentArn:(if $deploymentArn == "" then null else $deploymentArn end),
      targetRevisionArn:$targetRevisionArn,sourceSha:$sourceSha,noOp:$noOp}' \
    > "$DEPLOYMENT_EVIDENCE_DIR/${key}.json.tmp"
  mv "$DEPLOYMENT_EVIDENCE_DIR/${key}.json.tmp" "$DEPLOYMENT_EVIDENCE_DIR/${key}.json"
  # Canonical `<service>.json` is the latest record used by api retirement. History is append-only
  # because bootstrap/config drift can legitimately roll the same service more than once.
  cp "$DEPLOYMENT_EVIDENCE_DIR/${key}.json" \
    "$DEPLOYMENT_EVIDENCE_DIR/history/${key}-${evidence_id}-${proven_noop}.json"
}

bind_release_operation_evidence() {
  local service_name="$1" mutation_intent_id="$2" key="$1"
  [ -n "${RELEASE_PARENT_OPERATION_ID:-}" ] || return 0
  case "$service_name" in
    *api-web*) key="api-web" ;;
    *ai-gateway*) key="ai-gateway" ;;
    *workers*) key="workers" ;;
  esac
  if [ -z "${RELEASE_TASK_IMAGE:-}" ] || [ -z "${DEPLOYMENT_EVIDENCE_DIR:-}" ] \
    || [ ! -f "$DEPLOYMENT_EVIDENCE_DIR/${key}.json" ]; then
    echo "ERROR: held release operation cannot bind ${key}: release image/evidence is missing" >&2
    exit 1
  fi
  echo "[release-operation] binding exact ${key} deployment before rollout wait" >&2
  RELEASE_MUTATION_INTENT_ID="$mutation_intent_id" \
    RELEASE_DEPLOYMENT_MANIFEST_JSON="$(jq -c '[.]' "$DEPLOYMENT_EVIDENCE_DIR/${key}.json")" \
    bash "$(dirname "$0")/run-release-task.sh" "$RELEASE_TASK_IMAGE" "$COMMIT" release-bind >&2 || return $?
}

# Normalize only fields shared by an update request and an ECS activeConfiguration. Generated
# deployment metadata is deliberately excluded; the hash represents the requested runtime config.
runtime_config_filter='{
  executionRoleArn,
  taskRoleArn,
  cpu:(.cpu|tostring),
  memory:(.memory|tostring),
  networkConfiguration:{
    securityGroups:((.networkConfiguration.securityGroups // [])|sort),
    subnets:((.networkConfiguration.subnets // [])|sort)
  },
  healthCheckPath,
  primaryContainer:{
    image:.primaryContainer.image,
    containerPort:.primaryContainer.containerPort,
    awsLogsConfiguration:(.primaryContainer.awsLogsConfiguration // null),
    repositoryCredentials:(.primaryContainer.repositoryCredentials // null),
    command:((.primaryContainer.command // [])),
    environment:((.primaryContainer.environment // [])|sort_by(.name,.value)),
    secrets:((.primaryContainer.secrets // [])|sort_by(.name,.valueFrom))
  },
  scalingTarget
}'

sha256_text() {
  shasum -a 256 | awk '{print $1}'
}

prepare_release_operation_intent() {
  local service_name="$1" mutation_kind="$2" expected_service_arn="$3" request_file="$4"
  local before_deployments_file="$5" before_service_file="$6" ssm_parameter_name="$7" service_key="$service_name"
  case "$service_name" in
    *api-web*) service_key="api-web" ;;
    *ai-gateway*) service_key="ai-gateway" ;;
    *workers*) service_key="workers" ;;
  esac
  if [ "$PARTIAL_INCIDENT_READONLY_INPUT" = true ]; then
    printf '%s' incident-readonly-no-database-intent
    return 0
  fi
  if [ "$MAINTENANCE_BOOTSTRAP_READONLY_INPUT" = true ]; then
    printf '%s' maintenance-bootstrap-no-database-intent
    return 0
  fi
  if [ "$REIMBURSEMENT_BRIDGE_INPUT" = true ]; then
    printf '%s' reimbursement-bridge-no-database-intent
    return 0
  fi
  local intent_id request_hash desired_config_hash descriptors_file legacy_descriptor="null"
  intent_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  request_hash="$(jq -cS . "$request_file" | sha256_text)"
  desired_config_hash="$(jq -cS "$runtime_config_filter" "$request_file" | sha256_text)"
  descriptors_file="/tmp/watchdog-bms-ecs-express-before-descriptors-${service_name}.json"
  : > "${descriptors_file}.rows"
  while IFS= read -r configuration; do
    [ -n "$configuration" ] || continue
    local revision source_sha image config_hash
    revision="$(jq -r '.serviceRevisionArn // empty' <<< "$configuration")"
    source_sha="$(jq -r '[.primaryContainer.environment[]? | select(.name == "GIT_SHA") | .value] | if length == 1 then .[0] else "" end' <<< "$configuration")"
    image="$(jq -r '.primaryContainer.image // empty' <<< "$configuration")"
    config_hash="$(jq -cS "$runtime_config_filter" <<< "$configuration" | sha256_text)"
    if [[ ! "$revision" =~ ^arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service-revision/${CLUSTER_NAME}/${service_name}/[^/]+$ ]] \
      || [[ ! "$source_sha" =~ ^([0-9a-f]{12}|[0-9a-f]{40})$ ]] || [ -z "$image" ]; then
      echo "ERROR: ${service_name} has an incomplete active configuration; refusing remote mutation intent" >&2
      return 1
    fi
    jq -cn --arg revisionArn "$revision" --arg sourceSha "$source_sha" \
      --arg configHash "$config_hash" --arg image "$image" \
      '{revisionArn:$revisionArn,sourceSha:$sourceSha,configHash:$configHash,image:$image}' \
      >> "${descriptors_file}.rows"
  done < <(jq -c '.activeConfigurations[]?' "$before_service_file")
  jq -s 'sort_by(.revisionArn)' "${descriptors_file}.rows" > "$descriptors_file"
  if [ "$service_key" = "api-web" ] \
    && [ "$mutation_kind" = "UPDATE" ] \
    && jq -e '.currentDeployment == null' "$before_service_file" >/dev/null \
    && [ "$(jq 'length' "$descriptors_file")" -eq 1 ] \
    && jq -e '.[0].sourceSha | test("^[0-9a-f]{12}$")' "$descriptors_file" >/dev/null; then
    legacy_descriptor="$(jq -c '.[0]' "$descriptors_file")"
    if [ "$service_key" = "api-web" ] && [ -n "${DEPLOYMENT_EVIDENCE_DIR:-}" ]; then
      mkdir -p "$DEPLOYMENT_EVIDENCE_DIR"
      jq -cn --arg serviceArn "$expected_service_arn" --argjson descriptor "$legacy_descriptor" \
        '{serviceArn:$serviceArn,descriptor:$descriptor}' \
        > "$DEPLOYMENT_EVIDENCE_DIR/legacy-api-web.json.tmp"
      mv "$DEPLOYMENT_EVIDENCE_DIR/legacy-api-web.json.tmp" "$DEPLOYMENT_EVIDENCE_DIR/legacy-api-web.json"
    fi
  fi
  local intent_json
  intent_json="$(jq -cn \
    --arg id "$intent_id" --arg serviceKey "$service_key" --arg mutationKind "$mutation_kind" \
    --arg expectedServiceArn "$expected_service_arn" --arg clusterName "$CLUSTER_NAME" \
    --arg serviceName "$service_name" --arg ssmParameterName "$ssm_parameter_name" --arg requestHash "$request_hash" \
    --arg desiredConfigHash "$desired_config_hash" \
    --argjson beforeDeploymentArns "$(jq -c 'sort|unique' "$before_deployments_file")" \
    --arg beforeCurrentDeploymentArn "$(jq -r '.currentDeployment // empty' "$before_service_file")" \
    --argjson beforeActiveConfigurations "$(jq -c . "$descriptors_file")" \
    --argjson legacyBootstrapDescriptor "$legacy_descriptor" \
    '{id:$id,serviceKey:$serviceKey,mutationKind:$mutationKind,expectedServiceArn:$expectedServiceArn,
      clusterName:$clusterName,serviceName:$serviceName,ssmParameterName:$ssmParameterName,requestHash:$requestHash,
      desiredConfigHash:$desiredConfigHash,beforeDeploymentArns:$beforeDeploymentArns,
      beforeCurrentDeploymentArn:(if $beforeCurrentDeploymentArn == "" then null else $beforeCurrentDeploymentArn end),
      beforeActiveConfigurations:$beforeActiveConfigurations,
      legacyBootstrapDescriptor:$legacyBootstrapDescriptor}')"
  RELEASE_MUTATION_INTENT_JSON="$intent_json" \
    bash "$(dirname "$0")/run-release-task.sh" "$RELEASE_TASK_IMAGE" "$COMMIT" release-intent >&2 || return $?
  printf '%s' "$intent_id"
}

deploy_express_service() {
  local service_name="$1"
  local service_arn_param="$2"
  local container_file="$3"
  local task_role="$4"
  local health_path="$5"
  local cpu="$6"
  local memory="$7"
  local security_group_name="${8:-$APP_SG_NAME}"
  local access_type="${9:-PUBLIC}"
  local service_arn
  local expected_deployment=""
  local target_revision=""
  local proven_noop="false"
  local creating="false"
  local request_start_epoch=""
  local create_bound=""
  local update_result=""
  local bind_code=0
  local mutation_intent_id=""
  # Per service, not per script: wave mode calls this concurrently, and a shared
  # request file would let one service's container definition be deployed into
  # another service between the write and the aws CLI read.
  local create_request="/tmp/watchdog-bms-ecs-express-create-${service_name}.json"
  local create_response="/tmp/watchdog-bms-ecs-express-create-response-${service_name}.json"
  local update_request="/tmp/watchdog-bms-ecs-express-update-${service_name}.json"
  local before_deployments="/tmp/watchdog-bms-ecs-express-before-deployments-${service_name}.json"
  local before_deployments_response="/tmp/watchdog-bms-ecs-express-before-deployments-response-${service_name}.json"
  local before_service="/tmp/watchdog-bms-ecs-express-before-service-${service_name}.json"
  service_arn="$(get_param "$service_arn_param")" || return $?
  if { [ "$PARTIAL_INCIDENT_READONLY_INPUT" = true ] \
    || [ "$REIMBURSEMENT_BRIDGE_INPUT" = true ] \
    || [ "$MAINTENANCE_BOOTSTRAP_READONLY_INPUT" = true ]; } \
    && { [ -z "$service_arn" ] || [ "$service_arn" = None ]; }; then
    echo "ERROR: no-database rollout cannot create a service" >&2
    return 1
  fi

  local execution_role_arn="arn:aws:iam::${ACCOUNT_ID}:role/${EXECUTION_ROLE}"
  local infra_role_arn="arn:aws:iam::${ACCOUNT_ID}:role/${INFRA_ROLE}"
  local task_role_arn="arn:aws:iam::${ACCOUNT_ID}:role/${task_role}"
  local network
  network="$(network_json "$security_group_name")"

  if [ -z "$service_arn" ] || [ "$service_arn" = "None" ]; then
    creating="true"
    service_arn="arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/${CLUSTER_NAME}/${service_name}"
    printf '[]\n' > "$before_deployments"
    printf '{"currentDeployment":null,"activeRevisions":[],"activeConfigurations":[]}\n' > "$before_service"
    jq -n \
      --arg executionRoleArn "$execution_role_arn" \
      --arg infrastructureRoleArn "$infra_role_arn" \
      --arg serviceName "$service_name" \
      --arg cluster "$CLUSTER_NAME" \
      --arg healthCheckPath "$health_path" \
      --arg taskRoleArn "$task_role_arn" \
      --arg cpu "$cpu" \
      --arg memory "$memory" \
      --argjson primaryContainer "$(cat "$container_file")" \
      --argjson networkConfiguration "$network" \
      --argjson minTaskCount "$EXPRESS_MIN_TASKS" \
      --argjson maxTaskCount "$EXPRESS_MAX_TASKS" \
      '{
        executionRoleArn: $executionRoleArn,
        infrastructureRoleArn: $infrastructureRoleArn,
        serviceName: $serviceName,
        cluster: $cluster,
        healthCheckPath: $healthCheckPath,
        primaryContainer: $primaryContainer,
        taskRoleArn: $taskRoleArn,
        networkConfiguration: $networkConfiguration,
        cpu: $cpu,
        memory: $memory,
        scalingTarget: {minTaskCount: $minTaskCount, maxTaskCount: $maxTaskCount, autoScalingMetric: "AVERAGE_CPU", autoScalingTargetValue: 70}
      }' > "$create_request"
    mutation_intent_id="$(prepare_release_operation_intent "$service_name" CREATE "$service_arn" \
      "$create_request" "$before_deployments" "$before_service" "$service_arn_param")" || return $?
    request_start_epoch="$(date -u +%s)"
    if ! aws_cmd ecs create-express-gateway-service \
      --cli-input-json "file://${create_request}" \
      --query 'service.{serviceArn:serviceArn,currentDeployment:currentDeployment,activeRevisions:activeConfigurations[].serviceRevisionArn}' \
      --output json --region "$REGION" > "$create_response"; then
      echo "ERROR: failed to create ECS Express service ${service_name}" >&2
      exit 1
    fi
    create_bound="$(AWS_BIN="$AWS_BIN" AWS_REGION="$REGION" \
      bash "$(dirname "$0")/bind-express-create.sh" --response "$create_response" \
        --cluster "$CLUSTER_NAME" --service-name "$service_name" --region "$REGION" --account "$ACCOUNT_ID")"
    if [ "$(jq -r '.serviceArn' <<< "$create_bound")" != "$service_arn" ]; then
      echo "ERROR: created service ARN differs from the durable expected ARN; state is UNKNOWN" >&2
      exit 1
    fi
    expected_deployment="$(jq -r '.deploymentArn' <<< "$create_bound")"
    target_revision="$(jq -r '.targetRevisionArn' <<< "$create_bound")"
  else
    ensure_uat_fast_rollout_configuration "$service_name" || return $?
    ensure_prod_rollout_configuration "$service_name" || return $?
    AWS_BIN="$AWS_BIN" AWS_REGION="$REGION" \
      bash "$(dirname "$0")/list-service-deployments-all.sh" \
        --service-arn "$service_arn" > "$before_deployments_response" || return $?
    if ! jq -e '.nextToken == null' "$before_deployments_response" >/dev/null; then
      echo "ERROR: recent before-deployment snapshot is paginated; refusing to prepare a non-exhaustive intent" >&2
      exit 1
    fi
    jq -c '[.serviceDeployments[].serviceDeploymentArn] | sort | unique' \
      "$before_deployments_response" > "$before_deployments"
    aws_cmd ecs describe-express-gateway-service \
      --service-arn "$service_arn" \
      --query 'service.{currentDeployment:currentDeployment,activeRevisions:activeConfigurations[].serviceRevisionArn,activeConfigurations:activeConfigurations}' \
      --output json --region "$REGION" > "$before_service" || return $?
    jq -n \
      --arg serviceArn "$service_arn" \
      --arg executionRoleArn "$execution_role_arn" \
      --arg healthCheckPath "$health_path" \
      --arg taskRoleArn "$task_role_arn" \
      --arg cpu "$cpu" \
      --arg memory "$memory" \
      --argjson primaryContainer "$(cat "$container_file")" \
      --argjson networkConfiguration "$network" \
      --argjson minTaskCount "$EXPRESS_MIN_TASKS" \
      --argjson maxTaskCount "$EXPRESS_MAX_TASKS" \
      '{
        serviceArn: $serviceArn,
        executionRoleArn: $executionRoleArn,
        healthCheckPath: $healthCheckPath,
        primaryContainer: $primaryContainer,
        taskRoleArn: $taskRoleArn,
        networkConfiguration: $networkConfiguration,
        cpu: $cpu,
        memory: $memory,
        scalingTarget: {minTaskCount: $minTaskCount, maxTaskCount: $maxTaskCount, autoScalingMetric: "AVERAGE_CPU", autoScalingTargetValue: 70}
      }' > "$update_request"
    mutation_intent_id="$(prepare_release_operation_intent "$service_name" UPDATE "$service_arn" \
      "$update_request" "$before_deployments" "$before_service" "$service_arn_param")" || return $?
    request_start_epoch="$(date -u +%s)"
    update_result="$(aws_cmd ecs update-express-gateway-service \
      --cli-input-json "file://${update_request}" \
      --query 'service.{targetRevision:targetConfiguration.serviceRevisionArn}' \
      --output json --region "$REGION")" || return $?
    target_revision="$(jq -r '.targetRevision // empty' <<< "$update_result")"
  fi

  if [[ ! "$target_revision" =~ ^arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service-revision/${CLUSTER_NAME}/${service_name}/[^/]+$ ]]; then
    echo "ERROR: ECS Express did not return the exact target service revision; state is UNKNOWN" >&2
    exit 1
  fi

  if [ "$creating" = "false" ]; then
    bind_code=0
    expected_deployment="$(AWS_BIN="$AWS_BIN" AWS_REGION="$REGION" \
      bash "$(dirname "$0")/bind-express-deployment.sh" \
        --service-arn "$service_arn" --target-revision "$target_revision" \
        --request-start-epoch "$request_start_epoch" --before-file "$before_deployments")" || bind_code=$?
    if [ "$bind_code" -ne 0 ]; then
      if [ "$bind_code" -eq 75 ] \
        && jq -e --arg target "$target_revision" \
          '[.activeConfigurations[].serviceRevisionArn] == [$target]' "$before_service" >/dev/null; then
        # No new deployment exists and ECS returned the already-serving exact revision: the only
        # proven no-op shape. Persist it explicitly and skip retirement; never borrow an older ARN.
        proven_noop="true"
        expected_deployment=""
      else
        echo "ERROR: ECS update could not be causally bound to exactly one deployment; state is UNKNOWN" >&2
        exit 1
      fi
    fi
  fi

  if [ "$proven_noop" = "false" ]; then
    record_deployment_evidence "$service_name" "$service_arn" "$expected_deployment" "$target_revision" "$proven_noop" || return $?
    bind_release_operation_evidence "$service_name" "$mutation_intent_id" || return $?
    if [ "$creating" = "true" ]; then
      # The exact service identity is already durable before this cache write. A runner death here
      # is recovered by the intent workflow, which can safely repair this one SSM parameter.
      put_param "$service_arn_param" "$service_arn" || return $?
    fi
  fi
  wait_for_service_url "$service_arn" "$access_type" "$expected_deployment" "$target_revision" "$proven_noop" \
    "$before_deployments" "$before_service" || return $?
  if [ "$proven_noop" = "true" ]; then
    record_deployment_evidence "$service_name" "$service_arn" "$expected_deployment" "$target_revision" "$proven_noop" || return $?
    bind_release_operation_evidence "$service_name" "$mutation_intent_id" || return $?
  fi
  verify_uat_fast_rollout_configuration "$service_name" || return $?
  verify_prod_rollout_configuration "$service_name" || return $?
}

api_container_json() {
  local image="$1"
  local public_base_url="$2"
  local ai_gateway_url="$3"
  # Public identity URL (custom domain in front of the ECS endpoint, e.g. Cloudflare).
  # Defaults to the AWS endpoint so unset = current behavior. Internal wiring below stays on $public_base_url.
  local public_web_url
  public_web_url="$(normalize_url "${PUBLIC_DOMAIN_URL:-$public_base_url}")"
  if [ "$SERVING_EMAIL_PROVIDER" = postmark ]; then
    local expected_mail_origin=https://mangmeeplus.com
    [ "$DEPLOY_ENV" != uat ] || expected_mail_origin=https://uat.mangmeeplus.com
    if [ "$public_web_url" != "$expected_mail_origin" ]; then
      echo "ERROR: Postmark web origin does not match environment" >&2; return 2
    fi
  fi
  local resolved_postmark="$POSTMARK_DEPLOYMENT" mail_name mail_ref mail_arn
  while IFS=$'\t' read -r mail_name mail_ref; do
    [ -n "$mail_name" ] || continue
    mail_arn="$(secret_arn "$mail_ref")"
    case "$mail_arn" in
      arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/"$DEPLOY_ENV"/postmark/*) ;;
      *) echo "ERROR: Required environment-scoped mail/OTP secret is missing: $mail_name" >&2; return 2 ;;
    esac
    resolved_postmark="$(jq --arg name "$mail_name" --arg arn "$mail_arn" '.secrets[$name]=$arn' <<<"$resolved_postmark")"
  done < <(jq -r '.secrets | to_entries[] | [.key,.value] | @tsv' <<<"$POSTMARK_DEPLOYMENT")
  local line_account_link_url="${WEB_LINE_ACCOUNT_LINK_URL:-}"
  if [ -z "$line_account_link_url" ] && [ -n "${LINE_LIFF_ID:-}" ]; then
    line_account_link_url="https://liff.line.me/${LINE_LIFF_ID}"
  fi
  jq -n \
    --arg image "$image" \
    --arg sha "$SHA" \
    --arg commit "$COMMIT" \
    --arg deployEnvironment "$DEPLOY_ENV" \
    --arg productionServingMode "$PRODUCTION_SERVING_MODE_INPUT" \
    --arg globalMaintenanceMode "$SERVING_MAINTENANCE_ACTIVE" \
    --arg publicBaseUrl "$public_base_url" \
    --arg publicWebUrl "$public_web_url" \
    --arg aiGatewayUrl "$ai_gateway_url" \
    --arg s3Bucket "$S3_BUCKET" \
    --arg region "$REGION" \
    --arg lineLoginChannelId "${LINE_LOGIN_CHANNEL_ID:-}" \
    --arg lineLiffId "${LINE_LIFF_ID:-}" \
    --arg lineMessagingChannelId "${LINE_MESSAGING_CHANNEL_ID:-}" \
    --arg lineAccountLinkUrl "$line_account_link_url" \
    --arg lineOaAddUrl "${LINE_OA_ADD_URL:-}" \
    --arg lineOaQrImageUrl "${LINE_OA_QR_IMAGE_URL:-}" \
    --arg lineAccountLinkQrImageUrl "${LINE_ACCOUNT_LINK_QR_IMAGE_URL:-}" \
    --arg crmAutoReplyEnabled "$SERVING_CRM_AUTO_REPLY_ENABLED" \
    --arg aiEnabled "$SERVING_AI_ENABLED" \
    --arg lineWebLoginEnabled "$SERVING_LINE_WEB_LOGIN_ENABLED" \
    --arg lineWebHandoffEnabled "$SERVING_LINE_WEB_HANDOFF_ENABLED" \
    --arg lineAiExactGreetingEnabled "$SERVING_LINE_AI_EXACT_GREETING_ENABLED" \
    --arg lineAiAdvisorMode "$SERVING_LINE_AI_ADVISOR_MODE" \
    --arg lineAiLoadingOnAcceptEnabled "$SERVING_LINE_AI_LOADING_ON_ACCEPT_ENABLED" \
    --arg lineAiBufferDebounceMs "$LINE_AI_BUFFER_DEBOUNCE_MS_INPUT" \
    --arg lineAiDebounceExperimentEnabled "$SERVING_LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED" \
    --arg externalSignupEnabled "$SERVING_EXTERNAL_SIGNUP_ENABLED" \
    --arg lineSignupEnabled "$SERVING_LINE_SIGNUP_ENABLED" \
    --arg lineSignupApprovalMode "$LINE_SIGNUP_APPROVAL_MODE_INPUT" \
    --arg lineSignupAutoDailyCap "$LINE_SIGNUP_AUTO_DAILY_CAP_INPUT" \
    --arg lineSignupWarmupSlips "$LINE_SIGNUP_WARMUP_SLIPS_INPUT" \
    --arg lineFreeAiBudgetSatang "$LINE_FREE_AI_BUDGET_SATANG_INPUT" \
    --arg lineSignupAdminReminderMinutes "$LINE_SIGNUP_ADMIN_REMINDER_MINUTES_INPUT" \
    --arg lineSignupAdminAlertBudgetExhaustedPerDay "$LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY_INPUT" \
    --arg lineSignupBusinessDays "$LINE_SIGNUP_BUSINESS_DAYS_INPUT" \
    --arg lineSignupBusinessHours "$LINE_SIGNUP_BUSINESS_HOURS_INPUT" \
    --arg receiptQuotaEnforced "$SERVING_RECEIPT_QUOTA_ENFORCED" \
    --arg emailProvider "$SERVING_EMAIL_PROVIDER" \
    --argjson postmark "$resolved_postmark" \
    --arg sesRegion "$SES_REGION_INPUT" \
    --arg sesFromAddress "$SES_FROM_ADDRESS_INPUT" \
    --arg emailLogoUrl "${EMAIL_LOGO_URL:-${public_web_url}/brand/logo-mangmeeyangyuen.png}" \
    --arg sesConfigurationSet "$SES_CONFIGURATION_SET_VALUE" \
    --arg sesEventsTopicArn "$SES_EVENTS_TOPIC_ARN_VALUE" \
    --arg lineAiFusedPlanShadowEnabled "$SERVING_LINE_AI_FUSED_PLAN_SHADOW_ENABLED" \
    --arg lineAiPreparedSimpleReadEnabled "$SERVING_LINE_AI_PREPARED_SIMPLE_READ_ENABLED" \
    --arg lineAiDraftEditEnabled "$SERVING_LINE_AI_DRAFT_EDIT_ENABLED" \
    --arg aiBudgetSplitActivationEnabled "$SERVING_AI_BUDGET_SPLIT_ACTIVATION_ENABLED" \
    --arg lineExpenseDraftConversationEnabled "$SERVING_LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED" \
    --arg lineAiTerminalOutcomeReplayEnabled "$SERVING_LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED" \
    --arg lineAiFlexTextFallbackEnabled "$SERVING_LINE_AI_FLEX_TEXT_FALLBACK_ENABLED" \
    --arg lineAiMultipartTerminalFlexEnabled "$SERVING_LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED" \
    --arg crmAiMinConfidence "${CRM_AI_MIN_CONFIDENCE:-0.7}" \
    --arg crmAiOutboundAllowedDomains "${CRM_AI_OUTBOUND_ALLOWED_DOMAINS:-}" \
    --arg workflowWebhookAllowedHosts "$WORKFLOW_WEBHOOK_ALLOWED_HOSTS" \
    --arg clamAvHost "$CLAMAV_HOST" \
    --arg clamAvPort "${CLAMAV_PORT:-3310}" \
    --arg clamAvTimeoutMs "${CLAMAV_TIMEOUT_MS:-5000}" \
    --arg aiDataRetentionDays "${AI_DATA_RETENTION_DAYS:-90}" \
    --arg aiLlmMaxPerCompany "${AI_LLM_MAX_PER_COMPANY:-60}" \
    --arg aiOcrMaxPerCompany "${AI_OCR_MAX_PER_COMPANY:-20}" \
    --arg aiRateLimitWindowSeconds "${AI_RATE_LIMIT_WINDOW_SECONDS:-60}" \
    --arg aiThbPerUsd "${AI_THB_PER_USD:-33}" \
    --arg aiMonthlyBudgetSatang "${AI_MONTHLY_BUDGET_SATANG:-200000}" \
    --arg aiMonthlyBudgetSatangCeiling "${AI_MONTHLY_BUDGET_SATANG_CEILING:-1000000}" \
    --arg passwordResetResponseMinMs "${PASSWORD_RESET_RESPONSE_MIN_MS:-300}" \
    --arg sessionRefreshMaxPerSession "${SESSION_REFRESH_MAX_PER_SESSION:-30}" \
    --arg sessionRefreshWindowSeconds "${SESSION_REFRESH_WINDOW_SECONDS:-60}" \
    --arg sessionRefreshReuseGraceSeconds "${SESSION_REFRESH_REUSE_GRACE_SECONDS:-30}" \
    --arg reimbursementWriteQuiesce "$REIMBURSEMENT_WRITE_QUIESCE_INPUT" \
    --arg databaseUrl "$(secret_arn "${SECRET_PREFIX}/database-url")" \
    --arg redisUrl "$(secret_arn "${SECRET_PREFIX}/redis-url")" \
    --arg lineLoginSecret "$(secret_arn "${SECRET_PREFIX}/line-login-channel-secret")" \
    --arg lineMsgSecret "$(secret_arn "${SECRET_PREFIX}/line-messaging-channel-secret")" \
    --arg lineMsgToken "$(secret_arn "${SECRET_PREFIX}/line-messaging-channel-access-token")" \
    --arg aiSecret "$(secret_arn "${SECRET_PREFIX}/ai-gateway-internal-secret")" \
    --arg actorDelegationKey "$(secret_arn "${SECRET_PREFIX}/ai-actor-delegation-signing-key")" \
    --arg workerToken "$(secret_arn "${SECRET_PREFIX}/worker-internal-token")" \
    --arg jwtSecret "$(secret_arn "${SECRET_PREFIX}/watchdog-jwt-secret")" \
    --arg credentialKey "$(secret_arn "${SECRET_PREFIX}/credential-encryption-key")" \
    --arg pdpaKey "$(secret_arn "${SECRET_PREFIX}/pdpa-pseudonymization-key")" \
    --arg pdpaPreviousKeys "$(secret_arn "${SECRET_PREFIX}/pdpa-pseudonymization-previous-keys")" \
    --arg lineAiDebounceExperimentSecret "$(secret_arn "${SECRET_PREFIX}/line-ai-debounce-experiment-secret" 2>/dev/null || true)" \
    --arg logGroup "/ecs/${RESOURCE_PREFIX}-api-web" \
    --arg jwtAudience "watchdog-bms-${DEPLOY_ENV}" \
    '{
      image: $image,
      containerPort: 3000,
      awsLogsConfiguration: {logGroup: $logGroup, logStreamPrefix: "api-web"},
      environment: ([
        {name:"NODE_ENV", value:"production"},
        {name:"APP_ENV", value:"production"},
        {name:"DEPLOY_ENVIRONMENT", value:$deployEnvironment},
        {name:"PRODUCTION_SERVING_MODE", value:$productionServingMode},
        {name:"GLOBAL_MAINTENANCE_MODE", value:$globalMaintenanceMode},
        {name:"SERVICE_NAME", value:"watchdog-api"},
        {name:"SERVICE_VERSION", value:$sha},
        {name:"GIT_SHA", value:$commit},
        {name:"HOST", value:"0.0.0.0"},
        {name:"PORT", value:"3000"},
        {name:"API_PORT", value:"3001"},
        {name:"WEB_PORT", value:"3002"},
        {name:"PUBLIC_BASE_URL", value:$publicWebUrl},
        {name:"WEB_BASE_URL", value:$publicWebUrl},
        {name:"CORS_ALLOWED_ORIGINS", value:$publicWebUrl},
        {name:"INTERNAL_API_URL", value:($publicBaseUrl + "/v1")},
        {name:"NEXT_PUBLIC_API_BASE_URL", value:"/api"},
        {name:"NEXT_PUBLIC_API_URL", value:"/api"},
        {name:"NEXT_PUBLIC_AI_GATEWAY_BASE_URL", value:"/api"},
        {name:"NEXT_PUBLIC_APP_ENV", value:"production"},
        {name:"AUTH_PROVIDER", value:"line"},
        {name:"DEV_AUTH_ENABLED", value:"false"},
        {name:"LINE_LOGIN_CHANNEL_ID", value:$lineLoginChannelId},
        {name:"LINE_LIFF_ID", value:$lineLiffId},
        {name:"NEXT_PUBLIC_LIFF_ID", value:$lineLiffId},
        {name:"LINE_MESSAGING_CHANNEL_ID", value:$lineMessagingChannelId},
        {name:"LINE_ACCOUNT_LINK_URL", value:$lineAccountLinkUrl},
        {name:"NEXT_PUBLIC_LINE_ACCOUNT_LINK_URL", value:$lineAccountLinkUrl},
        {name:"LINE_OA_ADD_URL", value:$lineOaAddUrl},
        {name:"NEXT_PUBLIC_LINE_OA_ADD_URL", value:$lineOaAddUrl},
        {name:"LINE_OA_QR_IMAGE_URL", value:$lineOaQrImageUrl},
        {name:"NEXT_PUBLIC_LINE_OA_QR_IMAGE_URL", value:$lineOaQrImageUrl},
        {name:"LINE_ACCOUNT_LINK_QR_IMAGE_URL", value:$lineAccountLinkQrImageUrl},
        {name:"NEXT_PUBLIC_LINE_ACCOUNT_LINK_QR_IMAGE_URL", value:$lineAccountLinkQrImageUrl},
        {name:"AI_GATEWAY_INTERNAL_URL", value:$aiGatewayUrl},
        {name:"AI_GATEWAY_ENABLED", value:$aiEnabled},
        {name:"LINE_AI_LEDGER_ENABLED", value:$aiEnabled},
        {name:"LINE_WEB_LOGIN_ENABLED", value:$lineWebLoginEnabled},
        {name:"LINE_WEB_HANDOFF_ENABLED", value:$lineWebHandoffEnabled},
        {name:"LINE_AI_EXACT_GREETING_ENABLED", value:$lineAiExactGreetingEnabled},
        {name:"LINE_AI_ADVISOR_MODE", value:$lineAiAdvisorMode},
        {name:"LINE_AI_LOADING_ON_ACCEPT_ENABLED", value:$lineAiLoadingOnAcceptEnabled},
        {name:"LINE_AI_BUFFER_DEBOUNCE_MS", value:$lineAiBufferDebounceMs},
        {name:"LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED", value:$lineAiDebounceExperimentEnabled},
        {name:"EXTERNAL_SIGNUP_ENABLED", value:$externalSignupEnabled},
        {name:"LINE_SIGNUP_ENABLED", value:$lineSignupEnabled},
        {name:"LINE_SIGNUP_APPROVAL_MODE", value:$lineSignupApprovalMode},
        {name:"LINE_SIGNUP_AUTO_DAILY_CAP", value:$lineSignupAutoDailyCap},
        {name:"LINE_SIGNUP_WARMUP_SLIPS", value:$lineSignupWarmupSlips},
        {name:"LINE_FREE_AI_BUDGET_SATANG", value:$lineFreeAiBudgetSatang},
        {name:"LINE_SIGNUP_ADMIN_REMINDER_MINUTES", value:$lineSignupAdminReminderMinutes},
        {name:"LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY", value:$lineSignupAdminAlertBudgetExhaustedPerDay},
        {name:"LINE_SIGNUP_BUSINESS_DAYS", value:$lineSignupBusinessDays},
        {name:"LINE_SIGNUP_BUSINESS_HOURS", value:$lineSignupBusinessHours},
        {name:"RECEIPT_QUOTA_ENFORCED", value:$receiptQuotaEnforced},
        {name:"EMAIL_PROVIDER", value:$emailProvider},
        {name:"SES_REGION", value:$sesRegion},
        {name:"SES_FROM_ADDRESS", value:$sesFromAddress},
        {name:"EMAIL_LOGO_URL", value:$emailLogoUrl},
        {name:"SES_CONFIGURATION_SET", value:$sesConfigurationSet},
        {name:"SES_EVENTS_TOPIC_ARN", value:$sesEventsTopicArn},
        {name:"LINE_AI_FUSED_PLAN_SHADOW_ENABLED", value:$lineAiFusedPlanShadowEnabled},
        {name:"LINE_AI_PREPARED_SIMPLE_READ_ENABLED", value:$lineAiPreparedSimpleReadEnabled},
        {name:"LINE_AI_DRAFT_EDIT_ENABLED", value:$lineAiDraftEditEnabled},
        {name:"AI_BUDGET_SPLIT_ACTIVATION_ENABLED", value:$aiBudgetSplitActivationEnabled},
        {name:"LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED", value:$lineExpenseDraftConversationEnabled},
        {name:"LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED", value:$lineAiTerminalOutcomeReplayEnabled},
        {name:"LINE_AI_FLEX_TEXT_FALLBACK_ENABLED", value:$lineAiFlexTextFallbackEnabled},
        {name:"LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED", value:$lineAiMultipartTerminalFlexEnabled},
        {name:"WATCHDOG_JWT_ISSUER", value:$publicWebUrl},
        {name:"WATCHDOG_JWT_AUDIENCE", value:$jwtAudience},
        {name:"S3_BUCKET", value:$s3Bucket},
        {name:"S3_REGION", value:$region},
        {name:"RATE_LIMIT_ENABLED", value:"true"},
        {name:"RATE_LIMIT_WINDOW_SECONDS", value:"60"},
        {name:"RATE_LIMIT_MAX_REQUESTS", value:"120"},
        {name:"CRM_AUTO_REPLY_ENABLED", value:$crmAutoReplyEnabled},
        {name:"CRM_AI_MIN_CONFIDENCE", value:$crmAiMinConfidence},
        {name:"CRM_AI_OUTBOUND_ALLOWED_DOMAINS", value:$crmAiOutboundAllowedDomains},
        {name:"WORKFLOW_WEBHOOK_ALLOWED_HOSTS", value:$workflowWebhookAllowedHosts},
        {name:"CLAMAV_HOST", value:$clamAvHost},
        {name:"CLAMAV_PORT", value:$clamAvPort},
        {name:"CLAMAV_TIMEOUT_MS", value:$clamAvTimeoutMs},
        {name:"AI_DATA_RETENTION_DAYS", value:$aiDataRetentionDays},
        {name:"AI_LLM_MAX_PER_COMPANY", value:$aiLlmMaxPerCompany},
        {name:"AI_OCR_MAX_PER_COMPANY", value:$aiOcrMaxPerCompany},
        {name:"AI_RATE_LIMIT_WINDOW_SECONDS", value:$aiRateLimitWindowSeconds},
        {name:"AI_THB_PER_USD", value:$aiThbPerUsd},
        {name:"AI_MONTHLY_BUDGET_SATANG", value:$aiMonthlyBudgetSatang},
        {name:"AI_MONTHLY_BUDGET_SATANG_CEILING", value:$aiMonthlyBudgetSatangCeiling},
        {name:"PASSWORD_RESET_RESPONSE_MIN_MS", value:$passwordResetResponseMinMs},
        {name:"SESSION_REFRESH_MAX_PER_SESSION", value:$sessionRefreshMaxPerSession},
        {name:"SESSION_REFRESH_WINDOW_SECONDS", value:$sessionRefreshWindowSeconds},
        {name:"SESSION_REFRESH_REUSE_GRACE_SECONDS", value:$sessionRefreshReuseGraceSeconds},
        {name:"REIMBURSEMENT_WRITE_QUIESCE", value:$reimbursementWriteQuiesce},
        {name:"LOG_FORMAT", value:"json"},
        {name:"LOG_REDACTION_ENABLED", value:"true"},
        {name:"AUDIT_ENABLED", value:"true"},
        {name:"SWAGGER_ENABLED", value:"false"}
      ] + ($postmark.environment | to_entries | map({name:.key, value:.value}))),
      secrets: ([
        {name:"DATABASE_URL", valueFrom:$databaseUrl},
        {name:"REDIS_URL", valueFrom:$redisUrl},
        {name:"LINE_LOGIN_CHANNEL_SECRET", valueFrom:$lineLoginSecret},
        {name:"LINE_MESSAGING_CHANNEL_SECRET", valueFrom:$lineMsgSecret},
        {name:"LINE_MESSAGING_CHANNEL_ACCESS_TOKEN", valueFrom:$lineMsgToken},
        {name:"AI_GATEWAY_INTERNAL_SECRET", valueFrom:$aiSecret},
        {name:"AI_ACTOR_DELEGATION_SIGNING_KEY", valueFrom:$actorDelegationKey},
        {name:"WORKER_INTERNAL_TOKEN", valueFrom:$workerToken},
        {name:"WATCHDOG_JWT_SECRET_ARN", valueFrom:$jwtSecret},
        {name:"CREDENTIAL_ENCRYPTION_KEY", valueFrom:$credentialKey},
        {name:"PDPA_PSEUDONYMIZATION_KEY", valueFrom:$pdpaKey},
        {name:"PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS", valueFrom:$pdpaPreviousKeys},
        {name:"LINE_AI_DEBOUNCE_EXPERIMENT_SECRET", valueFrom:$lineAiDebounceExperimentSecret}
      ] + ($postmark.secrets | to_entries | map({name:.key, valueFrom:.value})) | map(select(.valueFrom != "")))
    }'
}

ai_container_json() {
  local image="$1"
  local public_base_url="$2"
  local erp_core_url="$3"
  local api_web_url="$4"
  # L-04: the gateway verifies the very tokens the API signs, so iss/aud must resolve to the
  # API's identity, not this service's own URL. Same expression as api_container_json on
  # purpose — a divergence here boots a green gateway that 401s every authenticated request.
  local public_web_url
  public_web_url="$(normalize_url "${PUBLIC_DOMAIN_URL:-$api_web_url}")"
  local agentcore_arn="${AGENTCORE_RUNTIME_ARN:-}"
  local agentcore_qualifier="${AGENTCORE_RUNTIME_QUALIFIER:-}"
  local agentcore_expected_source="${AGENTCORE_EXPECTED_SOURCE_COMMIT:-}"
  local agentcore_expected_artifact="${AGENTCORE_EXPECTED_ARTIFACT_SHA256:-}"
  local agentcore_expected_contract="${AGENTCORE_EXPECTED_CONTRACT_VERSION:-}"
  local line_ai_runtime="${LINE_AI_AGENT_RUNTIME:-}"
  # A malformed ARN does not fail anything at deploy time - the gateway boots green and only fails
  # when a user actually sends a message, as an AgentCore invoke error with no obvious cause. The
  # live service carried one truncated 8 characters short for weeks. Shape-check it here so a bad
  # value cannot reach a task definition.
  if [[ ! "$agentcore_arn" =~ ^arn:aws:bedrock-agentcore:[a-z0-9-]+:[0-9]{12}:runtime/[A-Za-z0-9_]+-[A-Za-z0-9]{10}$ ]]; then
    echo "ERROR: AGENTCORE_RUNTIME_ARN is not a well-formed AgentCore runtime ARN: ${agentcore_arn}" >&2
    exit 2
  fi
  if [ "$line_ai_runtime" != agentcore ]; then
    echo 'ERROR: deployed AI Gateway must use the signed AgentCore candidate path' >&2
    exit 2
  fi
  if [[ ! "$agentcore_qualifier" =~ ^candidate_(uat|production)_[0-9a-f]{12}_[0-9a-f]{8}$ ]]; then
    echo 'ERROR: AGENTCORE_RUNTIME_QUALIFIER must be a source-and-artifact-specific candidate endpoint' >&2
    exit 2
  fi
  if { [ "$DEPLOY_ENV" = production ] && [[ "$agentcore_qualifier" != candidate_production_* ]]; } \
      || { [ "$DEPLOY_ENV" = uat ] && [[ "$agentcore_qualifier" != candidate_uat_* ]]; }; then
    echo 'ERROR: AgentCore qualifier belongs to a different deployment environment' >&2
    exit 2
  fi
  [[ "$agentcore_expected_source" =~ ^[0-9a-f]{40}$ ]] \
    || { echo 'ERROR: AGENTCORE_EXPECTED_SOURCE_COMMIT must be the signed candidate source' >&2; exit 2; }
  [[ "$agentcore_expected_artifact" =~ ^[0-9a-f]{64}$ ]] \
    || { echo 'ERROR: AGENTCORE_EXPECTED_ARTIFACT_SHA256 must be the retained CodeZip hash' >&2; exit 2; }
  [[ "$agentcore_expected_contract" =~ ^[1-9][0-9]*$ ]] \
    || { echo 'ERROR: AGENTCORE_EXPECTED_CONTRACT_VERSION must be a positive integer' >&2; exit 2; }
  [ "$agentcore_expected_source" = "$COMMIT" ] \
    || { echo 'ERROR: AgentCore expected source differs from the ECS image source' >&2; exit 2; }
  [ "$agentcore_qualifier" = "candidate_${DEPLOY_ENV}_${agentcore_expected_source:0:12}_${agentcore_expected_artifact:0:8}" ] \
    || { echo 'ERROR: AgentCore qualifier differs from the signed source and artifact' >&2; exit 2; }
  jq -n \
    --arg image "$image" \
    --arg sha "$SHA" \
    --arg commit "$COMMIT" \
    --arg deployEnvironment "$DEPLOY_ENV" \
    --arg productionServingMode "$PRODUCTION_SERVING_MODE_INPUT" \
    --arg publicBaseUrl "$public_base_url" \
    --arg erpCoreUrl "$erp_core_url" \
    --arg agentcoreArn "$agentcore_arn" \
    --arg agentcoreRegion "${AGENTCORE_REGION:-$REGION}" \
    --arg region "$REGION" \
    --arg agentcoreQualifier "$agentcore_qualifier" \
    --arg agentcoreExpectedSource "$agentcore_expected_source" \
    --arg agentcoreExpectedArtifact "$agentcore_expected_artifact" \
    --arg agentcoreExpectedContract "$agentcore_expected_contract" \
    --arg agentcoreTimeout "${AGENTCORE_INVOKE_TIMEOUT_MS:-20000}" \
    --arg agentcoreMaxBodyBytes "${AGENTCORE_MAX_BODY_BYTES:-1048576}" \
    --arg agentcoreMaxMessageChars "${AGENTCORE_MAX_MESSAGE_CHARS:-8000}" \
    --arg agentcoreMaxAttachments "${AGENTCORE_MAX_ATTACHMENTS:-10}" \
    --arg agentcoreMaxConcurrentInvocations "${AGENTCORE_MAX_CONCURRENT_INVOCATIONS:-16}" \
    --arg modelProvider "$SERVING_MODEL_PROVIDER" \
    --arg aiEnabled "$SERVING_AI_ENABLED" \
    --arg approvedAiProviders "${APPROVED_AI_PROVIDERS:-}" \
    --arg approvedAiModelIds "${APPROVED_AI_MODEL_IDS:-}" \
    --arg approvedAiRegions "${APPROVED_AI_REGIONS:-}" \
    --arg globalProfileApproved "${AI_GLOBAL_INFERENCE_PROFILE_APPROVED:-}" \
    --arg globalProfileApprovalRef "${AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF:-}" \
    --arg openAiProcessingRegion "${OPENAI_PROCESSING_REGION:-}" \
    --arg bedrockRegion "${BEDROCK_REGION:-}" \
    --arg bedrockModelId "${BEDROCK_MODEL_ID:-}" \
    --arg documentAiModelId "${DOCUMENT_AI_MODEL_ID:-}" \
    --arg lineAiAgentRuntime "$line_ai_runtime" \
    --arg lineAiFusedPlanShadowEnabled "$SERVING_LINE_AI_FUSED_PLAN_SHADOW_ENABLED" \
    --arg lineAiPreparedSimpleReadEnabled "$SERVING_LINE_AI_PREPARED_SIMPLE_READ_ENABLED" \
    --arg lineAiDeterministicResponseFamilies "$SERVING_LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES" \
    --arg lineAiDraftEditEnabled "$SERVING_LINE_AI_DRAFT_EDIT_ENABLED" \
    --arg aiSecret "$(secret_arn "${SECRET_PREFIX}/ai-gateway-internal-secret")" \
    --arg jwtSecret "$(secret_arn "${SECRET_PREFIX}/watchdog-jwt-secret")" \
    --arg publicWebUrl "$public_web_url" \
    --arg jwtAudience "watchdog-bms-${DEPLOY_ENV}" \
    --arg logGroup "/ecs/${RESOURCE_PREFIX}-ai-gateway" \
    '{
      image: $image,
      containerPort: 3002,
      awsLogsConfiguration: {logGroup: $logGroup, logStreamPrefix: "ai-gateway"},
      environment: ([
        {name:"NODE_ENV", value:"production"},
        {name:"APP_ENV", value:"production"},
        {name:"DEPLOY_ENVIRONMENT", value:$deployEnvironment},
        {name:"PRODUCTION_SERVING_MODE", value:$productionServingMode},
        {name:"SERVICE_NAME", value:"ai-gateway"},
        {name:"SERVICE_VERSION", value:$sha},
        {name:"GIT_SHA", value:$commit},
        {name:"HOST", value:"0.0.0.0"},
        {name:"PORT", value:"3002"},
        {name:"PUBLIC_BASE_URL", value:$publicBaseUrl},
        {name:"CORS_ALLOWED_ORIGINS", value:$publicBaseUrl},
        {name:"AWS_REGION", value:$region},
        {name:"MODEL_PROVIDER", value:$modelProvider},
        {name:"APPROVED_AI_PROVIDERS", value:$approvedAiProviders},
        {name:"APPROVED_AI_MODEL_IDS", value:$approvedAiModelIds},
        {name:"APPROVED_AI_REGIONS", value:$approvedAiRegions},
        {name:"AI_GLOBAL_INFERENCE_PROFILE_APPROVED", value:$globalProfileApproved},
        {name:"AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF", value:$globalProfileApprovalRef},
        {name:"OPENAI_PROCESSING_REGION", value:$openAiProcessingRegion},
        {name:"BEDROCK_REGION", value:$bedrockRegion},
        {name:"BEDROCK_MODEL_ID", value:$bedrockModelId},
        {name:"DOCUMENT_AI_MODEL_ID", value:$documentAiModelId},
        {name:"LINE_AI_AGENT_ORCHESTRATION_ENABLED", value:$aiEnabled},
        {name:"LINE_AI_TOOLUSE_LOOP_ENABLED", value:$aiEnabled},
        {name:"LINE_AI_COVERAGE_CRITIC_ENABLED", value:$aiEnabled},
        {name:"LINE_AI_AGENT_RUNTIME", value:$lineAiAgentRuntime},
        {name:"LINE_AI_FUSED_PLAN_SHADOW_ENABLED", value:$lineAiFusedPlanShadowEnabled},
        {name:"LINE_AI_PREPARED_SIMPLE_READ_ENABLED", value:$lineAiPreparedSimpleReadEnabled},
        {name:"LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES", value:$lineAiDeterministicResponseFamilies},
        {name:"LINE_AI_DRAFT_EDIT_ENABLED", value:$lineAiDraftEditEnabled},
        {name:"AGENTCORE_REGION", value:$agentcoreRegion},
        {name:"AGENTCORE_RUNTIME_ARN", value:$agentcoreArn},
        {name:"AGENTCORE_RUNTIME_QUALIFIER", value:$agentcoreQualifier},
        {name:"AGENTCORE_EXPECTED_SOURCE_COMMIT", value:$agentcoreExpectedSource},
        {name:"AGENTCORE_EXPECTED_ARTIFACT_SHA256", value:$agentcoreExpectedArtifact},
        {name:"AGENTCORE_EXPECTED_CONTRACT_VERSION", value:$agentcoreExpectedContract},
        {name:"AGENTCORE_INVOKE_TIMEOUT_MS", value:$agentcoreTimeout},
        {name:"AGENTCORE_MAX_BODY_BYTES", value:$agentcoreMaxBodyBytes},
        {name:"AGENTCORE_MAX_MESSAGE_CHARS", value:$agentcoreMaxMessageChars},
        {name:"AGENTCORE_MAX_ATTACHMENTS", value:$agentcoreMaxAttachments},
        {name:"AGENTCORE_MAX_CONCURRENT_INVOCATIONS", value:$agentcoreMaxConcurrentInvocations},
        {name:"ERP_CORE_INTERNAL_URL", value:$erpCoreUrl},
        {name:"WATCHDOG_JWT_ISSUER", value:$publicWebUrl},
        {name:"WATCHDOG_JWT_AUDIENCE", value:$jwtAudience},
        {name:"AI_TOOL_TIMEOUT_MS", value:"15000"},
        {name:"AI_MAX_TOOL_CALLS", value:"8"},
        {name:"AI_GATEWAY_ENABLED", value:$aiEnabled},
        {name:"AI_AGENT_REGISTRY_ENABLED", value:$aiEnabled},
        {name:"AI_TOOL_POLICY_ENFORCED", value:$aiEnabled},
        {name:"AI_TOOL_AUDIT_ENABLED", value:$aiEnabled},
        {name:"AI_FINAL_MUTATION_ENABLED", value:"false"},
        {name:"AI_PROMPT_LOGGING_ENABLED", value:"false"},
        {name:"LOG_FORMAT", value:"json"},
        {name:"LOG_REDACTION_ENABLED", value:"true"},
        {name:"SWAGGER_ENABLED", value:"false"}
      ] | map(select(.value != ""))),
      secrets: ([
        {name:"AI_GATEWAY_INTERNAL_SECRET", valueFrom:$aiSecret},
        {name:"WATCHDOG_JWT_SECRET_ARN", valueFrom:$jwtSecret}
      ] | map(select(.valueFrom != "")))
    }'
}

deploy_api_web() {
  preflight
  # H-14: api-web must stay PUBLIC (web + LINE webhook + Cloudflare origin). Its
  # subnet type is immutable, so honoring ECS_EXPRESS_SUBNET_MODE=private here
  # would push private subnets into the existing public service and wedge the
  # only public-facing deploy path. Refuse rather than corrupt it.
  if [ "${ECS_EXPRESS_SUBNET_MODE:-public}" = "private" ]; then
    echo "ERROR: api-web cannot deploy with ECS_EXPRESS_SUBNET_MODE=private (it must stay public)." >&2
    echo "Deploy ai-gateway/workers privately as individual targets; see docs/runbooks/h-14-private-ingress-cutover-runbook.md" >&2
    exit 1
  fi
  require_api_release_tasks
  for key in LINE_LOGIN_CHANNEL_ID LINE_LIFF_ID LINE_MESSAGING_CHANNEL_ID; do
    if [ -z "${!key:-}" ]; then
      echo "ERROR: $key is required in .env or environment for ECS API/Web deploy" >&2
      exit 1
    fi
  done
  ensure_ecs_roles
  ensure_cluster
  ensure_log_group "/ecs/${RESOURCE_PREFIX}-api-web"
  ensure_pdpa_pseudonymization_secrets
  ensure_ai_actor_delegation_secret

  local repo="watchdog-bms-api"
  local image="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${repo}:ecs-api-web-${SHA}"
  local current_url
  current_url="$(get_param "${PARAM_PREFIX}/ecs-express-api-web-url")"
  current_url="${current_url:-https://watchdog-bms-api-web-placeholder.invalid}"
  local ai_gateway_url
  ai_gateway_url="$(get_param "${PARAM_PREFIX}/ai-gateway-internal-url")"
  ai_gateway_url="${ai_gateway_url:-https://watchdog-bms-ai-placeholder.invalid/v1}"

  echo "[ecs-api-web] account=$ACCOUNT_ID region=$REGION sha=$SHA"
  if [ -n "$PRODUCTION_IMAGE_MANIFEST" ]; then
    image="$(manifest_image api-web "$repo")"
  else
    aws_cmd ecr describe-repositories --repository-names "$repo" --region "$REGION" >/dev/null 2>&1 || \
      aws_cmd ecr create-repository --repository-name "$repo" --image-scanning-configuration scanOnPush=true --region "$REGION" >/dev/null
    ecr_login
    build_clean_image infra/api-web/Dockerfile.api-web "$image" \
      --platform linux/amd64 \
      --provenance=false \
      --build-arg INTERNAL_API_URL="${current_url}/v1" \
      --build-arg NEXT_PUBLIC_API_BASE_URL="/api" \
      --build-arg NEXT_PUBLIC_AI_GATEWAY_BASE_URL="/api" \
      --build-arg NEXT_PUBLIC_LINE_OA_URL="${NEXT_PUBLIC_LINE_OA_URL:-}"
    "$DOCKER_BIN" push "$image"
    image="$(immutable_image_ref "$repo" "$image")"
  fi

  api_container_json "$image" "$current_url" "$ai_gateway_url" > /tmp/watchdog-bms-ecs-api-web-container.json
  # Reports can write report-export/ objects as soon as this build serves traffic. Apply and read
  # back the exact retention policy before the first external ECS mutation, never after cutover.
  ensure_s3_upload_controls
  local new_url
  # watchdog-bms-api-web (original name) is held by the first private-ingress service;
  # subnet type cannot change on update and the deploy principal lacks delete permission.
  new_url="$(deploy_express_service "$API_SERVICE_NAME" "${PARAM_PREFIX}/ecs-express-api-web-service-arn" /tmp/watchdog-bms-ecs-api-web-container.json "$API_TASK_ROLE" /v1/health 2048 6144)" || return $?
  if [ "$new_url" != "$current_url" ]; then
    api_container_json "$image" "$new_url" "$ai_gateway_url" > /tmp/watchdog-bms-ecs-api-web-container.json
    new_url="$(deploy_express_service "$API_SERVICE_NAME" "${PARAM_PREFIX}/ecs-express-api-web-service-arn" /tmp/watchdog-bms-ecs-api-web-container.json "$API_TASK_ROLE" /v1/health 2048 6144)" || return $?
  fi

  put_param "${PARAM_PREFIX}/ecs-express-api-web-url" "$new_url"
  put_param "${PARAM_PREFIX}/api-public-base-url" "$new_url"
  put_param "${PARAM_PREFIX}/web-public-base-url" "$new_url"
  put_param "${PARAM_PREFIX}/erp-core-internal-url" "${new_url}/v1"
  put_param "${PARAM_PREFIX}/service-version" "$SHA"
  ensure_s3_cors
  echo "[ecs-api-web] URL: $new_url"
}

deploy_ai_gateway() {
  preflight
  ensure_ecs_roles
  ensure_cluster
  ensure_ai_security_group
  ensure_log_group "/ecs/${RESOURCE_PREFIX}-ai-gateway"

  local repo="watchdog-bms-ai-gateway"
  local image="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${repo}:ecs-${SHA}"
  local current_url
  current_url="$(get_param "${PARAM_PREFIX}/ecs-express-ai-gateway-url")"
  current_url="${current_url:-https://watchdog-bms-ai-gateway-placeholder.invalid}"
  local erp_core_url
  erp_core_url="$(get_param "${PARAM_PREFIX}/erp-core-internal-url")"
  erp_core_url="${erp_core_url:-https://watchdog-bms-api-web-placeholder.invalid/v1}"
  # L-04: the JWT issuer must be the API's public identity. Refuse rather than fall back to a
  # placeholder — a wrong-but-non-empty issuer passes prod config validation and then rejects
  # every token, which is far harder to diagnose than a failed deploy.
  local api_web_url
  api_web_url="$(get_param "${PARAM_PREFIX}/ecs-express-api-web-url")"
  if [ -z "$api_web_url" ] && [ -z "${PUBLIC_DOMAIN_URL:-}" ]; then
    echo "ERROR: no JWT issuer origin for the AI Gateway (set PUBLIC_DOMAIN_URL or deploy api-web first)" >&2
    exit 1
  fi

  echo "[ecs-ai-gateway] account=$ACCOUNT_ID region=$REGION sha=$SHA"
  if [ -n "$PRODUCTION_IMAGE_MANIFEST" ]; then
    image="$(manifest_image ai-gateway "$repo")"
  else
    aws_cmd ecr describe-repositories --repository-names "$repo" --region "$REGION" >/dev/null 2>&1 || \
      aws_cmd ecr create-repository --repository-name "$repo" --image-scanning-configuration scanOnPush=true --region "$REGION" >/dev/null
    ecr_login
    build_clean_image apps/ai-gateway/Dockerfile "$image" --platform linux/amd64 --provenance=false
    "$DOCKER_BIN" push "$image"
    image="$(immutable_image_ref "$repo" "$image")"
  fi

  # H-14: ECS Express subnet type is immutable per service, so private mode
  # deploys a SEPARATE service + ARN param alongside the public one. Shared
  # params (ai-gateway-internal-url) are only flipped manually after the
  # operator verifies api-web -> private endpoint reachability — see
  # docs/runbooks/h-14-private-ingress-cutover-runbook.md.
  local service_name="$AI_SERVICE_NAME"
  local arn_param="${PARAM_PREFIX}/ecs-express-ai-gateway-service-arn"
  local access_type="PUBLIC"
  if [ "${ECS_EXPRESS_SUBNET_MODE:-public}" = "private" ]; then
    service_name="${AI_SERVICE_NAME}-priv"
    arn_param="${PARAM_PREFIX}/ecs-express-ai-gateway-priv-service-arn"
    access_type="PRIVATE"
  fi

  ai_container_json "$image" "$current_url" "$erp_core_url" "$api_web_url" > /tmp/watchdog-bms-ecs-ai-gateway-container.json
  local new_url
  new_url="$(deploy_express_service "$service_name" "$arn_param" /tmp/watchdog-bms-ecs-ai-gateway-container.json "$AI_TASK_ROLE" /v1/health 1024 2048 "$AI_SG_NAME" "$access_type")" || return $?
  if [ "$new_url" != "$current_url" ]; then
    ai_container_json "$image" "$new_url" "$erp_core_url" "$api_web_url" > /tmp/watchdog-bms-ecs-ai-gateway-container.json
    new_url="$(deploy_express_service "$service_name" "$arn_param" /tmp/watchdog-bms-ecs-ai-gateway-container.json "$AI_TASK_ROLE" /v1/health 1024 2048 "$AI_SG_NAME" "$access_type")" || return $?
  fi

  if [ "$access_type" = "PRIVATE" ]; then
    put_param "${PARAM_PREFIX}/ecs-express-ai-gateway-priv-url" "$new_url"
    echo "[ecs-ai-gateway] PRIVATE URL: $new_url"
    echo "[ecs-ai-gateway] shared params NOT flipped; verify reachability then follow docs/runbooks/h-14-private-ingress-cutover-runbook.md"
  else
    put_param "${PARAM_PREFIX}/ecs-express-ai-gateway-url" "$new_url"
    put_param "${PARAM_PREFIX}/ai-gateway-public-base-url" "$new_url"
    put_param "${PARAM_PREFIX}/ai-gateway-internal-url" "${new_url}/v1"
    echo "[ecs-ai-gateway] URL: $new_url"
  fi
}

# BullMQ workers (notification/workflow/ai-draft/crm-sla repeat jobs + queue
# consumers). Express Mode requires an HTTP health check, so main.ts serves a
# tiny 200 endpoint on PORT; the service takes no real traffic.
workers_container_json() {
  local image="$1"
  local internal_api_url="$2"
  local public_base_url="$3"
  local public_web_url
  public_web_url="$(normalize_url "${PUBLIC_DOMAIN_URL:-$public_base_url}")"
  jq -n \
    --arg image "$image" \
    --arg sha "$SHA" \
    --arg commit "$COMMIT" \
    --arg deployEnvironment "$DEPLOY_ENV" \
    --arg productionServingMode "$PRODUCTION_SERVING_MODE_INPUT" \
    --arg queueEnabled "$SERVING_QUEUE_ENABLED" \
    --arg publicWebUrl "$public_web_url" \
    --arg internalApiUrl "$internal_api_url" \
    --arg s3Bucket "$S3_BUCKET" \
    --arg region "$REGION" \
    --arg databaseUrl "$(secret_arn "${SECRET_PREFIX}/database-url")" \
    --arg redisUrl "$(secret_arn "${SECRET_PREFIX}/redis-url")" \
    --arg workerToken "$(secret_arn "${SECRET_PREFIX}/worker-internal-token")" \
    --arg logGroup "/ecs/${RESOURCE_PREFIX}-workers" \
    '{
      image: $image,
      containerPort: 3000,
      awsLogsConfiguration: {logGroup: $logGroup, logStreamPrefix: "workers"},
      environment: [
        {name:"NODE_ENV", value:"production"},
        {name:"APP_ENV", value:"production"},
        {name:"DEPLOY_ENVIRONMENT", value:$deployEnvironment},
        {name:"PRODUCTION_SERVING_MODE", value:$productionServingMode},
        {name:"SERVICE_NAME", value:"watchdog-workers"},
        {name:"SERVICE_VERSION", value:$sha},
        {name:"GIT_SHA", value:$commit},
        {name:"HOST", value:"0.0.0.0"},
        {name:"PORT", value:"3000"},
        {name:"PUBLIC_BASE_URL", value:$publicWebUrl},
        {name:"INTERNAL_API_URL", value:$internalApiUrl},
        {name:"S3_BUCKET", value:$s3Bucket},
        {name:"S3_REGION", value:$region},
        {name:"AWS_REGION", value:$region},
        {name:"QUEUE_ENABLED", value:$queueEnabled},
        {name:"LOG_FORMAT", value:"json"}
      ],
      secrets: [
        {name:"DATABASE_URL", valueFrom:$databaseUrl},
        {name:"REDIS_URL", valueFrom:$redisUrl},
        {name:"WORKER_INTERNAL_TOKEN", valueFrom:$workerToken}
      ]
    }'
}

deploy_workers() {
  preflight
  ensure_ecs_roles
  ensure_cluster
  ensure_log_group "/ecs/${RESOURCE_PREFIX}-workers"

  local repo="watchdog-bms-workers"
  local image="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${repo}:ecs-${SHA}"
  local api_web_url
  api_web_url="$(get_param "${PARAM_PREFIX}/ecs-express-api-web-url")"
  api_web_url="${api_web_url:-https://watchdog-bms-api-web-placeholder.invalid}"
  local internal_api_url
  internal_api_url="$(get_param "${PARAM_PREFIX}/erp-core-internal-url")"
  internal_api_url="${internal_api_url:-${api_web_url}/v1}"

  echo "[ecs-workers] account=$ACCOUNT_ID region=$REGION sha=$SHA"
  if [ -n "$PRODUCTION_IMAGE_MANIFEST" ]; then
    image="$(manifest_image workers "$repo")"
  else
    aws_cmd ecr describe-repositories --repository-names "$repo" --region "$REGION" >/dev/null 2>&1 || \
      aws_cmd ecr create-repository --repository-name "$repo" --image-scanning-configuration scanOnPush=true --region "$REGION" >/dev/null
    ecr_login
    build_clean_image apps/workers/Dockerfile "$image" --platform linux/amd64 --provenance=false
    "$DOCKER_BIN" push "$image"
    image="$(immutable_image_ref "$repo" "$image")"
  fi

  # H-14: same separate-service pattern as the AI gateway — workers take no
  # real inbound traffic (health check only), so private mode removes their
  # public endpoint entirely once the old public service is retired.
  local service_name="$WORKERS_SERVICE_NAME"
  local arn_param="${PARAM_PREFIX}/ecs-express-workers-service-arn"
  local access_type="PUBLIC"
  if [ "${ECS_EXPRESS_SUBNET_MODE:-public}" = "private" ]; then
    service_name="${WORKERS_SERVICE_NAME}-priv"
    arn_param="${PARAM_PREFIX}/ecs-express-workers-priv-service-arn"
    access_type="PRIVATE"
  fi

  workers_container_json "$image" "$internal_api_url" "$api_web_url" > /tmp/watchdog-bms-ecs-workers-container.json
  local new_url
  new_url="$(deploy_express_service "$service_name" "$arn_param" /tmp/watchdog-bms-ecs-workers-container.json "$WORKERS_TASK_ROLE" /health 512 1024 "$APP_SG_NAME" "$access_type")" || return $?

  if [ "$access_type" = "PRIVATE" ]; then
    put_param "${PARAM_PREFIX}/ecs-express-workers-priv-url" "$new_url"
    echo "[ecs-workers] PRIVATE URL: $new_url"
  else
    put_param "${PARAM_PREFIX}/ecs-express-workers-url" "$new_url"
    echo "[ecs-workers] URL: $new_url"
  fi
}

# Spec §4.1: 'all' rolls services out as concurrent waves only with prebuilt
# images (a wave job must not build) and a steady-state environment. UAT bootstrap
# environments miss these params and keep the sequential ordering, including the
# two-phase api-web URL dance. Production refuses that fallback so its public api-web
# gate can never move before AI/workers. ECS_EXPRESS_SUBNET_MODE=private is the other
# precondition; the 'all' case already refuses it outright below.
wave_mode_ready() {
  if [ -z "$PRODUCTION_IMAGE_MANIFEST" ]; then
    if [ "$DEPLOY_ENV" = production ]; then
      echo "[deploy-all] ERROR: production all-target rollout requires an immutable manifest" >&2
      return 2
    fi
    echo "[deploy-all] no image manifest; running the sequential rollout" >&2
    return 1
  fi
  local name value
  for name in \
    "${PARAM_PREFIX}/ecs-express-api-web-service-arn" \
    "${PARAM_PREFIX}/ecs-express-api-web-url" \
    "${PARAM_PREFIX}/ecs-express-ai-gateway-service-arn" \
    "${PARAM_PREFIX}/ai-gateway-internal-url" \
    "${PARAM_PREFIX}/ecs-express-workers-service-arn"; do
    # The decision helper deliberately captures this function's exact status. Propagate every read
    # failure explicitly so AccessDenied/expired credentials can never masquerade as an empty
    # bootstrap parameter and continue to mutation.
    if ! value="$(get_param "$name")"; then
      # Status 1 is reserved by run_rollout_by_readiness for an intentional
      # bootstrap. Any real SSM/AWS read failure must stay operational failure.
      return 75
    fi
    if [ -z "$value" ] || [ "$value" = "None" ]; then
      if [ "$DEPLOY_ENV" = production ]; then
        echo "[deploy-all] ERROR: production all-target rollout requires every existing service endpoint" >&2
        return 2
      fi
      echo "[deploy-all] $name is empty (bootstrap); running the sequential rollout" >&2
      return 1
    fi
  done
  return 0
}

# Spec §4.5: api-web carries the AI Gateway endpoint in its container config, so
# it only needs another full canary bake when that endpoint actually moved.
refresh_api_web_on_endpoint_drift() {
  local before="$1" after
  after="$(get_param "${PARAM_PREFIX}/ai-gateway-internal-url")" || return $?
  if [ "$after" != "$before" ]; then
    echo "[deploy-all] AI Gateway endpoint changed; refreshing api-web configuration"
    deploy_api_web
  else
    echo "[deploy-all] AI Gateway endpoint unchanged; skipping redundant api-web rollout"
  fi
}

deploy_all_wave() {
  local ai_gateway_url_before="$1"
  # Spec §4.4: whole-environment work runs once, before any concurrency.
  preflight
  ensure_ecs_roles
  ensure_cluster
  # Whole-environment UAT waves are concurrent. Establish report-export retention before any
  # service in the wave can start, while deploy_api_web repeats the same gate immediately before
  # its own ECS mutation for single-target and sequential bootstrap paths.
  ensure_s3_upload_controls
  export WATCHDOG_COMMON_ENSURED=1
  # Spec §4.2: production moves internal/background services first and the only
  # customer ingress last. A failed first wave therefore leaves the public gate
  # unchanged in both maintenance and live transitions.
  if [ "$DEPLOY_ENV" = "production" ]; then
    run_rollout_wave ai-gateway workers
    run_rollout_wave api-web
  else
    run_rollout_wave api-web ai-gateway workers
    refresh_api_web_on_endpoint_drift "$ai_gateway_url_before"
  fi
}

deploy_all_sequential() {
  local ai_gateway_url_before="$1"
  deploy_api_web
  deploy_ai_gateway
  refresh_api_web_on_endpoint_drift "$ai_gateway_url_before"
  deploy_workers
}

case "$TARGET" in
  api-web)
    deploy_api_web
    ;;
  ai-gateway)
    deploy_ai_gateway
    ;;
  workers)
    deploy_workers
    ;;
  s3-cors)
    preflight
    ensure_s3_upload_controls
    ensure_s3_cors
    ;;
  all)
    # H-14: 'all' redeploys api-web, which must stay public; private cutover is a
    # per-target operation driven by the runbook, never the combined path.
    if [ "${ECS_EXPRESS_SUBNET_MODE:-public}" = "private" ]; then
      echo "ERROR: 'all' cannot run with ECS_EXPRESS_SUBNET_MODE=private (it redeploys public api-web)." >&2
      echo "Run 'workers' then 'ai-gateway' as individual private targets; see docs/runbooks/h-14-private-ingress-cutover-runbook.md" >&2
      exit 1
    fi
    ai_gateway_url_before="$(get_param "${PARAM_PREFIX}/ai-gateway-internal-url")"
    # shellcheck source=infra/prod-ecs-express/lib-rollout-waves.sh
    . infra/prod-ecs-express/lib-rollout-waves.sh
    run_rollout_by_readiness wave_mode_ready deploy_all_wave deploy_all_sequential "$ai_gateway_url_before"
    ;;
  *)
    echo "Usage: $0 [api-web|ai-gateway|workers|s3-cors|all]" >&2
    exit 2
    ;;
esac
