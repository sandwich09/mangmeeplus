#!/usr/bin/env bash
set -euo pipefail

# Pre-deploy parity check: does production actually hold every secret deploy.sh will look for,
# and how does its key set differ from UAT?
#
#   bash infra/production/compare-env-keys.sh
#
# Why this is worth running before a release rather than finding out during one: secret_arn() in
# deploy.sh returns an empty string when describe-secret fails, and the container JSON then drops
# the entry through `map(select(.valueFrom != ""))`. A missing secret therefore does not fail the
# deploy where it is missing - the container is built without it, production config validation
# rejects it at startup, and the canary rolls back. The visible symptom is several minutes away
# from the cause.
#
# The required list is derived from deploy.sh itself rather than hardcoded, so a secret added to
# the deploy script is picked up here without anyone remembering to update two places.

region="${AWS_REGION:-ap-southeast-1}"
repo_root="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
deploy_script="$repo_root/infra/prod-ecs-express/deploy.sh"

# Documented as optional in infra/uat/bootstrap-data.sh: without it the ai-gateway binding is
# dropped and image OCR returns PROVIDER_CONFIG_MISSING. PDF OCR goes through Bedrock and is
# unaffected, so its absence is a degraded feature rather than a broken deploy.
optional_secrets="typhoon-ocr-api-key"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    aws "$@"
}

[ -r "$deploy_script" ] || { echo "ERROR: cannot read $deploy_script" >&2; exit 1; }

required="$(grep -oE 'SECRET_PREFIX\}/[a-z0-9-]+' "$deploy_script" | sed 's|SECRET_PREFIX}/||' | sort -u)"
[ -n "$required" ] || { echo 'ERROR: found no secret references in deploy.sh; the pattern moved' >&2; exit 1; }

list_env_secrets() {
  # --max-results is capped at 100 per page and this account holds ~30 secrets, but paginate
  # anyway: silently reading the first page only would make a missing secret look absent when it
  # is merely on page two.
  aws_cmd secretsmanager list-secrets --region "$region" --max-results 100 \
    --query "SecretList[?starts_with(Name, 'watchdog-bms/$1/')].Name" --output text \
    | tr '\t' '\n' | sed "s|watchdog-bms/$1/||" | grep -v '^$' | sort -u
}

prod="$(list_env_secrets production)"
uat="$(list_env_secrets uat)"

echo "required by deploy.sh : $(wc -l <<< "$required" | tr -d ' ')"
echo "present in production : $(wc -l <<< "$prod" | tr -d ' ')"
echo "present in uat        : $(wc -l <<< "$uat" | tr -d ' ')"
echo

status=0

missing_required="$(comm -23 <(printf '%s\n' "$required") <(printf '%s\n' "$prod"))"
blocking=""
degraded=""
for secret in $missing_required; do
  case " $optional_secrets " in
    *" $secret "*) degraded="$degraded $secret" ;;
    *) blocking="$blocking $secret" ;;
  esac
done

if [ -n "$blocking" ]; then
  echo 'MISSING IN PRODUCTION - deploy will roll back at the canary, not fail where the gap is:'
  for s in $blocking; do echo "  - watchdog-bms/production/$s"; done
  status=1
else
  echo 'OK: production holds every secret deploy.sh requires'
fi

if [ -n "$degraded" ]; then
  echo
  echo 'Absent but optional - the deploy succeeds with the feature degraded:'
  for s in $degraded; do echo "  - watchdog-bms/production/$s"; done
fi

only_uat="$(comm -23 <(printf '%s\n' "$uat") <(printf '%s\n' "$prod"))"
if [ -n "$only_uat" ]; then
  echo
  echo 'In UAT but not production (review each; not every one belongs in production):'
  printf '  - %s\n' $only_uat
fi

only_prod="$(comm -13 <(printf '%s\n' "$uat") <(printf '%s\n' "$prod"))"
if [ -n "$only_prod" ]; then
  echo
  echo 'In production but not UAT (expected for production-only paths such as A5):'
  printf '  - %s\n' $only_prod
fi

# GitHub environment variables are the other half of the configuration and are invisible to the
# secret listing above. LOG_KMS_KEY_ID and SECURITY_ALERT_TOPIC_ARN are checked by name because
# deploy.sh exits before any AWS call when either is empty.
if command -v gh >/dev/null 2>&1; then
  echo
  # Read once into a variable rather than piping gh into grep per key. `grep -q` exits at the
  # first match, gh takes SIGPIPE, and under `set -o pipefail` the whole pipeline then reports
  # failure - so a variable that exists was reported MISSING. Observed 2026-08-08.
  gh_prod_raw="$(gh variable list --env production 2>/dev/null || true)"
  gh_uat_raw="$(gh variable list --env uat 2>/dev/null || true)"

  for key in LOG_KMS_KEY_ID SECURITY_ALERT_TOPIC_ARN; do
    if printf '%s\n' "$gh_prod_raw" | grep -q "^${key}[[:space:]]"; then
      echo "OK: GitHub production variable ${key} is set"
    else
      echo "MISSING: GitHub production variable ${key} - deploy.sh refuses to start without it"
      status=1
    fi
  done

  # The deploy's "Preserve active non-secret configuration" step resolves each of these from the
  # GitHub variable, then from the live ECS service, then from a fallback, and exits 1 if all
  # three are empty and the entry is required. Production has never been deployed, so the second
  # source is empty - every required entry without a fallback must come from a GitHub variable or
  # the deploy dies at that step, minutes in and before anything is built.
  #
  # Parsed out of the workflow rather than listed here so that adding a preserve line is enough.
  workflow="$repo_root/.github/workflows/deploy-production.yml"
  if [ -r "$workflow" ]; then
    required_vars="$(grep -oE '^ +preserve [A-Z_]+ [A-Z_]+ [^ ]+( .*)?$' "$workflow" \
      | sed 's/^ *preserve //' \
      | awk '{ req = ($4 == "" ? "true" : $4); fallback = $5
               if (req == "true" && fallback == "") print $1 }' | sort -u)"
    missing_vars=""
    for key in $required_vars; do
      printf '%s\n' "$gh_prod_raw" | grep -q "^${key}[[:space:]]" || missing_vars="$missing_vars $key"
    done
    echo
    if [ -n "$missing_vars" ]; then
      echo 'REQUIRED BY THE DEPLOY BUT ABSENT FROM THE production GitHub environment.'
      echo 'The first deploy has no live service to copy these from, so it exits at'
      echo '"Preserve active non-secret configuration":'
      for k in $missing_vars; do echo "  - $k"; done
      status=1
    else
      echo 'OK: every required non-secret production variable is set'
    fi
  fi

  gh_uat="$(printf '%s\n' "$gh_uat_raw" | awk 'NF{print $1}' | sort -u)"
  gh_prod="$(printf '%s\n' "$gh_prod_raw" | awk 'NF{print $1}' | sort -u)"
  if [ -n "$gh_uat" ] && [ -n "$gh_prod" ]; then
    gh_only_uat="$(comm -23 <(printf '%s\n' "$gh_uat") <(printf '%s\n' "$gh_prod"))"
    if [ -n "$gh_only_uat" ]; then
      echo
      echo 'GitHub variables in uat but not production:'
      printf '  - %s\n' $gh_only_uat
    fi
  fi
else
  echo
  echo 'NOTE: gh not found; GitHub environment variables were not compared'
fi

exit "$status"
