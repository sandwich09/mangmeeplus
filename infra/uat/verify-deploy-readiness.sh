#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-ap-southeast-1}"
aws_bin="${AWS_BIN:-aws}"
cluster="${ECS_CLUSTER_NAME:-watchdog-bms-uat}"
resource_prefix="watchdog-bms-uat"
secret_prefix="watchdog-bms/uat"
parameter_prefix="/watchdog-bms/uat"

[ "${DEPLOY_ENV:-}" = uat ] || {
  echo "ERROR: UAT deploy readiness requires explicit DEPLOY_ENV=uat" >&2
  exit 2
}

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

account_id="$(aws_cmd sts get-caller-identity --query Account --output text --region "$region")"
[[ "$account_id" =~ ^[0-9]{12}$ ]] || {
  echo "ERROR: invalid AWS account ID" >&2
  exit 1
}

CLUSTER_NAME="$cluster"
REGION="$region"
RESOURCE_PREFIX="$resource_prefix"
source "$(dirname "$0")/../prod-ecs-express/lib-uat-fast-rollout.sh"

for component in api-web ai-gateway workers; do
  service_name="${resource_prefix}-${component}"
  expected_arn="arn:aws:ecs:${region}:${account_id}:service/${cluster}/${service_name}"
  arn="$(aws_cmd ssm get-parameter \
    --name "${parameter_prefix}/ecs-express-${component}-service-arn" \
    --query Parameter.Value --output text --region "$region")"
  [ "$arn" = "$expected_arn" ] || {
    echo "ERROR: unexpected ${component} service ARN" >&2
    exit 1
  }

  state="$(aws_cmd ecs describe-express-gateway-service \
    --service-arn "$arn" --output json --region "$region")"
  jq -e --arg account "$account_id" --arg region "$region" --arg cluster "$cluster" \
    --arg service "$service_name" '
      .service.status.statusCode == "ACTIVE"
      and (.service.activeConfigurations | length) == 1
      and (.service.activeConfigurations[0] as $active
        | ($active.serviceRevisionArn
            | test("^arn:aws:ecs:" + $region + ":" + $account
              + ":service-revision/" + $cluster + "/" + $service + "/[^/]+$"))
        and ($active.primaryContainer.image | test("@sha256:[0-9a-f]{64}$"))
        and ([$active.primaryContainer.environment[]?
              | select(.name == "GIT_SHA" and (.value | test("^[0-9a-f]{40}$")))] | length) == 1
        and ($active.networkConfiguration.securityGroups | length) >= 1
        and ($active.networkConfiguration.subnets | length) >= 1
        and ($active.scalingTarget.minTaskCount == 0 or $active.scalingTarget.minTaskCount == 1)
        and $active.scalingTarget.maxTaskCount == 2)
    ' <<< "$state" >/dev/null || {
      echo "ERROR: ${component} is not a stable singleton UAT service" >&2
      exit 1
    }

  snapshot="$(uat_fast_rollout_snapshot "$service_name")"
  validate_uat_fast_rollout_snapshot "$service_name" "$snapshot" || {
    echo "ERROR: ${component} rollout controls are unstable or drifted" >&2
    exit 1
  }
done

required_secrets=(
  database-url
  redis-url
  line-login-channel-secret
  line-messaging-channel-secret
  line-messaging-channel-access-token
  ai-gateway-internal-secret
  ai-actor-delegation-signing-key
  worker-internal-token
  watchdog-jwt-secret
  credential-encryption-key
  pdpa-pseudonymization-key
  pdpa-pseudonymization-previous-keys
)
for secret in "${required_secrets[@]}"; do
  arn="$(aws_cmd secretsmanager describe-secret --secret-id "${secret_prefix}/${secret}" \
    --query ARN --output text --region "$region")"
  [[ "$arn" == arn:aws:secretsmanager:"${region}":"${account_id}":secret:"${secret_prefix}/${secret}"-* ]] || {
    echo "ERROR: required UAT secret is missing or outside the expected prefix: ${secret}" >&2
    exit 1
  }
done

rollback_alarms=(
  "${resource_prefix}/${resource_prefix}-api-web/RollbackAlarm"
  "${resource_prefix}/${resource_prefix}-ai-gateway/RollbackAlarm"
  "${resource_prefix}/${resource_prefix}-workers/RollbackAlarm"
)
alarms="$(aws_cmd cloudwatch describe-alarms --alarm-names "${rollback_alarms[@]}" \
  --output json --region "$region")"
jq -e --argjson names "$(printf '%s\n' "${rollback_alarms[@]}" | jq -R . | jq -s 'sort')" '
  (.CompositeAlarms | length) == 0
  and ([.MetricAlarms[].AlarmName] | sort) == $names
  and all(.MetricAlarms[]; .StateValue == "OK")
' <<< "$alarms" >/dev/null || {
  echo "ERROR: every UAT rollback alarm must exist and be OK before image publication" >&2
  exit 1
}

echo "UAT deploy readiness verified before image publication"
