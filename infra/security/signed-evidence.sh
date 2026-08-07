#!/usr/bin/env bash

# Source-only helpers for the FR-H signed production evidence envelope.

_SIGNED_EVIDENCE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

_signed_evidence_fail() {
  echo "ERROR: $*" >&2
  return 1
}

signed_evidence_sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

_signed_evidence_sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

_signed_evidence_file_size() {
  wc -c < "$1" | tr -d '[:space:]'
}

_signed_evidence_link_count() {
  if stat -c %h "$1" 2>/dev/null; then return
  else stat -f %l "$1" 2>/dev/null; fi
}

_signed_evidence_regular_file() {
  local file="$1" max_bytes="$2" size links
  [ -f "$file" ] && [ ! -L "$file" ] \
    || { _signed_evidence_fail "file is absent or not a regular non-link file"; return 1; }
  size="$(_signed_evidence_file_size "$file")"
  [[ "$size" =~ ^[0-9]+$ ]] && [ "$size" -gt 0 ] && [ "$size" -le "$max_bytes" ] \
    || { _signed_evidence_fail "file size is outside the allowed bound"; return 1; }
  links="$(_signed_evidence_link_count "$file")" \
    || { _signed_evidence_fail "cannot inspect file link count"; return 1; }
  [ "$links" = 1 ] || { _signed_evidence_fail "file is hard-linked"; return 1; }
}

_signed_evidence_single_json_object() {
  jq -e -s 'length == 1 and (.[0] | type == "object")' "$1" >/dev/null 2>&1 \
    || { _signed_evidence_fail "JSON input must contain exactly one object"; return 1; }
}

# Emits recursively key-sorted compact JSON with exactly one trailing LF.
signed_evidence_canonicalize() {
  [ "$#" -eq 1 ] || { _signed_evidence_fail "canonicalize expects one JSON file"; return 2; }
  _signed_evidence_single_json_object "$1" || return 1
  jq -cS . "$1"
}

signed_evidence_content_sha256() (
  trap - EXIT
  [ "$#" -eq 1 ] || { _signed_evidence_fail "content_sha256 expects one JSON file"; return 2; }
  local canonical cleanup
  _signed_evidence_single_json_object "$1" || exit 1
  canonical="$(mktemp "${TMPDIR:-/tmp}/signed-evidence-content.XXXXXX")"
  printf -v cleanup 'rm -f -- %q' "$canonical"
  trap "$cleanup" EXIT
  jq -cS 'del(.contentSha256)' "$1" > "$canonical" \
    || { _signed_evidence_fail "cannot canonicalize signed-evidence content"; exit 1; }
  signed_evidence_sha256_stream < "$canonical"
)

_signed_evidence_assert_jq_hash() {
  local evidence="$1" expected_filter="$2" value_filter="$3" expected actual
  expected="$(jq -er "$expected_filter | select(type == \"string\" and test(\"^[0-9a-f]{64}$\"))" "$evidence")" \
    || { _signed_evidence_fail "contract hash field is absent or malformed"; return 1; }
  actual="$(jq -cjS "$value_filter" "$evidence" | signed_evidence_sha256_stream)" \
    || { _signed_evidence_fail "cannot recompute canonical contract hash"; return 1; }
  [ "$actual" = "$expected" ] \
    || { _signed_evidence_fail "canonical contract hash mismatch"; return 1; }
}

_signed_evidence_assert_raw_string_hash() {
  local evidence="$1" expected_filter="$2" value_filter="$3" expected actual
  expected="$(jq -er "$expected_filter | select(type == \"string\" and test(\"^[0-9a-f]{64}$\"))" \
    "$evidence")" || { _signed_evidence_fail "raw string hash field is absent or malformed"; return 1; }
  actual="$(jq -erj "$value_filter | select(type == \"string\")" "$evidence" \
    | signed_evidence_sha256_stream)" \
    || { _signed_evidence_fail "cannot recompute raw string contract hash"; return 1; }
  [ "$actual" = "$expected" ] \
    || { _signed_evidence_fail "raw string contract hash mismatch"; return 1; }
}

_signed_evidence_assert_h2_reader_payload() {
  local evidence="$1" expected_hash expected_bytes actual_hash actual_bytes canonical
  expected_hash="$(jq -er '.payload.readerRuntime.output.payloadSha256
    | select(type == "string" and test("^[0-9a-f]{64}$"))' "$evidence")" \
    || { _signed_evidence_fail "reader payload hash is absent or malformed"; return 1; }
  expected_bytes="$(jq -er '.payload.readerRuntime.output.payloadBytes
    | select(type == "number" and floor == . and . >= 1 and . <= 700000)' "$evidence")" \
    || { _signed_evidence_fail "reader payload byte count is absent or malformed"; return 1; }
  canonical="$(mktemp "${TMPDIR:-/tmp}/signed-evidence-reader-payload.XXXXXX")" || return 1
  jq -cS '.payload | del(.currentHealth,.readerRuntime)
    | .migrationState |= del(.productionApplyAuthority)' "$evidence" > "$canonical" \
    || { rm -f -- "$canonical"; _signed_evidence_fail "cannot reconstruct reader payload"; return 1; }
  actual_hash="$(_signed_evidence_sha256_file "$canonical")"
  actual_bytes="$(_signed_evidence_file_size "$canonical")"
  rm -f -- "$canonical"
  [ "$actual_hash" = "$expected_hash" ] && [ "$actual_bytes" = "$expected_bytes" ] \
    || { _signed_evidence_fail "reader payload hash/byte binding mismatch"; return 1; }
}

_signed_evidence_validate_h2_hashes() {
  local evidence="$1" result service_index raw_name
  _signed_evidence_assert_jq_hash "$evidence" '.payload.currentHealth.servicesHash' \
    '.payload.currentHealth.services' || return 1
  for service_index in 0 1 2; do
    for raw_name in describeExpressGatewayService describeServiceRevisions listTasks describeTasks \
      describeNetworkInterfaces describeTargetGroups describeTargetHealth ssmParameter publicHealth; do
      _signed_evidence_assert_jq_hash "$evidence" \
        ".payload.currentHealth.services[$service_index].rawEvidence.${raw_name}.sha256" \
        ".payload.currentHealth.services[$service_index].rawEvidence.${raw_name}.raw" || return 1
    done
  done
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.reviewedMigrationOperationsHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.candidateMigrationSetHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest
      | map({relativePath,migrationName,checksumSha256})' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.expectedDataTransformHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest
      | map(select(.operationClass == "DATA_BACKFILL")
        | {relativePath,checksumSha256,invariants:.postDataInvariants})' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.preflightCatalogHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest
      | map({relativePath,preconditions})' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.lockBudgetPolicyHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest
      | map({relativePath,executionBudget})' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.expectedSeededRouteHash' \
    '.payload.migrationState.reviewedManifest.expectedSeededRoutes' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.expectedClosedWhtRouteHash' \
    '.payload.migrationState.reviewedManifest.expectedClosedWhtRoutes' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.expectedSchemaDeltaHash' \
    '.payload.migrationState.reviewedManifest as $m
      | ($m.preSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $before
      | ($m.postSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $after
      | (($before|keys) + ($after|keys) | unique | sort)
      | map(select(($before[.] // null) != ($after[.] // null))
          | {key:.,before:($before[.] // null),after:($after[.] // null)})' || return 1

  for result in preconditionResults postSchemaResults postDataResults; do
    if [ "$(jq -r --arg result "$result" \
      '.payload.migrationState.verificationEvidence[$result].status' "$evidence")" = VERIFIED ]; then
      _signed_evidence_assert_jq_hash "$evidence" \
        ".payload.migrationState.verificationEvidence.${result}.resultsHash" \
        ".payload.migrationState.verificationEvidence.${result}.results" || return 1
    fi
  done
  if [ "$(jq -r '.payload.migrationState.verificationEvidence.executedMigrations.status' \
    "$evidence")" = VERIFIED ]; then
    _signed_evidence_assert_jq_hash "$evidence" \
      '.payload.migrationState.verificationEvidence.executedMigrations.migrationsHash' \
      '.payload.migrationState.verificationEvidence.executedMigrations.migrations' || return 1
  fi
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.verificationEvidence.executionBudgetResultsHash' \
    '.payload.migrationState.verificationEvidence.executionBudgetResults' || return 1
  for result in preconditionResults postSchemaResults postDataResults; do
    _signed_evidence_assert_jq_hash "$evidence" \
      ".payload.migrationState.verificationEvidence.cloneRehearsal.${result}.resultsHash" \
      ".payload.migrationState.verificationEvidence.cloneRehearsal.${result}.results" || return 1
  done
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executedMigrations.migrationsHash' \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executedMigrations.migrations' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executionBudgetResultsHash' \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executionBudgetResults' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.sourceSchemaCatalogFingerprint' \
    '.payload.migrationState.reviewedManifest.preSchemaCatalogObjects' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.resultSchemaCatalogFingerprint' \
    '.payload.migrationState.reviewedManifest.postSchemaCatalogObjects' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.resultHash' \
    '.payload.migrationState.verificationEvidence.cloneRehearsal | del(.resultHash)' || return 1
  _signed_evidence_assert_h2_reader_payload "$evidence" || return 1
}

_signed_evidence_validate_h3_hashes() {
  local evidence="$1" section
  for section in controllerTrust artifactIntegrity migrationReview rollbackRecovery \
    protectedMainPolicy productionEnvironmentPolicy awsIdentityBoundary; do
    _signed_evidence_assert_jq_hash "$evidence" \
      ".payload.checks.${section}.evidenceSha256" \
      ".payload.verificationEvidence.${section}" || return 1
  done
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.checks.controllerTrust.validatorSetHash' \
    '.payload.verificationEvidence.controllerTrust.validators' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.checks.protectedMainPolicy.requiredStatusContextsHash' \
    '.payload.verificationEvidence.protectedMainPolicy.requiredStatusContexts' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.verificationEvidence.rollbackRecovery.commandListSha256' \
    '.payload.verificationEvidence.rollbackRecovery.commands | map(.command)' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.verificationEvidence.rollbackRecovery.combinedOutputSha256' \
    '.payload.verificationEvidence.rollbackRecovery.commands | map({command,outputSha256})' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.verificationEvidence.awsIdentityBoundary.observedTrustPolicySha256' \
    '.payload.verificationEvidence.awsIdentityBoundary.trustPolicy' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.verificationEvidence.awsIdentityBoundary.observedInlinePolicySha256' \
    '.payload.verificationEvidence.awsIdentityBoundary.inlinePolicy' || return 1
}

_signed_evidence_validate_clone_hashes() {
  local evidence="$1" result network_member
  _signed_evidence_assert_jq_hash "$evidence" '.payload.sourceAppliedMigrationsHash' \
    '.payload.sourceAppliedMigrations' || return 1
  _signed_evidence_assert_jq_hash "$evidence" '.payload.reviewedMigrationOperationsHash' \
    '.payload.reviewedManifest.reviewedMigrationManifest' || return 1
  _signed_evidence_assert_jq_hash "$evidence" '.payload.candidateMigrationSetHash' \
    '.payload.reviewedManifest.reviewedMigrationManifest | map({relativePath,migrationName,checksumSha256})' || return 1
  _signed_evidence_assert_jq_hash "$evidence" '.payload.expectedDataTransformHash' \
    '.payload.reviewedManifest.reviewedMigrationManifest
      | map(select(.operationClass == "DATA_BACKFILL")
        | {relativePath,checksumSha256,invariants:.postDataInvariants})' || return 1
  _signed_evidence_assert_jq_hash "$evidence" '.payload.preflightCatalogHash' \
    '.payload.reviewedManifest.reviewedMigrationManifest | map({relativePath,preconditions})' || return 1
  _signed_evidence_assert_jq_hash "$evidence" '.payload.lockBudgetPolicyHash' \
    '.payload.reviewedManifest.reviewedMigrationManifest | map({relativePath,executionBudget})' || return 1
  _signed_evidence_assert_jq_hash "$evidence" '.payload.expectedSeededRouteHash' \
    '.payload.reviewedManifest.expectedSeededRoutes' || return 1
  _signed_evidence_assert_jq_hash "$evidence" '.payload.expectedClosedWhtRouteHash' \
    '.payload.reviewedManifest.expectedClosedWhtRoutes' || return 1
  _signed_evidence_assert_jq_hash "$evidence" '.payload.expectedSchemaDeltaHash' \
    '.payload.reviewedManifest as $m
      | ($m.preSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $before
      | ($m.postSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $after
      | (($before|keys) + ($after|keys) | unique | sort)
      | map(select(($before[.] // null) != ($after[.] // null))
          | {key:.,before:($before[.] // null),after:($after[.] // null)})' || return 1
  for result in preconditionResults postSchemaResults postDataResults; do
    _signed_evidence_assert_jq_hash "$evidence" \
      ".payload.cloneRehearsal.${result}.resultsHash" \
      ".payload.cloneRehearsal.${result}.results" || return 1
  done
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.cloneRehearsal.executedMigrations.migrationsHash' \
    '.payload.cloneRehearsal.executedMigrations.migrations' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.cloneRehearsal.executionBudgetResultsHash' \
    '.payload.cloneRehearsal.executionBudgetResults' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.cloneRehearsal.sourceSchemaCatalogFingerprint' \
    '.payload.reviewedManifest.preSchemaCatalogObjects' || return 1
  _signed_evidence_assert_jq_hash "$evidence" \
    '.payload.cloneRehearsal.resultSchemaCatalogFingerprint' \
    '.payload.reviewedManifest.postSchemaCatalogObjects' || return 1
  _signed_evidence_assert_jq_hash "$evidence" '.payload.cloneRehearsal.resultHash' \
    '.payload.cloneRehearsal | del(.resultHash)' || return 1
  for network_member in describeDbInstances describeNetworkInterfaces describeSecurityGroups \
    describeSubnets describeTaskDefinition describeTasks; do
    _signed_evidence_assert_jq_hash "$evidence" \
      ".payload.cloneInfrastructure.networkEvidence.${network_member}.sha256" \
      ".payload.cloneInfrastructure.networkEvidence.${network_member}.raw" || return 1
  done
  _signed_evidence_assert_raw_string_hash "$evidence" \
    '.payload.reimbursementCompatibility.commandSha256' \
    '.payload.reimbursementCompatibility.command' || return 1
}

signed_evidence_validate_contract_hashes() {
  [ "$#" -eq 1 ] || { _signed_evidence_fail "contract hash validation expects one evidence file"; return 2; }
  case "$(jq -er '.artifactKind' "$1")" in
    PRODUCTION_A5_EVIDENCE_V1) _signed_evidence_validate_h2_hashes "$1" ;;
    PRODUCTION_A5_CLONE_REHEARSAL_V1) _signed_evidence_validate_clone_hashes "$1" ;;
    PRODUCTION_SECURITY_PREFLIGHT_V1) _signed_evidence_validate_h3_hashes "$1" ;;
    U5_SHADOW_AGGREGATE_V1|OWNER_U5E_APPROVAL_V1) return 0 ;;
    *) _signed_evidence_fail "unknown signed-evidence artifact kind" ;;
  esac
}

_signed_evidence_validate_expected() {
  _signed_evidence_regular_file "$1" 65536 || return 1
  _signed_evidence_single_json_object "$1" || return 1
  jq -e '
    def exact_keys($wanted): keys == ($wanted | sort);
    def sha40: type == "string" and test("^[0-9a-f]{40}$");
    def hash64: type == "string" and test("^[0-9a-f]{64}$");
    def positive_string: type == "string" and test("^[1-9][0-9]*$");
    def positive_integer: type == "number" and . >= 1 and floor == .;
    def epoch: type == "number" and . >= 0 and floor == .;
    def login: type == "string" and length <= 100
      and test("^[A-Za-z0-9][A-Za-z0-9_.\\[\\]-]*$");
    def known_kind:
      . == "PRODUCTION_A5_EVIDENCE_V1"
      or . == "PRODUCTION_A5_CLONE_REHEARSAL_V1"
      or . == "PRODUCTION_SECURITY_PREFLIGHT_V1"
      or . == "U5_SHADOW_AGGREGATE_V1"
      or . == "OWNER_U5E_APPROVAL_V1";
    exact_keys(["artifactKind","environment","lifetimeSeconds","parentProductionRun",
      "producer","repository","sourceCommit"])
    and (.artifactKind | known_kind)
    and .environment == "production"
    and (.repository | type == "string" and test("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"))
    and (.sourceCommit | sha40)
    and (.lifetimeSeconds | positive_integer)
    and .lifetimeSeconds == (if .artifactKind == "PRODUCTION_SECURITY_PREFLIGHT_V1"
      or .artifactKind == "PRODUCTION_A5_CLONE_REHEARSAL_V1" then 7200
      elif .artifactKind == "OWNER_U5E_APPROVAL_V1" then 1800 else 3600 end)
    and (.producer | exact_keys(["actor","controllerCommit","runAttempt","runId",
      "startedAtEpoch","triggeringActor","workflowBlob","workflowPath"]))
    and (.producer.workflowPath | type == "string"
      and test("^\\.github/workflows/[A-Za-z0-9._-]+\\.ya?ml$"))
    and .producer.workflowPath == (
      if .artifactKind == "PRODUCTION_A5_EVIDENCE_V1" then ".github/workflows/production-a5.yml"
      elif .artifactKind == "PRODUCTION_A5_CLONE_REHEARSAL_V1" then ".github/workflows/production-a5-clone.yml"
      elif .artifactKind == "PRODUCTION_SECURITY_PREFLIGHT_V1" then ".github/workflows/production-security-preflight.yml"
      elif .artifactKind == "U5_SHADOW_AGGREGATE_V1" then ".github/workflows/u5-shadow-evidence.yml"
      else ".github/workflows/u5-owner-approval.yml" end)
    and (.producer.controllerCommit | sha40)
    and (.producer.workflowBlob | sha40)
    and (.producer.runId | positive_string)
    and (.producer.runAttempt | positive_integer)
    and (.producer.actor | login)
    and (.producer.triggeringActor | login)
    and (.producer.startedAtEpoch | epoch)
    and (.parentProductionRun | exact_keys(["controllerCommit","runAttempt","runId",
      "startedAtEpoch","workflowBlob"]))
    and (.parentProductionRun.controllerCommit | sha40)
    and (.parentProductionRun.workflowBlob | sha40)
    and (.parentProductionRun.runId | positive_string)
    and (.parentProductionRun.runAttempt | positive_integer)
    and (.parentProductionRun.startedAtEpoch | epoch)
  ' "$1" >/dev/null || _signed_evidence_fail "invalid trusted signed-evidence expectations"
}

signed_evidence_validate_payload_contract() {
  [ "$#" -eq 1 ] || { _signed_evidence_fail "payload contract expects one evidence file"; return 2; }
  _signed_evidence_regular_file "$1" 1048576 || return 1
  _signed_evidence_single_json_object "$1" || return 1
  jq -e -L "$_SIGNED_EVIDENCE_LIB_DIR" \
    'include "evidence-contracts"; e0_validate_payload_contract' "$1" >/dev/null \
    || { _signed_evidence_fail "signed-evidence payload contract failed"; return 1; }
  signed_evidence_validate_contract_hashes "$1"
}

# Usage: signed_evidence_validate_envelope evidence.json expected.json now_epoch
signed_evidence_validate_envelope() (
  trap - EXIT
  [ "$#" -eq 3 ] || { _signed_evidence_fail "validate_envelope expects evidence, expectations and now epoch"; exit 2; }
  local evidence="$1" expected="$2" now_epoch="$3" canonical actual_hash cleanup
  [[ "$now_epoch" =~ ^[0-9]+$ ]] || { _signed_evidence_fail "now epoch is invalid"; exit 1; }
  _signed_evidence_regular_file "$evidence" 1048576 || exit 1
  _signed_evidence_regular_file "$expected" 65536 || exit 1
  _signed_evidence_validate_expected "$expected" || exit 1

  canonical="$(mktemp "${TMPDIR:-/tmp}/signed-evidence-canonical.XXXXXX")"
  printf -v cleanup 'rm -f -- %q' "$canonical"
  trap "$cleanup" EXIT
  signed_evidence_canonicalize "$evidence" > "$canonical" 2>/dev/null \
    || { _signed_evidence_fail "evidence.json is not valid JSON"; exit 1; }
  cmp -s "$evidence" "$canonical" \
    || { _signed_evidence_fail "evidence.json is not canonical jq -cS JSON with one LF"; exit 1; }

  actual_hash="$(signed_evidence_content_sha256 "$evidence")" || exit 1
  jq -e --slurpfile expected "$expected" --arg actualHash "$actual_hash" --argjson now "$now_epoch" '
    def exact_keys($wanted): keys == ($wanted | sort);
    def hash64: type == "string" and test("^[0-9a-f]{64}$");
    ($expected | length) == 1 and ($expected[0]) as $e
    | exact_keys(["artifactKind","contentSha256","environment","expiresAtEpoch",
        "issuedAtEpoch","parentProductionRun","payload","producer","repository",
        "schemaVersion","sourceCommit"])
      and .schemaVersion == 1
      and .artifactKind == $e.artifactKind
      and .repository == $e.repository
      and .environment == $e.environment
      and .sourceCommit == $e.sourceCommit
      and (.payload | type) == "object"
      and (.contentSha256 | hash64) and .contentSha256 == $actualHash
      and (.producer | exact_keys(["actor","controllerCommit","event","runAttempt","runId",
        "triggeringActor","workflowBlob","workflowPath","workflowRef"]))
      and .producer.workflowPath == $e.producer.workflowPath
      and .producer.workflowRef == "refs/heads/main"
      and .producer.controllerCommit == $e.producer.controllerCommit
      and .producer.workflowBlob == $e.producer.workflowBlob
      and .producer.runId == $e.producer.runId
      and .producer.runAttempt == $e.producer.runAttempt
      and .producer.event == "workflow_dispatch"
      and .producer.actor == $e.producer.actor
      and .producer.triggeringActor == $e.producer.triggeringActor
      and (.parentProductionRun | exact_keys(["controllerCommit","runAttempt","runId",
        "workflowBlob","workflowPath"]))
      and .parentProductionRun.workflowPath == ".github/workflows/deploy-production.yml"
      and .parentProductionRun.controllerCommit == $e.parentProductionRun.controllerCommit
      and .parentProductionRun.workflowBlob == $e.parentProductionRun.workflowBlob
      and .parentProductionRun.runId == $e.parentProductionRun.runId
      and .parentProductionRun.runAttempt == $e.parentProductionRun.runAttempt
      and (.issuedAtEpoch | type) == "number" and (.issuedAtEpoch | floor) == .issuedAtEpoch
      and (.expiresAtEpoch | type) == "number" and (.expiresAtEpoch | floor) == .expiresAtEpoch
      and .issuedAtEpoch >= $e.producer.startedAtEpoch
      and .issuedAtEpoch >= $e.parentProductionRun.startedAtEpoch
      and .issuedAtEpoch <= $now and $now < .expiresAtEpoch
      and (.expiresAtEpoch - .issuedAtEpoch) == $e.lifetimeSeconds
  ' "$evidence" >/dev/null || { _signed_evidence_fail "signed-evidence envelope binding failed"; exit 1; }
  signed_evidence_validate_payload_contract "$evidence" || exit 1
)

# A downloaded artifact must already be safely extracted into this directory.
signed_evidence_validate_extracted_dir() (
  trap - EXIT
  [ "$#" -eq 1 ] || { _signed_evidence_fail "validate_extracted_dir expects one directory"; exit 2; }
  local directory="$1" entry max_bytes
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    || { _signed_evidence_fail "artifact directory is absent or linked"; exit 1; }
  shopt -s nullglob dotglob
  local entries=("$directory"/*)
  [ "${#entries[@]}" -eq 2 ] \
    || { _signed_evidence_fail "artifact must contain exactly evidence.json and evidence.bundle"; exit 1; }
  for entry in "$directory/evidence.json" "$directory/evidence.bundle"; do
    max_bytes=1048576
    _signed_evidence_regular_file "$entry" "$max_bytes" || exit 1
  done
)

_signed_evidence_copy_file() {
  local source="$1" destination="$2" max_bytes="$3" before after copied links
  _signed_evidence_regular_file "$source" "$max_bytes" || return 1
  [ -f "$destination" ] && [ ! -L "$destination" ] \
    || { _signed_evidence_fail "fresh archive copy target is invalid"; return 1; }
  links="$(_signed_evidence_link_count "$destination")" || return 1
  [ "$links" = 1 ] || { _signed_evidence_fail "archive copy target is linked"; return 1; }
  before="$(_signed_evidence_sha256_file "$source")"
  cp -- "$source" "$destination" || return 1
  chmod 600 "$destination"
  after="$(_signed_evidence_sha256_file "$source")"
  copied="$(_signed_evidence_sha256_file "$destination")"
  [ "$before" = "$after" ] && [ "$before" = "$copied" ] \
    || { _signed_evidence_fail "input changed while being copied"; return 1; }
}

_signed_evidence_copy_archive() {
  _signed_evidence_copy_file "$1" "$2" 2097152
}

_signed_evidence_inspect_zip_file() (
  trap - EXIT
  local archive="$1" names metadata expected sorted mode size name cleanup
  _signed_evidence_regular_file "$archive" 2097152 || exit 1
  command -v zipinfo >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1 \
    && command -v head >/dev/null 2>&1 \
    || { _signed_evidence_fail "zipinfo, unzip and head are required"; exit 1; }
  names="$(mktemp "${TMPDIR:-/tmp}/signed-evidence-zip-names.XXXXXX")"
  metadata="$(mktemp "${TMPDIR:-/tmp}/signed-evidence-zip-metadata.XXXXXX")"
  expected="$(mktemp "${TMPDIR:-/tmp}/signed-evidence-zip-expected.XXXXXX")"
  sorted="$(mktemp "${TMPDIR:-/tmp}/signed-evidence-zip-sorted.XXXXXX")"
  printf -v cleanup 'rm -f -- %q %q %q %q' "$names" "$metadata" "$expected" "$sorted"
  trap "$cleanup" EXIT

  zipinfo -1 "$archive" > "$names" 2>/dev/null \
    || { _signed_evidence_fail "cannot read artifact ZIP names"; exit 1; }
  printf '%s\n' evidence.bundle evidence.json > "$expected"
  LC_ALL=C sort "$names" > "$sorted"
  cmp -s "$sorted" "$expected" \
    || { _signed_evidence_fail "artifact ZIP has duplicate, missing, extra or unsafe paths"; exit 1; }
  [ "$(wc -l < "$names" | tr -d '[:space:]')" = 2 ] \
    || { _signed_evidence_fail "artifact ZIP entry count is not exactly two"; exit 1; }

  zipinfo -l "$archive" 2>/dev/null \
    | awk '$1 ~ /^[-dlcbps?]/ { print $1 "\t" $4 "\t" $NF }' > "$metadata" \
    || { _signed_evidence_fail "cannot inspect artifact ZIP modes"; exit 1; }
  [ "$(wc -l < "$metadata" | tr -d '[:space:]')" = 2 ] \
    || { _signed_evidence_fail "artifact ZIP metadata count is not exactly two"; exit 1; }
  while IFS=$'\t' read -r mode size name; do
    [[ "$mode" == -* ]] \
      || { _signed_evidence_fail "artifact ZIP contains a symlink or non-regular member"; exit 1; }
    [[ "$size" =~ ^[0-9]+$ ]] && [ "$size" -gt 0 ] && [ "$size" -le 1048576 ] \
      || { _signed_evidence_fail "artifact ZIP member size is outside the allowed bound"; exit 1; }
    [ "$name" = evidence.json ] || [ "$name" = evidence.bundle ] \
      || { _signed_evidence_fail "artifact ZIP member path is unsafe"; exit 1; }
  done < "$metadata"
)

# Stops the decompressor after max_bytes + 1, then requires a clean bounded stream.
_signed_evidence_extract_member() (
  trap - EXIT
  [ "$#" -eq 4 ] || exit 2
  local archive="$1" name="$2" destination="$3" max_bytes="$4" size
  local statuses
  set +e
  unzip -p "$archive" "$name" 2>/dev/null | head -c "$((max_bytes + 1))" > "$destination"
  statuses=("${PIPESTATUS[@]}")
  size="$(_signed_evidence_file_size "$destination")"
  [[ "$size" =~ ^[0-9]+$ ]] && [ "$size" -gt 0 ] && [ "$size" -le "$max_bytes" ] \
    || { _signed_evidence_fail "artifact ZIP member exceeds the actual output bound"; exit 1; }
  [ "${statuses[0]}" = 0 ] && [ "${statuses[1]}" = 0 ] \
    || { _signed_evidence_fail "artifact ZIP member stream is corrupt"; exit 1; }
  chmod 600 "$destination" || exit 1
  _signed_evidence_regular_file "$destination" "$max_bytes"
)

# Inspects a stable private copy before any extraction.
signed_evidence_inspect_zip() (
  trap - EXIT
  [ "$#" -eq 1 ] || { _signed_evidence_fail "inspect_zip expects one archive"; exit 2; }
  local copy workspace cleanup
  copy="$(mktemp "${TMPDIR:-/tmp}/signed-evidence-archive.XXXXXX")"
  workspace="$(mktemp -d "${TMPDIR:-/tmp}/signed-evidence-inspect.XXXXXX")"
  printf -v cleanup 'rm -f -- %q; rm -rf -- %q' "$copy" "$workspace"
  trap "$cleanup" EXIT
  _signed_evidence_copy_archive "$1" "$copy" || exit 1
  _signed_evidence_inspect_zip_file "$copy" || exit 1
  _signed_evidence_extract_member "$copy" evidence.json "$workspace/evidence.json" 1048576 || exit 1
  _signed_evidence_extract_member "$copy" evidence.bundle "$workspace/evidence.bundle" 1048576 || exit 1
  signed_evidence_validate_extracted_dir "$workspace"
)

# Emits a freshly created private directory; the caller owns cleanup of that exact path.
signed_evidence_extract_zip() (
  trap - EXIT
  [ "$#" -eq 1 ] || { _signed_evidence_fail "extract_zip expects one archive"; exit 2; }
  local source="$1" destination copy cleanup
  copy="$(mktemp "${TMPDIR:-/tmp}/signed-evidence-archive.XXXXXX")"
  destination="$(mktemp -d "${TMPDIR:-/tmp}/signed-evidence-extracted.XXXXXX")"
  printf -v cleanup 'rm -f -- %q; rm -rf -- %q' "$copy" "$destination"
  trap "$cleanup" EXIT
  _signed_evidence_copy_archive "$source" "$copy" || exit 1
  _signed_evidence_inspect_zip_file "$copy" || exit 1
  _signed_evidence_extract_member "$copy" evidence.json "$destination/evidence.json" 1048576 || exit 1
  _signed_evidence_extract_member "$copy" evidence.bundle "$destination/evidence.bundle" 1048576 || exit 1
  signed_evidence_validate_extracted_dir "$destination" || exit 1
  printf '%s\n' "$destination"
  trap - EXIT
  rm -f "$copy"
)

# Usage: signed_evidence_artifact_name expected.json
signed_evidence_artifact_name() {
  [ "$#" -eq 1 ] || { _signed_evidence_fail "artifact_name expects trusted expectations"; return 2; }
  local expected="$1"
  _signed_evidence_validate_expected "$expected" || return 1
  jq -er '
    [.artifactKind,.sourceCommit,"production",.parentProductionRun.runId,
      "attempt",(.parentProductionRun.runAttempt|tostring),"producer",.producer.runId,
      "attempt",(.producer.runAttempt|tostring)] | join("-")
  ' "$expected"
}

# Returns the exact verified sha256:<archive-hash> from GitHub artifact-list JSON.
signed_evidence_validate_artifact_metadata() {
  [ "$#" -eq 3 ] || { _signed_evidence_fail "validate_artifact_metadata expects API JSON, expectations and ZIP"; return 2; }
  local api_json="$1" expected="$2" archive="$3" name archive_hash archive_size digest
  _signed_evidence_regular_file "$api_json" 2097152 || return 1
  _signed_evidence_single_json_object "$api_json" || return 1
  _signed_evidence_regular_file "$archive" 2097152 || return 1
  _signed_evidence_validate_expected "$expected" || return 1
  name="$(signed_evidence_artifact_name "$expected")" || return 1
  archive_hash="$(_signed_evidence_sha256_file "$archive")"
  archive_size="$(_signed_evidence_file_size "$archive")"
  digest="sha256:$archive_hash"
  jq -e --arg name "$name" --arg digest "$digest" --argjson size "$archive_size" \
    --slurpfile expected "$expected" '
    ($expected | length) == 1 and ($expected[0]) as $e
    | (keys | sort) == ["artifacts","total_count"]
      and .total_count == 1 and (.artifacts | type == "array" and length == 1)
      and .artifacts[0].name == $name
      and (.artifacts[0].id | type) == "number" and .artifacts[0].id >= 1
      and .artifacts[0].expired == false
      and .artifacts[0].digest == $digest
      and .artifacts[0].size_in_bytes == $size
      and (.artifacts[0].workflow_run.id | tostring) == $e.producer.runId
      and .artifacts[0].workflow_run.head_sha == $e.producer.controllerCommit
  ' "$api_json" >/dev/null || { _signed_evidence_fail "GitHub artifact metadata binding failed"; return 1; }
  printf '%s\n' "$digest"
}

# Binds a nested child ref to trusted lineage, actual canonical content and unique API metadata.
signed_evidence_validate_child_ref() {
  [ "$#" -eq 5 ] \
    || { _signed_evidence_fail "validate_child_ref expects ref, expectations, evidence, API JSON and ZIP"; return 2; }
  local reference="$1" expected="$2" evidence="$3" api_json="$4" archive="$5"
  local kind run_id run_attempt name content_hash artifact_digest
  _signed_evidence_regular_file "$reference" 65536 || return 1
  _signed_evidence_single_json_object "$reference" || return 1
  _signed_evidence_regular_file "$evidence" 1048576 || return 1
  _signed_evidence_single_json_object "$evidence" || return 1
  _signed_evidence_validate_expected "$expected" || return 1
  kind="$(jq -er '.artifactKind' "$expected")"
  run_id="$(jq -er '.producer.runId' "$expected")"
  run_attempt="$(jq -er '.producer.runAttempt' "$expected")"
  name="$(signed_evidence_artifact_name "$expected")" || return 1
  content_hash="$(signed_evidence_content_sha256 "$evidence")" || return 1
  artifact_digest="$(signed_evidence_validate_artifact_metadata "$api_json" "$expected" "$archive")" \
    || return 1
  jq -e --arg kind "$kind" --arg runId "$run_id" --argjson runAttempt "$run_attempt" \
    --arg name "$name" --arg contentHash "$content_hash" --arg artifactDigest "$artifact_digest" \
    --slurpfile evidence "$evidence" '
    def exact_keys($wanted): keys == ($wanted | sort);
    ($evidence | length) == 1
    and $evidence[0].contentSha256 == $contentHash
    and exact_keys(["artifactDigest","artifactKind","artifactName","contentSha256",
      "producerRunAttempt","producerRunId"])
    and .artifactKind == $kind
    and .producerRunId == $runId
    and .producerRunAttempt == $runAttempt
    and .artifactName == $name
    and .contentSha256 == $contentHash
    and .artifactDigest == $artifactDigest
  ' "$reference" >/dev/null || _signed_evidence_fail "child evidence reference is invalid"
}

# Validates the GitHub API run object against trusted expectations; it does not verify a signature.
signed_evidence_validate_github_run() {
  [ "$#" -eq 2 ] || { _signed_evidence_fail "validate_github_run expects run JSON and expectations"; return 2; }
  local run_json="$1" expected="$2"
  _signed_evidence_regular_file "$run_json" 2097152 || return 1
  _signed_evidence_single_json_object "$run_json" || return 1
  _signed_evidence_validate_expected "$expected" || return 1
  jq -e --slurpfile expected "$expected" '
    ($expected | length) == 1 and ($expected[0]) as $e
    | .status == "completed" and .conclusion == "success"
      and .event == "workflow_dispatch"
      and .path == $e.producer.workflowPath
      and .head_branch == "main"
      and .head_sha == $e.producer.controllerCommit
      and .repository.full_name == $e.repository
      and (.id | tostring) == $e.producer.runId
      and .run_attempt == $e.producer.runAttempt
      and .actor.login == $e.producer.actor
      and .triggering_actor.login == $e.producer.triggeringActor
      and (.run_started_at | fromdateiso8601) == $e.producer.startedAtEpoch
  ' "$run_json" >/dev/null || _signed_evidence_fail "GitHub producer run metadata binding failed"
}

# The parent is the currently executing production attempt, so it must still be in progress.
signed_evidence_validate_parent_github_run() {
  [ "$#" -eq 2 ] || { _signed_evidence_fail "validate_parent_github_run expects run JSON and expectations"; return 2; }
  local run_json="$1" expected="$2"
  _signed_evidence_regular_file "$run_json" 2097152 || return 1
  _signed_evidence_single_json_object "$run_json" || return 1
  _signed_evidence_validate_expected "$expected" || return 1
  jq -e --slurpfile expected "$expected" '
    ($expected | length) == 1 and ($expected[0]) as $e
    | .status == "in_progress" and .conclusion == null
      and .event == "workflow_dispatch"
      and .path == ".github/workflows/deploy-production.yml"
      and .head_branch == "main"
      and .head_sha == $e.parentProductionRun.controllerCommit
      and .repository.full_name == $e.repository
      and (.id | tostring) == $e.parentProductionRun.runId
      and .run_attempt == $e.parentProductionRun.runAttempt
      and (.run_started_at | fromdateiso8601) == $e.parentProductionRun.startedAtEpoch
  ' "$run_json" >/dev/null || _signed_evidence_fail "GitHub parent current-attempt binding failed"
}

# Recomputes both workflow blobs locally and proves source/controllers are in trusted main.
signed_evidence_validate_git_trust() {
  [ "$#" -eq 2 ] || { _signed_evidence_fail "validate_git_trust expects repo and expectations"; return 2; }
  local repo="$1" expected="$2" trusted_main='refs/heads/main' main_commit source controller parent
  local workflow parent_workflow workflow_blob parent_blob
  [ -d "$repo" ] && [ ! -L "$repo" ] \
    && git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 \
    || { _signed_evidence_fail "trusted Git repository is invalid"; return 1; }
  _signed_evidence_validate_expected "$expected" || return 1
  main_commit="$(git -C "$repo" rev-parse --verify "${trusted_main}^{commit}" 2>/dev/null)" \
    || { _signed_evidence_fail "trusted-main commit is unavailable"; return 1; }
  source="$(jq -er '.sourceCommit' "$expected")"
  controller="$(jq -er '.producer.controllerCommit' "$expected")"
  parent="$(jq -er '.parentProductionRun.controllerCommit' "$expected")"
  workflow="$(jq -er '.producer.workflowPath' "$expected")"
  workflow_blob="$(jq -er '.producer.workflowBlob' "$expected")"
  parent_blob="$(jq -er '.parentProductionRun.workflowBlob' "$expected")"
  parent_workflow='.github/workflows/deploy-production.yml'
  for commit in "$source" "$controller" "$parent"; do
    git -C "$repo" cat-file -e "${commit}^{commit}" 2>/dev/null \
      && git -C "$repo" merge-base --is-ancestor "$commit" "$main_commit" \
      || { _signed_evidence_fail "source or controller is not reachable from trusted main"; return 1; }
  done
  [ "$(git -C "$repo" rev-parse "$controller:$workflow" 2>/dev/null)" = "$workflow_blob" ] \
    && [ "$(git -C "$repo" cat-file -t "$workflow_blob" 2>/dev/null)" = blob ] \
    || { _signed_evidence_fail "producer workflow blob binding failed"; return 1; }
  [ "$(git -C "$repo" rev-parse "$parent:$parent_workflow" 2>/dev/null)" = "$parent_blob" ] \
    && [ "$(git -C "$repo" cat-file -t "$parent_blob" 2>/dev/null)" = blob ] \
    || { _signed_evidence_fail "parent workflow blob binding failed"; return 1; }
}

# Performs the online Cosign check. Offline tests stub cosign and assert only these expected arguments.
signed_evidence_verify_cosign() {
  [ "$#" -eq 3 ] || { _signed_evidence_fail "verify_cosign expects evidence, bundle and expectations"; return 2; }
  local evidence="$1" bundle="$2" expected="$3" directory repository workflow controller identity
  directory="$(dirname "$evidence")"
  [ "$directory" = "$(dirname "$bundle")" ] \
    && [ "$(basename "$evidence")" = evidence.json ] \
    && [ "$(basename "$bundle")" = evidence.bundle ] \
    || { _signed_evidence_fail "Cosign inputs are not the exact artifact members"; return 1; }
  signed_evidence_validate_extracted_dir "$directory" || return 1
  _signed_evidence_validate_expected "$expected" || return 1
  repository="$(jq -er '.repository' "$expected")"
  workflow="$(jq -er '.producer.workflowPath' "$expected")"
  controller="$(jq -er '.producer.controllerCommit' "$expected")"
  identity="https://github.com/${repository}/${workflow}@refs/heads/main"
  command -v cosign >/dev/null 2>&1 || { _signed_evidence_fail "cosign is required"; return 1; }
  cosign verify-blob \
    --bundle "$bundle" \
    --certificate-identity "$identity" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    --certificate-github-workflow-repository "$repository" \
    --certificate-github-workflow-ref "refs/heads/main" \
    --certificate-github-workflow-sha "$controller" \
    --certificate-github-workflow-trigger "workflow_dispatch" \
    "$evidence"
}

# Required gates are intentionally not configurable or optional.
# Usage: signed_evidence_verify_artifact ZIP artifacts.json producer-run.json parent-run.json
#        expected.json child-ref.json git-repo now-epoch
signed_evidence_verify_artifact() (
  trap - EXIT
  [ "$#" -eq 8 ] \
    || { _signed_evidence_fail "verify_artifact requires all eight trust inputs"; exit 2; }
  local source_archive="$1" api_json="$2" producer_run="$3" parent_run="$4"
  local expected="$5" child_ref="$6" git_repo="$7" now_epoch="$8"
  local workspace archive extracted evidence bundle cleanup
  local stable_api stable_producer stable_parent stable_expected stable_child

  workspace="$(mktemp -d "${TMPDIR:-/tmp}/signed-evidence-verify.XXXXXX")"
  printf -v cleanup 'rm -rf -- %q' "$workspace"
  trap "$cleanup" EXIT
  archive="$(mktemp "$workspace/artifact.XXXXXX")"
  stable_api="$(mktemp "$workspace/artifacts.XXXXXX.json")"
  stable_producer="$(mktemp "$workspace/producer-run.XXXXXX.json")"
  stable_parent="$(mktemp "$workspace/parent-run.XXXXXX.json")"
  stable_expected="$(mktemp "$workspace/expected.XXXXXX.json")"
  stable_child="$(mktemp "$workspace/child-ref.XXXXXX.json")"
  _signed_evidence_copy_archive "$source_archive" "$archive" || exit 1
  _signed_evidence_copy_file "$api_json" "$stable_api" 2097152 || exit 1
  _signed_evidence_copy_file "$producer_run" "$stable_producer" 2097152 || exit 1
  _signed_evidence_copy_file "$parent_run" "$stable_parent" 2097152 || exit 1
  _signed_evidence_copy_file "$expected" "$stable_expected" 65536 || exit 1
  _signed_evidence_copy_file "$child_ref" "$stable_child" 65536 || exit 1

  signed_evidence_validate_artifact_metadata "$stable_api" "$stable_expected" "$archive" >/dev/null || exit 1
  signed_evidence_validate_github_run "$stable_producer" "$stable_expected" || exit 1
  signed_evidence_validate_parent_github_run "$stable_parent" "$stable_expected" || exit 1
  signed_evidence_validate_git_trust "$git_repo" "$stable_expected" || exit 1

  extracted="$(signed_evidence_extract_zip "$archive")" || exit 1
  printf -v cleanup 'rm -rf -- %q %q' "$workspace" "$extracted"
  trap "$cleanup" EXIT
  evidence="$extracted/evidence.json"
  bundle="$extracted/evidence.bundle"
  signed_evidence_validate_envelope "$evidence" "$stable_expected" "$now_epoch" || exit 1
  signed_evidence_validate_child_ref "$stable_child" "$stable_expected" "$evidence" "$stable_api" "$archive" || exit 1
  signed_evidence_verify_cosign "$evidence" "$bundle" "$stable_expected" >/dev/null || exit 1
)
