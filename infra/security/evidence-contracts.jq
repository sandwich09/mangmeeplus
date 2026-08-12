def e0_exact_keys($wanted):
  type == "object" and keys == ($wanted | sort);

def e0_hash: type == "string" and test("^[0-9a-f]{64}$");
def e0_sha: type == "string" and test("^[0-9a-f]{40}$");
def e0_digest: type == "string" and test("^sha256:[0-9a-f]{64}$");
def e0_positive_string: type == "string" and test("^[1-9][0-9]*$");
def e0_integer: type == "number" and . >= 0 and . <= 9007199254740991 and floor == .;
def e0_positive_integer: e0_integer and . >= 1;
def e0_nonempty: type == "string" and length >= 1;
def e0_login:
  type == "string" and length <= 100
  and test("^[A-Za-z0-9][A-Za-z0-9_.\\[\\]-]*$");

def e0_sorted_unique_strings:
  type == "array" and all(.[]; type == "string")
  and . == sort and length == (unique | length);

def e0_ipv4:
  type == "string"
  and (split(".") | length == 4
    and all(.[]; test("^[0-9]{1,3}$") and (tonumber >= 0 and tonumber <= 255)));

def e0_raw_sha256:
  e0_exact_keys(["raw","sha256"])
  and (.raw | type == "object")
  and (.sha256 | e0_hash);

def e0_child_ref($kind):
  e0_exact_keys(["artifactDigest","artifactKind","artifactName","contentSha256",
    "producerRunAttempt","producerRunId"])
  and .artifactKind == $kind
  and (.producerRunId | e0_positive_string)
  and (.producerRunAttempt | e0_positive_integer)
  and (.artifactName | e0_nonempty and (contains("://") | not))
  and (.contentSha256 | e0_hash)
  and (.artifactDigest | e0_digest);

def e0_wht_route_names: [
  "cap.wht50bis/SYSTEM_CONTENT_CORRECTION",
  "cap.wht50bis/SYSTEM_INITIAL_ISSUE",
  "cap.wht50bis/SYSTEM_REPLACEMENT_COPY"
];

def e0_wht_routes: [
  {gateKey:"cap.wht50bis",routeKey:"SYSTEM_CONTENT_CORRECTION",state:"CLOSED"},
  {gateKey:"cap.wht50bis",routeKey:"SYSTEM_INITIAL_ISSUE",state:"CLOSED"},
  {gateKey:"cap.wht50bis",routeKey:"SYSTEM_REPLACEMENT_COPY",state:"CLOSED"}
];

def e0_invariant:
  e0_exact_keys(["expectedResultHash","id","queryHash"])
  and (.id | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"))
  and (.queryHash | e0_hash)
  and (.expectedResultHash | e0_hash);

def e0_invariants:
  type == "array" and all(.[]; e0_invariant)
  and . == sort_by(.id) and (map(.id) | length == (unique | length));

def e0_migration_entry:
  e0_exact_keys(["checksumSha256","executionBudget","migrationName","operationClass",
    "postDataInvariants","postSchemaInvariants","preconditions","relativePath"])
  and (.migrationName | type == "string" and test("^[0-9]{14}_[a-z0-9_]+$"))
  and .relativePath == ("apps/api/prisma/migrations/" + .migrationName + "/migration.sql")
  and (.checksumSha256 | e0_hash)
  and (.operationClass == "ADDITIVE"
    or .operationClass == "BACKWARD_COMPATIBLE_NONADDITIVE"
    or .operationClass == "DATA_BACKFILL"
    or .operationClass == "BLOCKING_CONTRACT")
  and (.preconditions | e0_invariants and length >= 1)
  and (.postSchemaInvariants | e0_invariants and length >= 1)
  and (.postDataInvariants | e0_invariants)
  and (if .operationClass == "DATA_BACKFILL"
    then (.postDataInvariants | length >= 1) else .postDataInvariants == [] end)
  and (.executionBudget
    | e0_exact_keys(["lockTimeoutMs","statementTimeoutMs"])
      and (.lockTimeoutMs | e0_positive_integer and . <= 5000)
      and (.statementTimeoutMs | e0_positive_integer and . <= 300000));

def e0_migration_manifest:
  type == "array" and length >= 1 and all(.[]; e0_migration_entry)
  and . == sort_by(.relativePath)
  and (map(.relativePath) | length == (unique | length));

def e0_schema_object:
  e0_exact_keys(["definition","kind","name","relation","schema"])
  and (.kind == "RELATION" or .kind == "COLUMN" or .kind == "INDEX"
    or .kind == "CONSTRAINT" or .kind == "ENUM_VALUE")
  and (.schema | e0_nonempty) and (.name | e0_nonempty) and (.definition | type == "string")
  and (.relation == null or (.relation | e0_nonempty));

def e0_schema_objects:
  type == "array" and all(.[]; e0_schema_object)
  and . == sort_by([.kind,.schema,(.relation // ""),.name])
  and (map([.kind,.schema,(.relation // ""),.name]) | length == (unique | length));

def e0_route:
  e0_exact_keys(["gateKey","routeKey","state"])
  and (.gateKey | e0_nonempty) and (.routeKey | e0_nonempty)
  and (.state == "OPEN" or .state == "CLOSED");

def e0_routes:
  type == "array" and all(.[]; e0_route)
  and . == sort_by([.gateKey,.routeKey])
  and (map([.gateKey,.routeKey]) | length == (unique | length));

def e0_applied_migration:
  e0_exact_keys(["appliedOrder","checksum","name"])
  and (.name | type == "string" and test("^[0-9]{14}_[a-z0-9_]+$"))
  and (.checksum | e0_hash)
  and (.appliedOrder | e0_positive_integer);

def e0_applied_migrations:
  type == "array" and all(.[]; e0_applied_migration)
  and . == sort_by(.appliedOrder)
  and (map(.name) | length == (unique | length))
  and (map(.appliedOrder) | length == (unique | length));

def e0_reviewed_manifest:
  e0_exact_keys(["catalogScope","expectedClosedWhtRoutes","expectedSeededRoutes",
    "postSchemaCatalogObjects","preSchemaCatalogObjects","reviewedMigrationManifest","schemaVersion"])
  and .schemaVersion == 3
  and .catalogScope == {version:1,schema:"public",
    objectKinds:["COLUMN","CONSTRAINT","ENUM_VALUE","INDEX","RELATION"]}
  and (.reviewedMigrationManifest | e0_migration_manifest)
  and (.preSchemaCatalogObjects | e0_schema_objects)
  and (.postSchemaCatalogObjects | e0_schema_objects)
  and all((.preSchemaCatalogObjects + .postSchemaCatalogObjects)[]; .schema == "public")
  and (.expectedSeededRoutes | e0_routes and length == 20)
  and (.expectedClosedWhtRoutes | e0_routes and . == e0_wht_routes);

def e0_schema_catalog_delta($manifest):
  ($manifest.preSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $before
  | ($manifest.postSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $after
  | (($before|keys) + ($after|keys) | unique | sort)
  | map(select(($before[.] // null) != ($after[.] // null))
      | {key:.,before:($before[.] // null),after:($after[.] // null)});

def e0_invariant_result($expected):
  . as $actual
  | e0_exact_keys(["actualResultHash","expectedResultHash","id","migrationName","queryHash"])
  and (.migrationName | e0_nonempty)
  and (.id | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"))
  and (.queryHash | e0_hash) and (.expectedResultHash | e0_hash) and (.actualResultHash | e0_hash)
  and .actualResultHash == .expectedResultHash
  and any($expected[]; . as $wanted
    | $actual.migrationName == $wanted.migrationName and $actual.id == $wanted.id
      and $actual.queryHash == $wanted.queryHash
      and $actual.expectedResultHash == $wanted.expectedResultHash);

def e0_invariant_result_set($expected; $must_run):
  e0_exact_keys(["results","resultsHash","status"])
  and (if $must_run then
    .status == "VERIFIED" and (.resultsHash | e0_hash)
    and (.results | type == "array" and length == ($expected | length)
      and . == sort_by([.migrationName,.id])
      and (map([.migrationName,.id]) | length == (unique | length))
      and all(.[]; e0_invariant_result($expected)))
  else . == {status:"NOT_RUN",results:null,resultsHash:null} end);

def e0_expected_invariants($manifest; $member):
  [$manifest[] as $migration
    | $migration[$member][]
    | . + {migrationName:$migration.migrationName}]
  | sort_by([.migrationName,.id]);

def e0_executed_migrations($manifest; $must_run):
  e0_exact_keys(["migrations","migrationsHash","status"])
  and (if $must_run then
    .status == "VERIFIED" and (.migrationsHash | e0_hash)
    and (.migrations | type == "array" and length == ($manifest | length)
      and . == sort_by(.relativePath)
      and (map(.relativePath) | length == (unique | length))
      and all(.[]; . as $actual
        | e0_exact_keys(["checksumSha256","executionOrder","migrationName","relativePath"])
          and (.executionOrder | e0_positive_integer)
          and any($manifest[]; . as $reviewed
            | $actual.relativePath == $reviewed.relativePath
              and $actual.migrationName == $reviewed.migrationName
              and $actual.checksumSha256 == $reviewed.checksumSha256))
      and (map(.executionOrder) == (map(.executionOrder) | sort)
        and (map(.executionOrder) | length == (unique | length))))
  else . == {status:"NOT_RUN",migrations:null,migrationsHash:null} end);

def e0_budget_observation($manifest; $apply_window):
  . as $observation
  | e0_exact_keys(["effectiveLockTimeoutMs","effectiveStatementTimeoutMs",
    "lockTimeoutEnforced","lockWaitBelowTimeout",
    "maintenanceWindowFinishedAtEpochMs","maintenanceWindowId",
    "maintenanceWindowStartedAtEpochMs","migrationName","observedStatementDurationMs",
    "statementTimeoutEnforced"])
  and .effectiveLockTimeoutMs == 2000
  and .effectiveStatementTimeoutMs == 300000
  and .lockTimeoutEnforced == true and .statementTimeoutEnforced == true
  and .lockWaitBelowTimeout == true
  and (.observedStatementDurationMs | e0_integer)
  and (.maintenanceWindowStartedAtEpochMs | e0_positive_integer)
  and (.maintenanceWindowFinishedAtEpochMs | e0_positive_integer)
  and any($manifest[]; . as $migration
    | $migration.migrationName == $observation.migrationName
      and $observation.effectiveLockTimeoutMs <= $migration.executionBudget.lockTimeoutMs
      and $observation.effectiveStatementTimeoutMs <= $migration.executionBudget.statementTimeoutMs
      and $observation.observedStatementDurationMs <= $migration.executionBudget.statementTimeoutMs
      and $observation.maintenanceWindowFinishedAtEpochMs > $observation.maintenanceWindowStartedAtEpochMs
      and ($observation.maintenanceWindowFinishedAtEpochMs
        - $observation.maintenanceWindowStartedAtEpochMs) <= 1800000
      and (if $apply_window == null then true else
        $observation.maintenanceWindowId == $apply_window.windowId
        and $observation.maintenanceWindowStartedAtEpochMs >= $apply_window.startsAtEpochMs
        and $observation.maintenanceWindowFinishedAtEpochMs <= $apply_window.endsAtEpochMs
      end));

def e0_budget_results($manifest; $apply_window):
  type == "array" and length == ($manifest | length)
  and . == sort_by(.migrationName)
  and (map(.migrationName) | length == (unique | length))
  and all(.[]; e0_budget_observation($manifest; $apply_window));

def e0_clone_rehearsal($manifest; $source_applied_migrations_hash; $hashes):
  . as $clone
  | (e0_expected_invariants($manifest; "preconditions")) as $preconditions
  | (e0_expected_invariants($manifest; "postSchemaInvariants")) as $post_schema
  | (e0_expected_invariants($manifest; "postDataInvariants")) as $post_data
  | e0_exact_keys(["cleanup","engine","engineVersion","executedMigrations",
      "executionBudgetResults","executionBudgetResultsHash","expectedDataTransformHash",
      "expectedSchemaDeltaHash","postDataResults","postSchemaResults","preconditionResults",
      "result","resultHash","resultSchemaCatalogFingerprint","reviewedMigrationOperationsHash",
      "sourceAppliedMigrationsHash","sourceDatabaseFingerprint","sourceSchemaCatalogFingerprint"])
  and .result == "PASSED" and .engine == "PostgreSQL"
  and (.engineVersion | type == "string" and test("^18(\\.[0-9]+){1,2}$"))
  and (.sourceDatabaseFingerprint | e0_hash)
  and (.sourceAppliedMigrationsHash | e0_hash)
  and .sourceAppliedMigrationsHash == $source_applied_migrations_hash
  and (.sourceSchemaCatalogFingerprint | e0_hash)
  and (.resultSchemaCatalogFingerprint | e0_hash)
  and .reviewedMigrationOperationsHash == $hashes.reviewedMigrationOperationsHash
  and .expectedSchemaDeltaHash == $hashes.expectedSchemaDeltaHash
  and .expectedDataTransformHash == $hashes.expectedDataTransformHash
  and ($clone.preconditionResults | e0_invariant_result_set($preconditions; true))
  and ($clone.postSchemaResults | e0_invariant_result_set($post_schema; true))
  and ($clone.postDataResults | e0_invariant_result_set($post_data; true))
  and ($clone.executedMigrations | e0_executed_migrations($manifest; true))
  and ($clone.executionBudgetResultsHash | e0_hash)
  and ($clone.executionBudgetResults | e0_budget_results($manifest; null))
  and ($clone.cleanup
    | e0_exact_keys(["cloneIdentifierHash","destroyedAtEpochMs","residualObjectCount","status"])
      and .status == "DESTROYED" and (.cloneIdentifierHash | e0_hash)
      and (.destroyedAtEpochMs | e0_positive_integer) and .residualObjectCount == 0)
  and (.resultHash | e0_hash);

def e0_verification_evidence($manifest; $stage; $source_applied_migrations_hash; $hashes; $apply_window):
  . as $verification
  | (e0_expected_invariants($manifest; "preconditions")) as $preconditions
  | (e0_expected_invariants($manifest; "postSchemaInvariants")) as $post_schema
  | (e0_expected_invariants($manifest; "postDataInvariants")) as $post_data
  | ($stage != "PRE_MUTATION") as $post_must_run
  | e0_exact_keys(["cloneRehearsal","cloneRehearsalRef","executedMigrations","executionBudgetResults",
      "executionBudgetResultsHash","postDataResults","postSchemaResults","preconditionResults"])
  and (.cloneRehearsalRef | e0_child_ref("PRODUCTION_A5_CLONE_REHEARSAL_V1"))
  and ($verification.preconditionResults | e0_invariant_result_set($preconditions; true))
  and ($verification.postSchemaResults | e0_invariant_result_set($post_schema; $post_must_run))
  and ($verification.postDataResults | e0_invariant_result_set($post_data; $post_must_run))
  and ($verification.executedMigrations | e0_executed_migrations($manifest; $post_must_run))
  and ($verification.executionBudgetResultsHash | e0_hash)
  and ($verification.executionBudgetResults
    | e0_budget_results($manifest; if $stage == "PRE_MUTATION" then null else $apply_window end))
  and ($verification.cloneRehearsal
    | e0_clone_rehearsal($manifest;
        $verification.cloneRehearsal.sourceAppliedMigrationsHash; $hashes))
  and (if $stage == "PRE_MUTATION" then
    $verification.cloneRehearsal.sourceAppliedMigrationsHash == $source_applied_migrations_hash
  else true end)
  and (if $stage == "PRE_MUTATION" then
    $verification.cloneRehearsal.preconditionResults == $verification.preconditionResults
    and $verification.cloneRehearsal.executionBudgetResults == $verification.executionBudgetResults
    and $verification.cloneRehearsal.executionBudgetResultsHash
      == $verification.executionBudgetResultsHash
  else true end);

def e0_migration_risk($manifest):
  e0_exact_keys(["additiveCount","backwardCompatibleNonadditiveCount","blockingContractCount",
    "candidateCount","dataBackfillCount","destructiveCustomerDataLossCount",
    "manualCustomerInputCount","unreviewedCount"])
  and (.candidateCount | e0_integer) and .candidateCount == ($manifest | length)
  and (.additiveCount | e0_integer)
  and .additiveCount == ([$manifest[] | select(.operationClass == "ADDITIVE")] | length)
  and (.backwardCompatibleNonadditiveCount | e0_integer)
  and .backwardCompatibleNonadditiveCount
    == ([$manifest[] | select(.operationClass == "BACKWARD_COMPATIBLE_NONADDITIVE")] | length)
  and (.dataBackfillCount | e0_integer)
  and .dataBackfillCount == ([$manifest[] | select(.operationClass == "DATA_BACKFILL")] | length)
  and (.blockingContractCount | e0_integer)
  and .blockingContractCount == ([$manifest[] | select(.operationClass == "BLOCKING_CONTRACT")] | length)
  and .destructiveCustomerDataLossCount == 0
  and .manualCustomerInputCount == 0
  and .unreviewedCount == 0;

def e0_env_values($active; $name):
  [$active.primaryContainer.environment[]? | select(.name == $name) | .value];

def e0_serving_controls($service; $active; $mode):
  if $service == "api-web" then
    e0_env_values($active; "GLOBAL_MAINTENANCE_MODE")
        == [if $mode == "live" then "false" else "true" end]
    and e0_env_values($active; "AI_GATEWAY_ENABLED")
        == [if $mode == "live" then "true" else "false" end]
    and e0_env_values($active; "LINE_AI_LEDGER_ENABLED")
        == [if $mode == "live" then "true" else "false" end]
    and e0_env_values($active; "REIMBURSEMENT_WRITE_QUIESCE")
        == [if $mode == "live" then "false" else "true" end]
    and (e0_env_values($active; "CRM_AUTO_REPLY_ENABLED") as $crm
      | if $mode == "live" then ($crm == ["true"] or $crm == ["false"])
        else $crm == ["false"] end)
  elif $service == "ai-gateway" then
    e0_env_values($active; "MODEL_PROVIDER") as $providers
    | e0_env_values($active; "APPROVED_AI_PROVIDERS") as $approved
    | (if $mode == "live" then (($providers == ["bedrock"] or $providers == ["openai"])
        and ($approved | length) == 1
        and ($approved[0] | split(",") | map(gsub("^\\s+|\\s+$"; ""))
          | index($providers[0])) != null)
      else $providers == ["disabled"] end)
    and e0_env_values($active; "AI_GLOBAL_INFERENCE_PROFILE_APPROVED")
      == [if $mode == "live" then "true" else empty end]
    and (e0_env_values($active; "AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF") as $refs
      | if $mode == "live" then ($refs | length) == 1 and ($refs[0] | length) > 0
        else $refs == [] end)
    and all(["LINE_AI_AGENT_ORCHESTRATION_ENABLED","LINE_AI_TOOLUSE_LOOP_ENABLED",
      "LINE_AI_COVERAGE_CRITIC_ENABLED","AI_GATEWAY_ENABLED","AI_AGENT_REGISTRY_ENABLED",
      "AI_TOOL_POLICY_ENFORCED","AI_TOOL_AUDIT_ENABLED"][];
      e0_env_values($active; .) == [if $mode == "live" then "true" else "false" end])
    and e0_env_values($active; "AI_FINAL_MUTATION_ENABLED") == ["false"]
    and e0_env_values($active; "AI_PROMPT_LOGGING_ENABLED") == ["false"]
  elif $service == "workers" then
    e0_env_values($active; "QUEUE_ENABLED")
      == [if $mode == "live" then "true" else "false" end]
  else false end;

def e0_legacy_production_live($service; $active):
  {
    "ai-gateway":{
      source:"eb515b9e1e92ca970bd14c67fdeebb6f859cf838",
      image:"311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-ai-gateway@sha256:8a159d8e1f3047ec0698f8b4e5209502129f2b2ebed8ba9e043abeff1bce3011",
      controls:{
        MODEL_PROVIDER:["bedrock"],APPROVED_AI_PROVIDERS:["bedrock,openai,typhoon"],
        AI_GLOBAL_INFERENCE_PROFILE_APPROVED:["true"],
        AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF:["DPO-2026-07-23-bedrock-global"],
        LINE_AI_AGENT_ORCHESTRATION_ENABLED:["true"],LINE_AI_TOOLUSE_LOOP_ENABLED:["true"],
        LINE_AI_COVERAGE_CRITIC_ENABLED:["true"],AI_GATEWAY_ENABLED:["true"],
        AI_AGENT_REGISTRY_ENABLED:["true"],AI_TOOL_POLICY_ENFORCED:["true"],
        AI_TOOL_AUDIT_ENABLED:["true"],AI_FINAL_MUTATION_ENABLED:["false"],
        AI_PROMPT_LOGGING_ENABLED:["false"]}},
    "api-web":{
      source:"eb515b9e1e92ca970bd14c67fdeebb6f859cf838",
      image:"311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:9c655e1a06ba0d4acb4bcfbd2975aac57ef5e34ef25cc455ae8e1c1f59c46e1c",
      controls:{GLOBAL_MAINTENANCE_MODE:[],AI_GATEWAY_ENABLED:["true"],
        CRM_AUTO_REPLY_ENABLED:["true"],LINE_AI_LEDGER_ENABLED:["true"],
        REIMBURSEMENT_WRITE_QUIESCE:["false"]}},
    workers:{
      source:"0bdbe5088c2e121b74c74da9f28bf2a64e3576d7",
      image:"311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-workers@sha256:e9495744a9708d04c06564f6ddb2fd66342c3ccca87efd77d7e02fdce786c23f",
      controls:{QUEUE_ENABLED:["true"]}}
  }[$service] as $legacy
  | $legacy != null
  and $active.primaryContainer.image == $legacy.image
  and e0_env_values($active; "GIT_SHA") == [$legacy.source]
  and all(($legacy.controls | to_entries)[];
    . as $control | e0_env_values($active; $control.key) == $control.value);

def e0_health_service($issued_at):
  . as $service
  | (if .service == "api-web" then {
      arn:"arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub",
      parameter:"/watchdog-bms/production/ecs-express-api-web-url",path:"/v1/health"
    } elif .service == "ai-gateway" then {
      arn:"arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-ai-gateway-v2",
      parameter:"/watchdog-bms/production/ecs-express-ai-gateway-url",path:"/v1/health"
    } elif .service == "workers" then {
      arn:"arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-workers",
      parameter:"/watchdog-bms/production/ecs-express-workers-url",path:"/health"
    } else null end) as $expected
  | .rawEvidence as $raw
  | e0_exact_keys(["containerName","containerPort","currentDeployment","healthBody","healthPath",
      "healthUrl","httpStatus","ingress","observedAtEpoch","rawEvidence","runningTaskArns","runningTaskPrivateIps",
      "scalingTarget","service","serviceArn","serviceRevisionArn","serviceStatus","servingMode",
      "ssmUrlParameter","targetGroupArn","targetHealth","taskDefinition"])
  and $expected != null
  and .serviceArn == $expected.arn
  and (.serviceRevisionArn | type == "string"
    and test("^arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/"
      + ($expected.arn | split("/")[-1]) + "/[1-9][0-9]*$"))
  and .serviceStatus == "ACTIVE"
  and .currentDeployment == null
  and (.servingMode == "live" or .servingMode == "maintenance_only")
  and .containerName == "Main"
  and (.containerPort | e0_positive_integer and . <= 65535)
  and (.ingress
    | e0_exact_keys(["accessType","endpoint"])
      and .accessType == "PUBLIC"
      and (.endpoint | type == "string"
        and test("^https://[a-z0-9][a-z0-9.-]*$") and (endswith("/") | not)))
  and .ssmUrlParameter == $expected.parameter
  and .healthPath == $expected.path
  and .healthUrl == (.ingress.endpoint + .healthPath)
  and .httpStatus == 200
  and (.healthBody | type == "object" and .status == "ok"
    and (tojson | utf8bytelength) <= 16384)
  and (.observedAtEpoch | e0_positive_integer)
  and .observedAtEpoch <= $issued_at and ($issued_at - .observedAtEpoch) <= 300
  and (.taskDefinition as $task_definition
    | $task_definition
    | e0_exact_keys(["arn","revision"])
      and ($task_definition.arn | type == "string"
        and test("^arn:aws:ecs:ap-southeast-1:311414082667:task-definition/[A-Za-z0-9_-]+:[1-9][0-9]*$"))
      and ($task_definition.revision | e0_positive_integer)
      and ($task_definition.arn | endswith(":" + ($task_definition.revision | tostring))))
  and (.scalingTarget
    | e0_exact_keys(["autoScalingMetric","autoScalingTargetValue","maxTaskCount","minTaskCount"])
      and .minTaskCount == 1
      and .maxTaskCount == 2
      and .autoScalingMetric == "AVERAGE_CPU"
      and .autoScalingTargetValue == 70)
  and (.runningTaskArns | e0_sorted_unique_strings and length >= 1
    and all(.[]; test("^arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/[0-9a-f]{32}$")))
  and (.runningTaskPrivateIps | e0_sorted_unique_strings and length == ($service.runningTaskArns | length)
    and all(.[]; e0_ipv4))
  and (.targetGroupArn | type == "string"
    and test("^arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:targetgroup/[^/]+/[0-9a-f]+$"))
  and (.targetHealth | type == "array" and length >= 1
    and . == sort_by(.privateIp)
    and (map(.privateIp) | length == (unique | length))
    and all(.[]; e0_exact_keys(["port","privateIp","state"])
      and (.privateIp | e0_ipv4)
      and (.port | e0_positive_integer and . <= 65535)
      and .port == $service.containerPort and .state == "healthy"))
  and .runningTaskPrivateIps == [.targetHealth[].privateIp]
  and ($raw
    | e0_exact_keys(["describeExpressGatewayService","describeNetworkInterfaces",
        "describeServiceRevisions","describeTargetGroups","describeTargetHealth",
        "describeTasks","listTasks","publicHealth","ssmParameter"])
      and all(.[]; e0_raw_sha256))
  and ($raw.describeExpressGatewayService.raw
    | e0_exact_keys(["first","second"])
      and .first == .second
      and (.first.service as $express
        | $express.serviceArn == $service.serviceArn
          and $express.status.statusCode == "ACTIVE"
          and $express.currentDeployment == null
          and ($express.activeConfigurations | type == "array" and length == 1)
          and $express.activeConfigurations[0].serviceRevisionArn == $service.serviceRevisionArn
          and $express.activeConfigurations[0].scalingTarget == $service.scalingTarget
          and $express.activeConfigurations[0].primaryContainer.containerPort
            == $service.containerPort
          and (e0_env_values($express.activeConfigurations[0]; "PRODUCTION_SERVING_MODE")
              == [$service.servingMode]
            and e0_serving_controls($service.service;
              $express.activeConfigurations[0]; $service.servingMode)
            or (e0_env_values($express.activeConfigurations[0]; "PRODUCTION_SERVING_MODE") == []
              and $service.servingMode == "live"
              and e0_legacy_production_live($service.service;
                $express.activeConfigurations[0])))
          and ($express.activeConfigurations[0].ingressPaths | type == "array" and length == 1)
          and $express.activeConfigurations[0].ingressPaths[0].accessType == "PUBLIC"
          and ("https://" + $express.activeConfigurations[0].ingressPaths[0].endpoint)
            == $service.ingress.endpoint))
  and ($raw.describeServiceRevisions.raw.serviceRevisions
    | type == "array" and length == 1)
  and ($raw.describeServiceRevisions.raw.serviceRevisions[0] as $revision
    | $revision.serviceArn == $service.serviceArn
      and $revision.serviceRevisionArn == $service.serviceRevisionArn
      and $revision.taskDefinition == $service.taskDefinition.arn
      and ($revision.resolvedConfiguration.loadBalancers | type == "array" and length == 1)
      and $revision.resolvedConfiguration.loadBalancers[0].targetGroupArn
        == $service.targetGroupArn
      and ($revision.loadBalancers | type == "array" and length == 1)
      and $revision.loadBalancers[0].containerName == $service.containerName
      and $revision.loadBalancers[0].containerPort == $service.containerPort
      and ($revision.loadBalancers[0].targetGroupArn as $primary
        | $revision.loadBalancers[0].advancedConfiguration.alternateTargetGroupArn as $alternate
        | $primary != $alternate
          and ($service.targetGroupArn == $primary or $service.targetGroupArn == $alternate))
      and ($revision.ecsManagedResources.autoScaling.scalableTarget as $target
        | $target.minCapacity == $service.scalingTarget.minTaskCount
          and $target.maxCapacity == $service.scalingTarget.maxTaskCount
          and $target.status == "ACTIVE")
      and ($revision.ecsManagedResources.autoScaling.applicationAutoScalingPolicies
        | type == "array" and length == 1)
      and ($revision.ecsManagedResources.autoScaling.applicationAutoScalingPolicies[0] as $policy
        | $policy.metric == $service.scalingTarget.autoScalingMetric
          and $policy.targetValue == $service.scalingTarget.autoScalingTargetValue
          and $policy.policyType == "TargetTrackingScaling" and $policy.status == "ACTIVE")
      and (([ $revision.ecsManagedResources.ingressPaths[]
        | select(.accessType == "PUBLIC"
          and ("https://" + .endpoint) == $service.ingress.endpoint)
        | .targetGroups[]
        | select(.arn == $service.targetGroupArn and .healthCheckPath == $service.healthPath
          and .healthCheckPort == $service.containerPort
          and .port == (if $service.targetGroupArn == $revision.loadBalancers[0].targetGroupArn
            then $service.containerPort else 0 end)
          and .status == "ACTIVE") ] | length) == 1)
      and (([ $revision.ecsManagedResources.ingressPaths[]
        | select(.accessType == "PUBLIC"
          and ("https://" + .endpoint) == $service.ingress.endpoint)
        | .targetGroups[]
        | select(.arn == (if $service.targetGroupArn == $revision.loadBalancers[0].targetGroupArn
            then $revision.loadBalancers[0].advancedConfiguration.alternateTargetGroupArn
            else $revision.loadBalancers[0].targetGroupArn end)
          and .healthCheckPath == $service.healthPath
          and .healthCheckPort == $service.containerPort
          and .port == (if $service.targetGroupArn == $revision.loadBalancers[0].targetGroupArn
            then 0 else $service.containerPort end)
          and .status == "ACTIVE") ] | length) == 1))
  and ($raw.listTasks.raw
    | (.taskArns | type == "array" and length >= 1 and all(.[]; type == "string")
        and length == (unique | length))
      and (.nextToken // null) == null
      and (.taskArns | sort) == $service.runningTaskArns)
  and ($raw.describeTasks.raw
    | .failures == []
      and (.tasks | type == "array" and length == ($service.runningTaskArns | length))
      and ([.tasks[].taskArn] | sort) == $service.runningTaskArns
      and all(.tasks[];
        .lastStatus == "RUNNING" and .desiredStatus == "RUNNING"
        and .taskDefinitionArn == $service.taskDefinition.arn
        and .group == ("service:" + ($service.serviceArn | split("/")[-1]))
        and ([.attachments[] | select(.type == "ElasticNetworkInterface")
          | .details[] | select(.name == "privateIPv4Address") | .value] | length) == 1)
      and ([.tasks[].attachments[] | select(.type == "ElasticNetworkInterface")
        | .details[] | select(.name == "privateIPv4Address") | .value] | sort)
        == $service.runningTaskPrivateIps)
  and ($raw.describeNetworkInterfaces.raw
    | (.NetworkInterfaces | type == "array" and length == ($service.runningTaskArns | length))
      and ([.NetworkInterfaces[].PrivateIpAddress] | sort) == $service.runningTaskPrivateIps
      and all(.NetworkInterfaces[]; .Status == "in-use"))
  and ($raw.describeTargetGroups.raw.TargetGroups
    | type == "array" and length == 1
      and .[0].TargetGroupArn == $service.targetGroupArn
      and .[0].TargetType == "ip"
      and .[0].Protocol == "HTTP" and .[0].Port == 80
      and .[0].HealthCheckPort == ($service.containerPort | tostring)
      and .[0].HealthCheckPath == $service.healthPath)
  and ($raw.describeTargetHealth.raw.TargetHealthDescriptions
    | type == "array" and length >= 1
      and all(.[]; .TargetHealth.State == "healthy" and (.Target.Id | e0_ipv4)
        and (.Target.Port | e0_positive_integer and . == $service.containerPort))
      and ([.[] | {privateIp:.Target.Id,port:.Target.Port,state:.TargetHealth.State}]
        | sort_by(.privateIp))
        == $service.targetHealth)
  and ($raw.ssmParameter.raw.Parameter
    | .Name == $service.ssmUrlParameter and .Type == "String"
      and .Value == $service.ingress.endpoint)
  and ($raw.publicHealth.raw
    | e0_exact_keys(["body","checkedAtEpoch","httpStatus","url"])
      and .url == $service.healthUrl
      and .httpStatus == $service.httpStatus
      and .body == $service.healthBody
      and .checkedAtEpoch == $service.observedAtEpoch);

def e0_current_health($issued_at):
  e0_exact_keys(["observedAtEpoch","services","servicesHash","status"])
  and .status == "PASS"
  and (.observedAtEpoch | e0_positive_integer)
  and .observedAtEpoch <= $issued_at and ($issued_at - .observedAtEpoch) <= 300
  and (.services | type == "array" and map(.service) == ["ai-gateway","api-web","workers"]
    and all(.[]; e0_health_service($issued_at)))
  and (.servicesHash | e0_hash);

def e0_maintenance_window:
  e0_exact_keys(["endsAtEpochMs","failurePolicy","startsAtEpochMs","windowId"])
  and (.windowId | type == "string" and test("^u5e-[1-9][0-9]*-a[1-9][0-9]*-[1-9][0-9]*-a[1-9][0-9]*$"))
  and (.startsAtEpochMs | e0_positive_integer)
  and (.endsAtEpochMs | e0_positive_integer)
  and .endsAtEpochMs > .startsAtEpochMs
  and (.endsAtEpochMs - .startsAtEpochMs) <= 1800000
  and .failurePolicy == "LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL";

def e0_production_apply_authority:
  e0_exact_keys(["maintenanceWindow","ownerApprovalRef"])
  and (.ownerApprovalRef | e0_child_ref("OWNER_U5E_APPROVAL_V1"))
  and (.maintenanceWindow | e0_maintenance_window);

def e0_reader_boundary:
  e0_exact_keys(["coreRlsVisible","defaultReadOnly","noCreateOrDmlOrMaintain",
    "noExecutableSecurityDefiner","noOutsideCoreSelect","noOwnershipOrMembership",
    "noTaskRole","nonPrivileged","role","transactionReadOnly"])
  and . == {
    role:"watchdog_a5_prod_ro",defaultReadOnly:true,transactionReadOnly:true,
    noTaskRole:true,nonPrivileged:true,noCreateOrDmlOrMaintain:true,
    noOutsideCoreSelect:true,noExecutableSecurityDefiner:true,
    noOwnershipOrMembership:true,coreRlsVisible:true
  };

def e0_reader_stage_slug($stage):
  if $stage == "PRE_MUTATION" then "pre"
  elif $stage == "POST_MIGRATION" then "post-migration"
  elif $stage == "POST_DEPLOYMENT" then "post-deployment"
  else error("invalid production A5 reader stage") end;

def e0_a5_endpoint_boundary:
  e0_exact_keys(["authorizedTaskSecurityGroupIds","endpointSecurityGroupId",
    "interfaceEndpoints","natGatewayRoutePresent","policies","publicInternetGatewayRoutePresent",
    "rawEvidence","s3GatewayEndpoint","s3PrefixListId","taskRouteTableIds",
    "taskSecurityGroupsAllowNatEgress","taskSubnetIds","vpcId"])
  and (.vpcId | type=="string" and test("^vpc-[0-9a-f]{8,17}$"))
  and (.endpointSecurityGroupId | type=="string" and test("^sg-[0-9a-f]{8,17}$"))
  and (.authorizedTaskSecurityGroupIds | e0_sorted_unique_strings and length==6
    and all(.[];test("^sg-[0-9a-f]{8,17}$")))
  and (.taskSubnetIds | e0_sorted_unique_strings and length==2
    and all(.[];test("^subnet-[0-9a-f]{8,17}$")))
  and (.taskRouteTableIds | e0_sorted_unique_strings and length>=1 and length<=2
    and all(.[];test("^rtb-[0-9a-f]{8,17}$")))
  and (.s3PrefixListId | type=="string" and test("^pl-[0-9a-f]{8,17}$"))
  and (.interfaceEndpoints | type=="array" and .==sort_by(.serviceName)
    and map(.serviceName)==["com.amazonaws.ap-southeast-1.ecr.api",
      "com.amazonaws.ap-southeast-1.ecr.dkr","com.amazonaws.ap-southeast-1.logs",
      "com.amazonaws.ap-southeast-1.secretsmanager"]
    and all(.[];e0_exact_keys(["serviceName","vpcEndpointId"])
      and (.vpcEndpointId|type=="string" and test("^vpce-[0-9a-f]{8,17}$"))))
  and (.s3GatewayEndpoint | e0_exact_keys(["serviceName","vpcEndpointId"])
    and .serviceName=="com.amazonaws.ap-southeast-1.s3"
    and (.vpcEndpointId|type=="string" and test("^vpce-[0-9a-f]{8,17}$")))
  and (.natGatewayRoutePresent|type=="boolean")
  and .publicInternetGatewayRoutePresent==false
  and .taskSecurityGroupsAllowNatEgress==false
  and (.policies | e0_exact_keys(["ecrSha256","logsSha256","s3Sha256",
      "secretsManagerSha256"]) and all(.[];e0_hash))
  and (.rawEvidence | e0_exact_keys(["describeEndpointSecurityGroupSha256",
      "describeRouteTablesSha256","describeVpcEndpointsSha256"])
    and all(.[];e0_hash));

def e0_reader_runtime_producer($run; $attempt; $stage):
  (e0_reader_stage_slug($stage)) as $slug
  | (if $stage == "PRE_MUTATION" then "p"
     elif $stage == "POST_MIGRATION" then "m" else "d" end) as $short_stage
  | ("watchdog-a5-production-reader-" + $run + "-a" + ($attempt|tostring) + "-" + $slug) as $family
  | .taskDefinition.family == $family
  and .taskDefinition.arn == ("arn:aws:ecs:ap-southeast-1:311414082667:task-definition/"
    + $family + ":" + (.taskDefinition.revision|tostring))
  and .task.startedBy == ("a5r-" + $run + "-a" + ($attempt|tostring) + "-" + $short_stage)
  and .output.marker == ("a5-prod-" + $run + "-a" + ($attempt|tostring) + "-" + $slug);

def e0_reader_runtime($evidence; $stage):
  . as $runtime
  | e0_exact_keys(["clusterArn","inputBundleSha256","migrationImage","network","output",
      "readerSecret","schemaVersion","sourceCommit","stage","task","taskDefinition"])
  and .schemaVersion == 1
  and .sourceCommit == $evidence.sourceCommit
  and .stage == $stage
  and (.migrationImage | type == "string"
    and test("^311414082667\\.dkr\\.ecr\\.ap-southeast-1\\.amazonaws\\.com/"
      + "watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$"))
  and .clusterArn == "arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod"
  and (.readerSecret
    | e0_exact_keys(["arn","metadataSha256","versionId","versionStage"])
      and (.arn | type == "string"
        and test("^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"
          + "watchdog-bms/production/a5-readonly-database-url-[A-Za-z0-9/_+=.@-]+$"))
      and (.versionId | type == "string" and test("^[A-Fa-f0-9-]{32,64}$"))
      and .versionStage == "AWSCURRENT"
      and (.metadataSha256 | e0_hash))
  and (.taskDefinition as $definition
    | $definition
    | e0_exact_keys(["arn","executionRoleArn","family","revision","sha256","taskRoleArn"])
      and ($definition.family | type == "string"
        and test("^watchdog-a5-production-reader-[1-9][0-9]*-a[1-9][0-9]*-"
          + "(pre|post-migration|post-deployment)$"))
      and ($definition.revision | e0_positive_integer)
      and ($definition.arn | type == "string"
        and test("^arn:aws:ecs:ap-southeast-1:311414082667:task-definition/"
          + "watchdog-a5-production-reader-[1-9][0-9]*-a[1-9][0-9]*-"
          + "(pre|post-migration|post-deployment):[1-9][0-9]*$"))
      and ($definition.sha256 | e0_hash)
      and $definition.executionRoleArn
        == "arn:aws:iam::311414082667:role/watchdog-bms-production-a5-readonly-execution"
      and $definition.taskRoleArn == null)
  and (.task
    | e0_exact_keys(["arn","describeNetworkInterfacesSha256","describeTasksSha256","exitCode",
        "lastStatus","privateIps","startedBy"])
      and (.arn | type == "string"
        and test("^arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/[0-9a-f]{32}$"))
      and (.startedBy | type == "string"
        and test("^a5r-[1-9][0-9]*-a[1-9][0-9]*-(p|m|d)$"))
      and .lastStatus == "STOPPED" and .exitCode == 0
      and (.privateIps | e0_sorted_unique_strings and length >= 1 and all(.[]; e0_ipv4))
      and (.describeTasksSha256 | e0_hash)
      and (.describeNetworkInterfacesSha256 | e0_hash))
  and (.network
    | e0_exact_keys(["assignPublicIp","databaseInstanceIdentifier",
        "databasePubliclyAccessible","databaseSecurityGroupId","describeDatabaseSecurityGroupSha256",
        "describeDbInstanceSha256","describeEndpointSecurityGroupSha256",
        "describeRouteTablesSha256","describeSubnetsSha256","describeTaskSecurityGroupSha256",
        "describeVpcEndpointsSha256","endpointBoundary","privateSubnetIds","taskSecurityGroupId"])
      and .assignPublicIp == "DISABLED"
      and .databaseInstanceIdentifier == "watchdog-bms-prod-db"
      and .databasePubliclyAccessible == false
      and (.privateSubnetIds | e0_sorted_unique_strings and length == 2
        and all(.[]; test("^subnet-[0-9a-f]{8,17}$")))
      and (.taskSecurityGroupId | type == "string" and test("^sg-[0-9a-f]{8,17}$"))
      and (.databaseSecurityGroupId | type == "string" and test("^sg-[0-9a-f]{8,17}$"))
      and .taskSecurityGroupId != .databaseSecurityGroupId
      and (.endpointBoundary | e0_a5_endpoint_boundary)
      and (.taskSecurityGroupId as $task | .endpointBoundary.authorizedTaskSecurityGroupIds|index($task)!=null)
      and .privateSubnetIds == .endpointBoundary.taskSubnetIds
      and (.describeTaskSecurityGroupSha256 | e0_hash)
      and (.describeDatabaseSecurityGroupSha256 | e0_hash)
      and (.describeSubnetsSha256 | e0_hash)
      and (.describeDbInstanceSha256 | e0_hash)
      and .describeEndpointSecurityGroupSha256
        == .endpointBoundary.rawEvidence.describeEndpointSecurityGroupSha256
      and .describeVpcEndpointsSha256 == .endpointBoundary.rawEvidence.describeVpcEndpointsSha256
      and .describeRouteTablesSha256 == .endpointBoundary.rawEvidence.describeRouteTablesSha256)
  and (.inputBundleSha256 | e0_hash)
  and (.output
    | e0_exact_keys(["eventsSha256","exitCode","frameCount","logGroup","logStream","marker",
        "payloadBytes","payloadSha256"])
      and (.marker | type == "string"
        and test("^a5-prod-[1-9][0-9]*-a[1-9][0-9]*-(pre|post-migration|post-deployment)$"))
      and .logGroup == "/ecs/watchdog-bms-production-a5-readonly"
      and .logStream == ("production-a5/reader/" + ($runtime.task.arn | split("/")[-1]))
      and (.frameCount | e0_positive_integer and . <= 256)
      and (.payloadBytes | e0_positive_integer and . <= 700000)
      and (.payloadSha256 | e0_hash)
      and (.eventsSha256 | e0_hash)
      and .exitCode == 0)
  and ((.taskDefinition.family
      | capture("^watchdog-a5-production-reader-(?<run>[1-9][0-9]*)-a"
          + "(?<attempt>[1-9][0-9]*)-(?<slug>pre|post-migration|post-deployment)$")) as $identity
    | $identity.slug == e0_reader_stage_slug($stage)
      and ($runtime
        | e0_reader_runtime_producer($identity.run; ($identity.attempt|tonumber); $stage)));

def e0_legacy_present: ["CompanyFeatureEntitlement"];
def e0_legacy_absent: [
  "CompanyEntitlementNormalization","EntitlementTransition","ExecutionAttempt",
  "FeatureLaunchGate","FeatureLaunchGateTransition","FeatureLaunchObservationBucket","RunoffSnapshot"
];
def e0_materialized_relations: (e0_legacy_present + e0_legacy_absent | sort);

def e0_schema_profile($stage):
  e0_exact_keys(["expectedLegacyAbsentRelations","expectedLegacyPresentRelations",
    "observedAbsentFingerprint","observedAbsentRelations","observedPresentFingerprint",
    "observedPresentRelations","profile","scopeHash","unexpectedMissing","unexpectedPresent"])
  and (.scopeHash | e0_hash)
  and (.observedPresentFingerprint | e0_hash)
  and (.observedAbsentFingerprint | e0_hash)
  and .expectedLegacyPresentRelations == e0_legacy_present
  and .expectedLegacyAbsentRelations == e0_legacy_absent
  and .unexpectedPresent == [] and .unexpectedMissing == []
  and (if $stage == "PRE_MUTATION" then
    .profile == "LEGACY_PRE_F1_EXPECTED_ABSENT"
    and .observedPresentRelations == e0_legacy_present
    and .observedAbsentRelations == e0_legacy_absent
  else
    .profile == "F1_REVIEWED_MATERIALIZED"
    and .observedPresentRelations == e0_materialized_relations
    and .observedAbsentRelations == []
  end);

def e0_serving_builds($stage; $source):
  type == "array" and length == 3 and . == sort_by(.service)
  and map(.service) == ["ai-gateway","api-web","workers"]
  and all(.[];
    e0_exact_keys(["service","sourceCommit"])
    and (.sourceCommit | e0_sha)
    and (if $stage == "POST_DEPLOYMENT" then .sourceCommit == $source else true end));

def e0_reimbursement_revision_proof($quiesced):
  e0_exact_keys(["activeTaskArns","image","observedAtEpoch","quiesceEnabled",
    "serviceRevisionArn","sourceCommit"])
  and (.sourceCommit | e0_sha)
  and (.image | type == "string"
    and test("^[0-9]{12}\\.dkr\\.ecr\\.ap-southeast-1\\.amazonaws\\.com/watchdog-bms-api@sha256:[0-9a-f]{64}$"))
  and (.serviceRevisionArn | type == "string"
    and test("^arn:aws:ecs:ap-southeast-1:311414082667:service-revision/[^/]+/[^/]+/[^/]+$"))
  and (.activeTaskArns | type == "array" and length >= 1 and . == sort
    and length == (unique | length)
    and all(.[]; type == "string"
      and test("^arn:aws:ecs:ap-southeast-1:311414082667:task/[^/]+/[^/]+$")))
  and .quiesceEnabled == $quiesced
  and (.observedAtEpoch | e0_positive_integer);

def e0_reimbursement_blocked_mutations:
  e0_exact_keys(["count","status"])
  and (if .status == "AVAILABLE" then (.count | e0_integer)
    elif .status == "NOT_AVAILABLE" then .count == null
    else false end);

def e0_reimbursement_quiesce($stage; $source):
  . as $q
  | e0_exact_keys(["acceptedFinalApiImage","acceptedFinalSourceCommit","allActiveTasksGuarded",
      "allBridgeTasksRetired","allPreBridgeTasksRetired","blockedMutations","bridgeProof",
      "durationSeconds","failurePolicy","finalQuiescedProof","finalUnquiescedProof",
      "quiesceEndedAtEpoch","quiesceStartedAtEpoch","reimbursementInvariantHash",
      "sameFinalImageAcrossUnquiesce","status"])
  and .acceptedFinalSourceCommit == $source
  and (.acceptedFinalApiImage | type == "string"
    and test("^[0-9]{12}\\.dkr\\.ecr\\.ap-southeast-1\\.amazonaws\\.com/watchdog-bms-api@sha256:[0-9a-f]{64}$"))
  and (.bridgeProof | e0_reimbursement_revision_proof(true))
  and (.quiesceStartedAtEpoch | e0_positive_integer)
  and .quiesceStartedAtEpoch <= .bridgeProof.observedAtEpoch
  and (.blockedMutations | e0_reimbursement_blocked_mutations)
  and .allActiveTasksGuarded == true and .allPreBridgeTasksRetired == true
  and .failurePolicy == "LEAVE_QUIESCED"
  and (if $stage == "PRE_MUTATION" then
    .status == "BRIDGE_ONLY_QUIESCED"
    and .finalQuiescedProof == null and .finalUnquiescedProof == null
    and .quiesceEndedAtEpoch == null and .durationSeconds == null
    and .reimbursementInvariantHash == null and .allBridgeTasksRetired == null
    and .sameFinalImageAcrossUnquiesce == null
  elif $stage == "POST_MIGRATION" then
    .status == "BRIDGE_ONLY_QUIESCED_POST_MIGRATION"
    and .finalQuiescedProof == null and .finalUnquiescedProof == null
    and .quiesceEndedAtEpoch == null and .durationSeconds == null
    and (.reimbursementInvariantHash | e0_hash) and .allBridgeTasksRetired == null
    and .sameFinalImageAcrossUnquiesce == null
  else
    .status == "FINAL_ONLY_UNQUIESCED"
    and (.finalQuiescedProof | e0_reimbursement_revision_proof(true))
    and (.finalUnquiescedProof | e0_reimbursement_revision_proof(false))
    and .finalQuiescedProof.sourceCommit == .acceptedFinalSourceCommit
    and .finalUnquiescedProof.sourceCommit == .acceptedFinalSourceCommit
    and .finalQuiescedProof.image == .acceptedFinalApiImage
    and .finalUnquiescedProof.image == .acceptedFinalApiImage
    and .finalQuiescedProof.serviceRevisionArn != .finalUnquiescedProof.serviceRevisionArn
    and .finalQuiescedProof.observedAtEpoch <= .finalUnquiescedProof.observedAtEpoch
    and (.quiesceEndedAtEpoch | e0_positive_integer)
    and .finalUnquiescedProof.observedAtEpoch <= .quiesceEndedAtEpoch
    and (.durationSeconds | e0_integer and . <= 1800)
    and .durationSeconds == (.quiesceEndedAtEpoch - .quiesceStartedAtEpoch)
    and (.reimbursementInvariantHash | e0_hash)
    and .allBridgeTasksRetired == true and .sameFinalImageAcrossUnquiesce == true
  end);

def e0_wht_materialization($stage):
  e0_exact_keys(["actualCounts","actualRoutes","reviewedExpectedCounts","reviewedExpectedRoutes","status"])
  and .reviewedExpectedCounts == {total:3,open:0,closed:3}
  and .reviewedExpectedRoutes == e0_wht_routes
  and (if $stage == "PRE_MUTATION" then
    .status == "NOT_MATERIALIZED" and .actualCounts == null and .actualRoutes == []
  else
    .status == "MATERIALIZED" and .actualCounts == {total:3,open:0,closed:3}
    and .actualRoutes == e0_wht_routes
  end);

def e0_authority_snapshot($stage):
  e0_exact_keys(["allowListHash","effectiveOpenPolicyHash","featureLaunchStateHash",
    "launchCatalog","preexistingAuthorityStateHash","preexistingEntitlementStateHash",
    "safeOffAdmissionHash","whtMaterialization"])
  and (.preexistingEntitlementStateHash | e0_hash)
  and (.preexistingAuthorityStateHash | e0_hash)
  and (.effectiveOpenPolicyHash | e0_hash)
  and (.safeOffAdmissionHash | e0_hash)
  and (.allowListHash | e0_hash)
  and (.whtMaterialization | e0_wht_materialization($stage))
  and (if $stage == "PRE_MUTATION" then
    .featureLaunchStateHash == null
    and .launchCatalog == {status:"NOT_MATERIALIZED",materialized:0,expectedAfterMigration:20,unexpected:0}
  else
    (.featureLaunchStateHash | e0_hash)
    and .launchCatalog == {status:"MATERIALIZED",materialized:20,expectedAfterMigration:20,unexpected:0}
  end);

def e0_normalization($stage):
  e0_exact_keys(["drift","incomplete","status","unexpectedOrigin"])
  and (if $stage == "PRE_MUTATION" then
    . == {status:"NOT_MATERIALIZED",incomplete:null,drift:null,unexpectedOrigin:null}
  else
    . == {status:"MATERIALIZED",incomplete:0,drift:0,unexpectedOrigin:0}
  end);

def e0_h2_comparisons($stage):
  e0_exact_keys(["allPreflightConditionsSatisfied","allowListUnchanged","closedWhtMaterialized",
    "effectiveOpenPolicyUnchanged","exactExpectedDataTransformsVerified",
    "exactExpectedSchemaDeltaMaterialized","exactReviewedMigrationSetApplied",
    "exactReviewedSeedMaterialized","lockBudgetSatisfied","postMigrationLaunchStateUnchanged",
    "preexistingAuthorityUnchanged","preexistingEntitlementsUnchanged","safeOffAdmissionsUnchanged"])
  and (if $stage == "PRE_MUTATION" then all(.[]; . == null)
    elif $stage == "POST_MIGRATION" then
      .postMigrationLaunchStateUnchanged == null
      and all(to_entries[] | select(.key != "postMigrationLaunchStateUnchanged"); .value == true)
    else all(.[]; . == true)
  end);

def e0_reimbursement_approval_snapshots:
  e0_exact_keys(["currentStepPending","exactV1Compatible","invalid","invalidCurrentStep",
    "legacyPartialApproved","legacyPartialRejected","missingHash","total","v2Valid"])
  and all(.[]; e0_integer)
  and .total == (.v2Valid + .exactV1Compatible + .missingHash + .invalid)
  and .total == (.currentStepPending + .legacyPartialApproved + .legacyPartialRejected + .invalidCurrentStep)
  and .missingHash == 0 and .invalid == 0
  and .legacyPartialApproved == 0 and .legacyPartialRejected == 0 and .invalidCurrentStep == 0;

def e0_h2($evidence):
  . as $p
  | e0_exact_keys(["authoritySnapshot","baselineRefs","comparisons","databaseFingerprint",
      "currentHealth","migrationState","normalization","passed","queryCatalogHash","readerBoundary",
      "readerRuntime","reimbursementApprovalSnapshots","reimbursementWriteQuiesce",
      "schemaFingerprintScope","schemaProfile","servingBuilds","stage","targetEnvironment"])
  and (.stage == "PRE_MUTATION" or .stage == "POST_MIGRATION" or .stage == "POST_DEPLOYMENT")
  and .targetEnvironment == "production"
  and (.readerBoundary | e0_reader_boundary)
  and (.readerRuntime | e0_reader_runtime($evidence; $p.stage))
  and (.reimbursementApprovalSnapshots | e0_reimbursement_approval_snapshots)
  and (.currentHealth | e0_current_health($evidence.issuedAtEpoch))
  and (.queryCatalogHash | e0_hash) and (.databaseFingerprint | e0_hash)
  and (.schemaProfile | e0_schema_profile($p.stage))
  and .schemaFingerprintScope == {
    included:["tables","columns","types","defaults","nullability","identity","generated","indexes","constraints","enums"],
    excluded:["triggers","views","policies"]
  }
  and (.migrationState as $migration
    | $migration
      | e0_exact_keys(["appliedMigrationsHash","candidateMigrationSetHash","candidateSetApplied",
        "expectedClosedWhtRouteHash","expectedDataTransformHash","expectedSchemaDeltaHash",
        "expectedSeededRouteHash","lockBudgetPolicyHash","migrationRiskSummary","preflightCatalogHash",
        "productionApplyAuthority","reviewedManifest","reviewedMigrationOperationsHash",
        "verificationEvidence"])
      and (.appliedMigrationsHash | e0_hash)
      and (.candidateMigrationSetHash | e0_hash)
      and (.reviewedMigrationOperationsHash | e0_hash)
      and (.expectedSchemaDeltaHash | e0_hash)
      and (.expectedDataTransformHash | e0_hash)
      and (.preflightCatalogHash | e0_hash)
      and (.lockBudgetPolicyHash | e0_hash)
      and (.expectedSeededRouteHash | e0_hash)
      and (.expectedClosedWhtRouteHash | e0_hash)
      and (.reviewedManifest | e0_reviewed_manifest)
      and (if $p.stage == "PRE_MUTATION" then .productionApplyAuthority == null
        else (.productionApplyAuthority | e0_production_apply_authority) end)
      and (.migrationRiskSummary | e0_migration_risk($migration.reviewedManifest.reviewedMigrationManifest))
      and (.verificationEvidence
        | e0_verification_evidence($migration.reviewedManifest.reviewedMigrationManifest; $p.stage;
            $migration.appliedMigrationsHash; $migration;
            ($migration.productionApplyAuthority.maintenanceWindow // null)))
      and .candidateSetApplied == ($p.stage != "PRE_MUTATION"))
  and (.servingBuilds | e0_serving_builds($p.stage; $evidence.sourceCommit))
  and (.reimbursementWriteQuiesce | e0_reimbursement_quiesce($p.stage; $evidence.sourceCommit))
  and (.authoritySnapshot | e0_authority_snapshot($p.stage))
  and (.normalization | e0_normalization($p.stage))
  and (.baselineRefs
    | e0_exact_keys(["postMigrationRef","preMutationRef"])
      and (if $p.stage == "PRE_MUTATION" then
        .preMutationRef == null and .postMigrationRef == null
      elif $p.stage == "POST_MIGRATION" then
        (.preMutationRef | e0_child_ref("PRODUCTION_A5_EVIDENCE_V1")) and .postMigrationRef == null
      else
        (.preMutationRef | e0_child_ref("PRODUCTION_A5_EVIDENCE_V1"))
        and (.postMigrationRef | e0_child_ref("PRODUCTION_A5_EVIDENCE_V1"))
      end))
  and (.comparisons | e0_h2_comparisons($p.stage))
  and .passed == true;

def e0_raw_aws_evidence:
  e0_exact_keys(["raw","sha256"])
  and (.raw | type == "object") and (.sha256 | e0_hash);

def e0_migration_tool_for($repository; $source_commit; $workflow_path; $run_id;
    $run_attempt; $candidate_hash):
  . as $tool
  | e0_exact_keys(["digest","dockerfileBlob","dockerfilePath","image","lockfilePath",
      "lockfileSha256","migrationCatalogHash","provenance","registryBinding","runtimeBoundary","sbom",
      "signature","sourceCommit","tagCleanup","target"])
  and (.digest | e0_digest)
  and .image == ("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/"
    + "watchdog-bms-migration-tool@" + .digest)
  and .sourceCommit == $source_commit
  and .dockerfilePath == "apps/api/Dockerfile" and (.dockerfileBlob | e0_sha)
  and .lockfilePath == "pnpm-lock.yaml" and (.lockfileSha256 | e0_hash)
  and .target == "migration-tool"
  and .migrationCatalogHash == $candidate_hash
  and (.registryBinding
    | e0_exact_keys(["attestationManifestDigest","attestationManifestSha256","indexPath",
        "runnableDigest","runnablePlatform","sha256"])
      and .indexPath == "migration-tool.registry.index.json"
      and (.sha256 | e0_hash)
      and .runnablePlatform == "linux/amd64" and (.runnableDigest | e0_digest)
      and (.attestationManifestDigest | e0_digest)
      and (.attestationManifestSha256 | e0_hash)
      and .runnableDigest != $tool.digest
      and .attestationManifestDigest != .runnableDigest)
  and (.sbom
    | e0_exact_keys(["format","path","sha256"])
      and .format == "SPDX-2.3" and .path == "migration-tool.registry.sbom.in-toto.json"
      and (.sha256 | e0_hash))
  and (.provenance
    | e0_exact_keys(["path","predicateType","sha256","sourceCommit","subjectDigest"])
      and .path == "migration-tool.registry.provenance.in-toto.json"
      and (.predicateType | test("^https://slsa.dev/provenance/v(0\\.2|1)$"))
      and .sourceCommit == $source_commit
      and .subjectDigest == $tool.registryBinding.runnableDigest
      and (.sha256 | e0_hash))
  and (.signature
    | e0_exact_keys(["identity","issuer","outputSha256","signedDigest","verified"])
      and .verified == true and .signedDigest == $tool.digest
      and .identity == ("https://github.com/" + $repository + "/"
        + $workflow_path + "@refs/heads/main")
      and .issuer == "https://token.actions.githubusercontent.com"
      and (.outputSha256 | e0_hash))
  and .runtimeBoundary == {
    serviceTrafficAttached:false,taskRoleArn:null,
    executionRoleArn:"arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone-execution"
  }
  and (.tagCleanup
    | e0_exact_keys(["digestStillPresent","mutableTagDeleted","temporaryTag"])
      and .temporaryTag == ("u5-a5-" + $run_id + "-a"
        + ($run_attempt|tostring) + "-" + $source_commit[0:8])
      and .mutableTagDeleted == true and .digestStillPresent == true);

def e0_migration_tool($evidence; $candidate_hash):
  e0_migration_tool_for($evidence.repository; $evidence.sourceCommit;
    $evidence.producer.workflowPath; $evidence.producer.runId;
    $evidence.producer.runAttempt; $candidate_hash);

def e0_clone_migration_tool($evidence; $clone_ref; $candidate_hash):
  e0_migration_tool_for($evidence.repository; $evidence.sourceCommit;
    ".github/workflows/production-a5-clone.yml"; $clone_ref.producerRunId;
    $clone_ref.producerRunAttempt; $candidate_hash);

def e0_reimbursement_compatibility:
  e0_exact_keys(["combinedOutputSha256","command","commandSha256","databaseUrlBinding",
    "pass","requiredGate","skipped","status","suites","tests"])
  and .command == ("REIMBURSEMENT_PG_GATE_REQUIRED=true "
    + "pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec "
    + "src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts "
    + "src/modules/reimbursements/infrastructure/"
    + "prisma-reimbursement.repository.draft-submit-race.spec.ts")
  and (.commandSha256 | e0_hash) and (.combinedOutputSha256 | e0_hash)
  and .databaseUrlBinding == "DATABASE_URL"
  and .requiredGate == "REIMBURSEMENT_PG_GATE_REQUIRED=true"
  and .suites == 2 and .tests == 13 and .pass == 13
  and .skipped == 0 and .status == "PASSED";

def e0_h2_clone($evidence):
  . as $p
  | e0_exact_keys(["candidateMigrationSetHash","cloneInfrastructure","cloneRehearsal",
      "expectedClosedWhtRouteHash",
      "expectedDataTransformHash","expectedSchemaDeltaHash","expectedSeededRouteHash",
      "isolationBoundary","lockBudgetPolicyHash","migrationTool","passed","preflightCatalogHash",
      "reimbursementCompatibility",
      "reviewedManifest","reviewedMigrationOperationsHash","sourceAppliedMigrations",
      "sourceAppliedMigrationsHash","sourceDatabaseFingerprint",
      "targetEnvironment"])
  and .targetEnvironment == "production-isolated-clone"
  and .isolationBoundary == {productionSourceReadOnly:true,noProductionWriterCredential:true,
    isolatedNetwork:true,publiclyAccessible:false,cloneDestroyed:true}
  and (.cloneInfrastructure as $infra
    | $infra
    | e0_exact_keys(["cleanup","dbSecurityGroupIds","dbSecurityGroupIngress",
        "dbSubnetGroupName","dbSubnetIds","engine","engineVersion","kmsKeyArn",
        "migrationExecutionRoleArn","migrationImage","migrationSourceCommit","migrationTaskArn",
        "migrationTaskDefinitionArn","migrationTaskRoleArn","migrationTaskSecurityGroupIds",
        "migrationTaskSubnetIds","networkBoundary","networkEvidence","publiclyAccessible",
        "requiredRunTags","snapshotArn","temporaryDatabaseSecretArn",
        "temporaryDatabaseSecretVersionId",
        "snapshotCreatedAtEpoch","snapshotType","sourceDbIdentifier","sourceDbInstanceArn",
        "storageEncrypted","temporaryDbIdentifier","temporaryDbInstanceArn"])
      and (.sourceDbIdentifier | type == "string" and test("^[a-z][a-z0-9-]{0,62}$"))
      and .sourceDbInstanceArn == ("arn:aws:rds:ap-southeast-1:311414082667:db:" + .sourceDbIdentifier)
      and (.snapshotArn | type == "string"
        and test("^arn:aws:rds:ap-southeast-1:311414082667:snapshot:rds:[A-Za-z0-9_.:-]+$"))
      and (.snapshotCreatedAtEpoch | e0_positive_integer)
      and .snapshotCreatedAtEpoch <= $evidence.issuedAtEpoch
      and ($evidence.issuedAtEpoch - .snapshotCreatedAtEpoch) <= 129600
      and .snapshotType == "automated"
      and .temporaryDbIdentifier
        == ("watchdog-a5-clone-" + $evidence.producer.runId + "-a"
          + ($evidence.producer.runAttempt|tostring) + "-" + ($evidence.sourceCommit[0:8]))
      and .temporaryDbInstanceArn
        == ("arn:aws:rds:ap-southeast-1:311414082667:db:" + .temporaryDbIdentifier)
      and .temporaryDbInstanceArn != .sourceDbInstanceArn
      and .requiredRunTags == [
        {key:"parentRunAttempt",value:($evidence.parentProductionRun.runAttempt|tostring)},
        {key:"parentRunId",value:$evidence.parentProductionRun.runId},
        {key:"producerRunAttempt",value:($evidence.producer.runAttempt|tostring)},
        {key:"producerRunId",value:$evidence.producer.runId},
        {key:"purpose",value:"production-a5-clone"},
        {key:"sourceCommit",value:$evidence.sourceCommit}
      ]
      and .engine == "postgres"
      and (.engineVersion | type == "string" and test("^18(\\.[0-9]+){1,2}$"))
      and .storageEncrypted == true
      and (.kmsKeyArn | type == "string"
        and test("^arn:aws:kms:ap-southeast-1:311414082667:key/[0-9a-f-]{36}$"))
      and .publiclyAccessible == false
      and (.dbSubnetGroupName | type == "string" and test("^[A-Za-z0-9_.-]+$"))
      and (.dbSubnetIds | e0_sorted_unique_strings and length >= 2
        and all(.[]; test("^subnet-[0-9a-f]{8,17}$")))
      and (.dbSecurityGroupIds | type == "array" and length == 1 and . == sort
        and all(.[]; type == "string" and test("^sg-[0-9a-f]{8,17}$")))
      and (.migrationTaskSubnetIds | e0_sorted_unique_strings and length >= 1
        and all(.[]; test("^subnet-[0-9a-f]{8,17}$")))
      and (.migrationTaskSecurityGroupIds | type == "array" and length == 1 and . == sort
        and all(.[]; type == "string" and test("^sg-[0-9a-f]{8,17}$")))
      and .dbSecurityGroupIds[0] != .migrationTaskSecurityGroupIds[0]
      and .dbSecurityGroupIngress == [{ipProtocol:"tcp",fromPort:5432,toPort:5432,
        sourceSecurityGroupId:.migrationTaskSecurityGroupIds[0]}]
      and (.migrationTaskArn | type == "string"
        and test("^arn:aws:ecs:ap-southeast-1:311414082667:task/[^/]+/[^/]+$"))
      and (.migrationTaskDefinitionArn | type == "string"
        and test("^arn:aws:ecs:ap-southeast-1:311414082667:task-definition/[^:]+:[1-9][0-9]*$"))
      and (.migrationImage | type == "string"
        and test("^311414082667\\.dkr\\.ecr\\.ap-southeast-1\\.amazonaws\\.com/"
          + "watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$"))
      and .migrationSourceCommit == $evidence.sourceCommit
      and .migrationExecutionRoleArn
        == "arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone-execution"
      and .migrationTaskRoleArn == null
      and (.temporaryDatabaseSecretArn | type == "string"
        and test("^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"
          + "rds!db-[A-Za-z0-9-]+$"))
      and (.temporaryDatabaseSecretVersionId | type == "string"
        and test("^[A-Fa-f0-9-]{32,64}$"))
      and (.networkBoundary | e0_a5_endpoint_boundary)
      and (.migrationTaskSecurityGroupIds[0] as $task
        | .networkBoundary.authorizedTaskSecurityGroupIds|index($task)!=null)
      and (.migrationTaskSubnetIds as $observed
        | all($observed[];. as $subnet|$infra.networkBoundary.taskSubnetIds|index($subnet)!=null))
      and (.networkEvidence
        | e0_exact_keys(["describeDbInstances","describeEndpointSecurityGroup",
            "describeNetworkInterfaces","describeRouteTables","describeSecret",
            "describeSecurityGroups","describeSubnets","describeTaskDefinition",
            "describeTasks","describeVpcEndpoints","endpointBoundary"])
          and (.endpointBoundary | e0_a5_endpoint_boundary)
          and (del(.endpointBoundary)|all(.[];e0_raw_aws_evidence)))
      and .networkBoundary == .networkEvidence.endpointBoundary
      and .networkEvidence.describeEndpointSecurityGroup.sha256
        == .networkBoundary.rawEvidence.describeEndpointSecurityGroupSha256
      and .networkEvidence.describeVpcEndpoints.sha256
        == .networkBoundary.rawEvidence.describeVpcEndpointsSha256
      and .networkEvidence.describeRouteTables.sha256
        == .networkBoundary.rawEvidence.describeRouteTablesSha256
      and ($infra.networkEvidence.describeSecret.raw as $secret
        | $secret.ARN == $infra.temporaryDatabaseSecretArn
          and ($secret.Name | type == "string" and test("^rds!db-[A-Za-z0-9-]+$"))
          and ($secret.DeletedDate // null) == null
          and $secret.OwningService == "rds"
          and any($secret.Tags[]?; .Key == "aws:rds:primaryDBInstanceArn"
            and .Value == $infra.temporaryDbInstanceArn)
          and ([$secret.VersionIdsToStages | to_entries[]
            | select(.value | index("AWSCURRENT")) | .key]
            == [$infra.temporaryDatabaseSecretVersionId]))
      and ($infra.networkEvidence.describeDbInstances.raw.DBInstances as $dbs
        | ($dbs|type)=="array" and ($dbs|length)==1
          and $dbs[0].DBInstanceArn == $infra.temporaryDbInstanceArn
          and $dbs[0].DBInstanceStatus == "available"
          and $dbs[0].PubliclyAccessible == false
          and ($dbs[0].DBName | type == "string"
            and test("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$"))
          and ($dbs[0].Endpoint.Address | type == "string" and length > 0)
          and $dbs[0].Endpoint.Port == 5432
          and $dbs[0].MasterUserSecret == {
            KmsKeyId:("arn:aws:kms:ap-southeast-1:311414082667:key/"
              + "b2e68e7f-e098-4b88-a92a-5a0f4fe2924a"),
            SecretArn:$infra.temporaryDatabaseSecretArn,SecretStatus:"active"}
          and ([$dbs[0].DBSubnetGroup.Subnets[].SubnetIdentifier]|sort) == $infra.dbSubnetIds
          and ([$dbs[0].VpcSecurityGroups[].VpcSecurityGroupId]|sort)
            == $infra.dbSecurityGroupIds)
      and ($infra.networkEvidence.describeNetworkInterfaces.raw.NetworkInterfaces as $enis
        | ($enis|type)=="array" and ($enis|length)==1
          and ([$enis[].SubnetId]|sort|unique) == $infra.migrationTaskSubnetIds
          and ([$enis[].Groups[].GroupId]|sort|unique) == $infra.migrationTaskSecurityGroupIds
          and all($enis[]; (.Association.PublicIp // null) == null))
      and ($infra.networkEvidence.describeSubnets.raw.Subnets as $subnets
        | ([$subnets[].SubnetId]|sort|unique)
            == (($infra.dbSubnetIds+$infra.migrationTaskSubnetIds)|sort|unique)
          and all($subnets[]; .MapPublicIpOnLaunch == false))
      and ($infra.networkEvidence.describeSecurityGroups.raw.SecurityGroups as $groups
        | ([$groups[].GroupId]|sort|unique)
            == (($infra.dbSecurityGroupIds+$infra.migrationTaskSecurityGroupIds)|sort|unique)
          and (($groups[]|select(.GroupId==$infra.dbSecurityGroupIds[0])) as $db_group
          | ($groups[]|select(.GroupId==$infra.migrationTaskSecurityGroupIds[0])) as $task_group
          | ($db_group.IpPermissions|length)==1
          and $db_group.IpPermissions[0].IpProtocol=="tcp"
          and $db_group.IpPermissions[0].FromPort==5432
          and $db_group.IpPermissions[0].ToPort==5432
          and ($db_group.IpPermissions[0].IpRanges // [])==[]
          and ($db_group.IpPermissions[0].Ipv6Ranges // [])==[]
          and ($db_group.IpPermissions[0].PrefixListIds // [])==[]
          and [$db_group.IpPermissions[0].UserIdGroupPairs[].GroupId]
            == $infra.migrationTaskSecurityGroupIds
          and ($db_group.IpPermissionsEgress // [])==[]
          and ($task_group.IpPermissions // [])==[]
          and ($task_group.IpPermissionsEgress|length)==3
          and ([$task_group.IpPermissionsEgress[]
            | {ipProtocol:.IpProtocol,fromPort:.FromPort,toPort:.ToPort,
               ipv4:([.IpRanges[]?.CidrIp]|sort),ipv6:([.Ipv6Ranges[]?.CidrIpv6]|sort),
               prefixLists:([.PrefixListIds[]?.PrefixListId]|sort),
               groups:([.UserIdGroupPairs[]?.GroupId]|sort)}]
            | sort_by([.fromPort,.toPort,(.ipv4|join(",")),(.groups|join(","))]))
            == ([
              {ipProtocol:"tcp",fromPort:443,toPort:443,ipv4:[],ipv6:[],
               prefixLists:[$infra.networkBoundary.s3PrefixListId],groups:[]},
              {ipProtocol:"tcp",fromPort:443,toPort:443,ipv4:[],ipv6:[],prefixLists:[],
               groups:[$infra.networkBoundary.endpointSecurityGroupId]},
              {ipProtocol:"tcp",fromPort:5432,toPort:5432,ipv4:[],
               ipv6:[],prefixLists:[],groups:$infra.dbSecurityGroupIds}
            ] | sort_by([.fromPort,.toPort,(.ipv4|join(",")),(.groups|join(","))]))))
      and ($infra.networkEvidence.describeTasks.raw.tasks as $tasks
        | ($tasks|type)=="array" and ($tasks|length)==1
          and $tasks[0].taskArn==$infra.migrationTaskArn
          and $tasks[0].taskDefinitionArn==$infra.migrationTaskDefinitionArn)
      and ($infra.networkEvidence.describeTaskDefinition.raw.taskDefinition as $task_definition
        | $task_definition.taskDefinitionArn==$infra.migrationTaskDefinitionArn
          and $task_definition.executionRoleArn==$infra.migrationExecutionRoleArn
          and ($task_definition.taskRoleArn // null)==null
          and $task_definition.networkMode=="awsvpc"
          and ($task_definition.containerDefinitions|length)==1
          and ([$task_definition.containerDefinitions[].image]|unique)==[$infra.migrationImage]
          and ([$task_definition.containerDefinitions[0].environment[]
            | select(.name == "PGDATABASE" or .name == "PGHOST" or .name == "PGPORT")]
            | sort_by(.name)) == [
              {name:"PGDATABASE",value:$infra.networkEvidence.describeDbInstances.raw
                .DBInstances[0].DBName},
              {name:"PGHOST",value:$infra.networkEvidence.describeDbInstances.raw
                .DBInstances[0].Endpoint.Address},
              {name:"PGPORT",value:($infra.networkEvidence.describeDbInstances.raw
                .DBInstances[0].Endpoint.Port|tostring)}]
          and ([$task_definition.containerDefinitions[0].environment[]
            | select(.name == "PGPASSWORD" or .name == "PGUSER")] | length) == 0
          and $task_definition.containerDefinitions[0].secrets == [
            {name:"PGPASSWORD",valueFrom:($infra.temporaryDatabaseSecretArn
              + ":password::" + $infra.temporaryDatabaseSecretVersionId)},
            {name:"PGUSER",valueFrom:($infra.temporaryDatabaseSecretArn
              + ":username::" + $infra.temporaryDatabaseSecretVersionId)}
          ])
      and (.cleanup
        | e0_exact_keys(["deleteCompletedAtEpoch","deleteRequestedAtEpoch","instanceAbsent",
            "residualResourceCount","secretDeleted","taskStopped"])
          and (.deleteRequestedAtEpoch | e0_positive_integer)
          and (.deleteCompletedAtEpoch | e0_positive_integer)
          and .deleteCompletedAtEpoch >= .deleteRequestedAtEpoch
          and .instanceAbsent == true and .secretDeleted == true and .taskStopped == true
          and .residualResourceCount == 0))
  and (.sourceDatabaseFingerprint | e0_hash)
  and (.sourceAppliedMigrations | e0_applied_migrations)
  and (.sourceAppliedMigrationsHash | e0_hash)
  and (.candidateMigrationSetHash | e0_hash)
  and (.reviewedMigrationOperationsHash | e0_hash)
  and (.expectedSchemaDeltaHash | e0_hash)
  and (.expectedDataTransformHash | e0_hash)
  and (.preflightCatalogHash | e0_hash)
  and (.lockBudgetPolicyHash | e0_hash)
  and (.expectedSeededRouteHash | e0_hash)
  and (.expectedClosedWhtRouteHash | e0_hash)
  and (.reviewedManifest | e0_reviewed_manifest)
  and (.migrationTool | e0_migration_tool($evidence; $p.candidateMigrationSetHash))
  and .cloneInfrastructure.migrationImage == .migrationTool.image
  and (.reimbursementCompatibility | e0_reimbursement_compatibility)
  and (.cloneRehearsal | e0_clone_rehearsal($p.reviewedManifest.reviewedMigrationManifest;
      $p.sourceAppliedMigrationsHash; $p))
  and .passed == true;

def e0_security_service($source):
  . as $service
  | e0_exact_keys(["ciSignatureVerified","ciSignerIdentity","critical","digest","high","image",
    "ociRevision","sbomSha256","scanStatus","service"])
  and (.service == "ai-gateway" or .service == "api-web" or .service == "workers")
  and (.digest | e0_digest)
  and (.image | type == "string" and endswith("@" + $service.digest))
  and .ociRevision == $source
  and .ciSignatureVerified == true and (.ciSignerIdentity | e0_nonempty)
  and (.sbomSha256 | e0_hash) and .scanStatus == "COMPLETE"
  and .critical == 0 and .high == 0;

def e0_h3_validator_paths: [
  "infra/docker/validate-production-manifest.sh",
  "infra/docker/validate-uat-deployment-acceptance.sh",
  "infra/security/collect-production-a5-migration-tool-registry-evidence.sh",
  "infra/security/evidence-contracts.jq",
  "infra/security/signed-evidence.sh",
  "infra/security/validate-production-security-preflight.sh",
  "infra/security/verify-production-a5-migration-tool.sh",
  "infra/security/verify-production-security-baseline.sh"
];

def e0_h3_release_files: [
  "cosign-ai-gateway.json","cosign-api-web.json","cosign-workers.json",
  "production-image-manifest.json","sbom-ai-gateway.spdx.json",
  "sbom-api-web.spdx.json","sbom-workers.spdx.json"
];

def e0_h3_controller_evidence($evidence):
  e0_exact_keys(["ciWorkflowBlob","parentControllerCommit","producerControllerCommit",
    "productionDeployWorkflowBlob","securityPreflightWorkflowBlob","sourceCommit",
    "uatDeployWorkflowBlob","validators"])
  and .sourceCommit == $evidence.sourceCommit
  and .producerControllerCommit == $evidence.producer.controllerCommit
  and .parentControllerCommit == $evidence.parentProductionRun.controllerCommit
  and (.ciWorkflowBlob | e0_sha) and (.uatDeployWorkflowBlob | e0_sha)
  and .productionDeployWorkflowBlob == $evidence.parentProductionRun.workflowBlob
  and .securityPreflightWorkflowBlob == $evidence.producer.workflowBlob
  and (.validators | type == "array" and . == sort_by(.path)
    and map(.path) == e0_h3_validator_paths
    and all(.[]; e0_exact_keys(["path","sha256"]) and (.sha256 | e0_hash)));

def e0_h3_security_service_evidence($source; $repository):
  . as $service
  | e0_exact_keys(["ciIssuer","ciSignatureFile","ciSignatureFileSha256","ciSignedDigest",
      "ciSignerIdentity","critical","digest","high","image","imagePushedAtEpoch",
      "liveIssuer","liveSignatureOutputSha256","liveSignedDigest","liveSignerIdentity",
      "ociRevision","repository","sbomFile","sbomSha256","sbomSpdxVersion",
      "scanCompletedAtEpoch","scanEnhancedFindingsArray","scanProviderDescription",
      "scanProviderStatus","scanRequestedDigest","scanResolvedDigest","scanSeverityCounts",
      "scanStatus","service","sourceCommit"])
  and (.service == "ai-gateway" or .service == "api-web" or .service == "workers")
  and .repository == (if .service == "api-web" then "watchdog-bms-api"
    elif .service == "ai-gateway" then "watchdog-bms-ai-gateway" else "watchdog-bms-workers" end)
  and (.digest | e0_digest) and .scanRequestedDigest == .digest
  and (.scanResolvedDigest | e0_digest)
  and .image == ("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/"
    + $service.repository + "@" + $service.digest)
  and .sourceCommit == $source and .ociRevision == $source
  and .sbomFile == ("sbom-" + .service + ".spdx.json")
  and (.sbomSha256 | e0_hash)
  and .sbomSpdxVersion == "SPDX-2.3"
  and .ciSignatureFile == ("cosign-" + .service + ".json")
  and (.ciSignatureFileSha256 | e0_hash)
  and .ciSignedDigest == .digest and .liveSignedDigest == .digest
  and .ciSignerIdentity == ("https://github.com/" + $repository
    + "/.github/workflows/ci.yml@refs/heads/main")
  and .liveSignerIdentity == .ciSignerIdentity
  and .ciIssuer == "https://token.actions.githubusercontent.com"
  and .liveIssuer == .ciIssuer
  and (.liveSignatureOutputSha256 | e0_hash)
  and .scanStatus == "COMPLETE" and .critical == 0 and .high == 0
  and (.scanProviderDescription == null or (.scanProviderDescription | type == "string"))
  and (.scanEnhancedFindingsArray | type == "boolean")
  and (.scanSeverityCounts | type == "object"
    and all(to_entries[];
      (.key == "INFORMATIONAL" or .key == "LOW" or .key == "MEDIUM" or .key == "HIGH"
        or .key == "CRITICAL" or .key == "UNDEFINED")
      and (.value | e0_integer)))
  and (.scanSeverityCounts.CRITICAL // 0) == .critical
  and (.scanSeverityCounts.HIGH // 0) == .high
  and (if .scanProviderStatus == "COMPLETE" then true
    elif .scanProviderStatus == "ACTIVE" then
      .scanProviderDescription == "Continuous scan is selected for image."
      and .scanEnhancedFindingsArray == true
    else false end)
  and (.imagePushedAtEpoch | e0_positive_integer)
  and (.scanCompletedAtEpoch | e0_positive_integer)
  and .scanCompletedAtEpoch >= .imagePushedAtEpoch;

def e0_h3_artifact_evidence($evidence; $uat_ref; $manifest_hash):
  . as $artifact
  | e0_exact_keys(["healthVerified","releaseFiles","releaseFinalized","releaseManifestSha256",
      "services","sourceCommit","uatAcceptanceContentSha256","uatAcceptanceFileSha256"])
  and .sourceCommit == $evidence.sourceCommit
  and .uatAcceptanceContentSha256 == $uat_ref.contentSha256
  and (.uatAcceptanceFileSha256 | e0_hash)
  and .releaseManifestSha256 == $manifest_hash
  and .healthVerified == true and .releaseFinalized == true
  and (.releaseFiles | type == "array" and . == sort_by(.name)
    and map(.name) == e0_h3_release_files
    and all(.[]; e0_exact_keys(["name","sha256"]) and (.sha256 | e0_hash)))
  and (.services | type == "array" and length == 3 and . == sort_by(.service)
    and map(.service) == ["ai-gateway","api-web","workers"]
    and all(.[]; e0_h3_security_service_evidence($evidence.sourceCommit; $evidence.repository)))
  and all(.services[]; . as $service
    | any($artifact.releaseFiles[]; .name == $service.sbomFile and .sha256 == $service.sbomSha256)
      and any($artifact.releaseFiles[];
        .name == $service.ciSignatureFile and .sha256 == $service.ciSignatureFileSha256))
  and any(.releaseFiles[]; .name == "production-image-manifest.json" and .sha256 == $manifest_hash);

def e0_h3_migration_tool_verification($evidence; $expected):
  . as $live
  | e0_exact_keys(["digest","image","provenance","registryBinding","sbom","scan",
      "signature","sourceCommit"])
  and .image == $expected.image and .digest == $expected.digest
  and .sourceCommit == $evidence.sourceCommit and .sourceCommit == $expected.sourceCommit
  and .registryBinding == $expected.registryBinding
  and .sbom == $expected.sbom and .provenance == $expected.provenance
  and (.signature
    | e0_exact_keys(["identity","issuer","outputSha256","signedDigest","verified"])
      and .verified == true and .signedDigest == $expected.digest
      and .identity == $expected.signature.identity
      and .issuer == $expected.signature.issuer
      and (.outputSha256 | e0_hash))
  and (.scan
    | e0_exact_keys(["critical","enhancedFindingsArray","high","imagePushedAtEpoch",
        "providerDescription","providerStatus","requestedDigest","resolvedDigest",
        "scanCompletedAtEpoch","severityCounts","status"])
      and .requestedDigest == $expected.digest
      and .resolvedDigest == $expected.registryBinding.runnableDigest
      and .status == "COMPLETE" and .critical == 0 and .high == 0
      and (.providerDescription == null or (.providerDescription | type == "string"))
      and (.enhancedFindingsArray | type == "boolean")
      and (.severityCounts | type == "object"
        and all(to_entries[];
          (.key == "INFORMATIONAL" or .key == "LOW" or .key == "MEDIUM" or .key == "HIGH"
            or .key == "CRITICAL" or .key == "UNDEFINED")
          and (.value | e0_integer)))
      and (.severityCounts.CRITICAL // 0) == .critical
      and (.severityCounts.HIGH // 0) == .high
      and (if .providerStatus == "COMPLETE" then true
        elif .providerStatus == "ACTIVE" then
          .providerDescription == "Continuous scan is selected for image."
          and .enhancedFindingsArray == true
        else false end)
      and (.imagePushedAtEpoch | e0_positive_integer)
      and (.scanCompletedAtEpoch | e0_positive_integer)
      and .scanCompletedAtEpoch >= .imagePushedAtEpoch);

def e0_h3_migration_evidence($evidence):
  . as $review
  | e0_exact_keys(["migrationTool","migrationToolVerification","productionA5CloneRef",
      "productionA5PreMutationPayload","productionA5PreMutationRef"])
  and (.productionA5PreMutationRef | e0_child_ref("PRODUCTION_A5_EVIDENCE_V1"))
  and (.productionA5CloneRef | e0_child_ref("PRODUCTION_A5_CLONE_REHEARSAL_V1"))
  and .productionA5CloneRef == .productionA5PreMutationPayload.migrationState.verificationEvidence.cloneRehearsalRef
  and (.migrationTool | e0_clone_migration_tool($evidence; $review.productionA5CloneRef;
      $review.productionA5PreMutationPayload.migrationState.candidateMigrationSetHash))
  and (.migrationToolVerification | e0_h3_migration_tool_verification($evidence; $review.migrationTool))
  and .productionA5PreMutationPayload.readerRuntime.migrationImage == .migrationTool.image
  and (.productionA5PreMutationPayload
    | .stage == "PRE_MUTATION" and .schemaProfile.profile == "LEGACY_PRE_F1_EXPECTED_ABSENT"
      and .migrationState.candidateSetApplied == false
      and e0_h2($evidence))
  and ($review.productionA5PreMutationPayload.readerRuntime
    | e0_reader_runtime_producer($review.productionA5PreMutationRef.producerRunId;
        $review.productionA5PreMutationRef.producerRunAttempt; "PRE_MUTATION"));

def e0_h3_rollback_evidence:
  e0_exact_keys(["acceptanceHealthVerified","acceptanceReleaseFinalized","commandListSha256",
    "commands","combinedOutputSha256","mode","protectedMainBlobs"])
  and .mode == "NON_MUTATING_REHEARSAL"
  and .acceptanceHealthVerified == true and .acceptanceReleaseFinalized == true
  and (.commandListSha256 | e0_hash) and (.combinedOutputSha256 | e0_hash)
  and (.commands | type == "array" and map(.command) == [
      "bash infra/prod-ecs-express/release-safety.spec.sh",
      "bash infra/prod-ecs-express/rollout-waves.spec.sh"
    ]
    and all(.[]; e0_exact_keys(["command","exitCode","outputSha256"])
      and .exitCode == 0 and (.outputSha256 | e0_hash)))
  and (.protectedMainBlobs | type == "array" and . == sort_by(.path)
    and map(.path) == [
      ".github/workflows/deploy-production.yml",
      ".github/workflows/recover-release-intent.yml",
      "infra/prod-ecs-express/deploy.sh",
      "infra/prod-ecs-express/release-safety.spec.sh",
      "infra/prod-ecs-express/rollout-waves.spec.sh"
    ]
    and all(.[]; e0_exact_keys(["blob","path"]) and (.blob | e0_sha)));

def e0_h3_protected_main_evidence:
  e0_exact_keys(["deletionAllowed","dismissStaleReviews","enforceAdmins","forcePushAllowed",
    "httpStatus","requireLastPushApproval","requiredPullRequestApprovals",
    "requiredStatusContexts","strictRequiredChecks"])
  and .httpStatus == 200 and .strictRequiredChecks == true
  and .requiredStatusContexts == [
    "AI Gateway Tests","API Tests","Build","Security","Web Tests","Workers Tests"
  ]
  and .enforceAdmins == true and .requiredPullRequestApprovals == 1
  and .dismissStaleReviews == true and .requireLastPushApproval == true
  and .forcePushAllowed == false and .deletionAllowed == false;

def e0_h3_environment_evidence:
  e0_exact_keys(["branchPolicies","branchPoliciesHttpStatus","deploymentBranchPolicy",
    "environmentHttpStatus","lastConfigurationHttpStatus","nativeRequiredReviewerCount",
    "nativeReviewerRule","nativeSelfReviewPrevented","requiredReviewerRules"])
  and .environmentHttpStatus == 200 and .branchPoliciesHttpStatus == 200
  and .deploymentBranchPolicy == {protectedBranches:false,customBranchPolicies:true}
  and .branchPolicies == [{name:"main",type:"branch"}]
  and .requiredReviewerRules == []
  and .nativeReviewerRule == "NOT_CONFIGURED"
  and .nativeRequiredReviewerCount == 0
  and .nativeSelfReviewPrevented == null
  and .lastConfigurationHttpStatus == null;

def e0_h3_read_actions: [
  "cloudwatch:DescribeAlarms","cloudwatch:GetMetricStatistics",
  "ecr:BatchCheckLayerAvailability","ecr:BatchGetImage","ecr:DescribeImageScanFindings",
  "ecr:DescribeImages","ecr:GetAuthorizationToken","ecr:GetDownloadUrlForLayer",
  "ec2:DescribeSecurityGroups","ec2:DescribeSubnets","ec2:DescribeVpcs",
  "ecs:DescribeClusters",
  "elasticache:DescribeCacheClusters","elasticache:DescribeReplicationGroups",
  "iam:GetRole","iam:GetRolePolicy","iam:ListAttachedRolePolicies","iam:ListRolePolicies",
  "kms:DescribeKey","logs:DescribeLogGroups","logs:DescribeMetricFilters",
  "rds:DescribeDBInstances","s3:GetLifecycleConfiguration","s3:GetBucketLocation",
  "s3:GetBucketVersioning","secretsmanager:DescribeSecret",
  "sns:GetTopicAttributes","sns:ListSubscriptionsByTopic","ssm:GetParameters",
  "sts:GetCallerIdentity"
];

def e0_h3_inline_policy: {
  Version:"2012-10-17",
  Statement:[
    {Sid:"AllowGlobalRead",Effect:"Allow",Action:[
      "cloudwatch:DescribeAlarms","cloudwatch:GetMetricStatistics","ecr:GetAuthorizationToken",
      "elasticache:DescribeCacheClusters","elasticache:DescribeReplicationGroups",
      "ec2:DescribeSecurityGroups","ec2:DescribeSubnets","ec2:DescribeVpcs",
      "ecs:DescribeClusters","kms:DescribeKey","logs:DescribeLogGroups","logs:DescribeMetricFilters",
      "rds:DescribeDBInstances","s3:GetLifecycleConfiguration","s3:GetBucketLocation",
      "s3:GetBucketVersioning","secretsmanager:DescribeSecret","ssm:GetParameters",
      "sts:GetCallerIdentity"
    ],Resource:"*"},
    {Sid:"AllowReleaseImageRead",Effect:"Allow",Action:[
      "ecr:BatchCheckLayerAvailability","ecr:BatchGetImage","ecr:DescribeImageScanFindings",
      "ecr:DescribeImages","ecr:GetDownloadUrlForLayer"
    ],Resource:[
      "arn:aws:ecr:ap-southeast-1:311414082667:repository/watchdog-bms-ai-gateway",
      "arn:aws:ecr:ap-southeast-1:311414082667:repository/watchdog-bms-api",
      "arn:aws:ecr:ap-southeast-1:311414082667:repository/watchdog-bms-migration-tool",
      "arn:aws:ecr:ap-southeast-1:311414082667:repository/watchdog-bms-workers"
    ]},
    {Sid:"AllowSelfInspection",Effect:"Allow",Action:["iam:GetRole","iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies","iam:ListRolePolicies"],Resource:[
        "arn:aws:iam::311414082667:role/watchdog-bms-deploy-production",
        "arn:aws:iam::311414082667:role/ecsInfrastructureRoleForExpressServices",
        "arn:aws:iam::311414082667:role/ecsTaskExecutionRole",
        "arn:aws:iam::311414082667:role/watchdog-bms-ecs-express-ai-gateway-role",
        "arn:aws:iam::311414082667:role/watchdog-bms-ecs-express-api-role",
        "arn:aws:iam::311414082667:role/watchdog-bms-ecs-express-workers-role",
        "arn:aws:iam::311414082667:role/watchdog-bms-release-task-role",
        "arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone",
        "arn:aws:iam::311414082667:role/watchdog-bms-production-a5-apply-execution",
        "arn:aws:iam::311414082667:role/watchdog-bms-production-a5-bootstrap-execution",
        "arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone-execution",
        "arn:aws:iam::311414082667:role/watchdog-bms-production-a5-reader-bootstrap",
        "arn:aws:iam::311414082667:role/watchdog-bms-production-a5-readonly",
        "arn:aws:iam::311414082667:role/watchdog-bms-production-a5-readonly-execution",
        "arn:aws:iam::311414082667:role/watchdog-bms-production-security-readonly",
        "arn:aws:iam::311414082667:role/aws-service-role/ecs.amazonaws.com/AWSServiceRoleForECS",
        "arn:aws:iam::311414082667:role/aws-service-role/ecs.application-autoscaling.amazonaws.com/AWSServiceRoleForApplicationAutoScaling_ECSService",
        "arn:aws:iam::311414082667:role/aws-service-role/elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing"
      ]},
    {Sid:"AllowOwnedAlertTopicRead",Effect:"Allow",
      Action:["sns:GetTopicAttributes","sns:ListSubscriptionsByTopic"],
      Resource:"arn:aws:sns:ap-southeast-1:311414082667:*"},
    {Sid:"DenyOutsideReadOnly",Effect:"Deny",NotAction:e0_h3_read_actions,Resource:"*"}
  ]
};

def e0_h3_aws_evidence($repository):
  e0_exact_keys(["callerAccount","callerArn","callerUserId","expectedRoleArn","inlinePolicy",
    "inlinePolicyName","inlinePolicyTemplateSha256","observedInlinePolicySha256",
    "observedTrustPolicySha256","roleArn","roleName","trustPolicy","trustTemplateSha256"])
  and .expectedRoleArn == "arn:aws:iam::311414082667:role/watchdog-bms-production-security-readonly"
  and .roleArn == .expectedRoleArn and .roleName == "watchdog-bms-production-security-readonly"
  and .callerAccount == "311414082667"
  and (.callerUserId | e0_nonempty)
  and (.callerArn | type == "string"
    and test("^arn:aws:sts::311414082667:assumed-role/watchdog-bms-production-security-readonly/[A-Za-z0-9+=,.@_-]+$"))
  and .inlinePolicyName == "watchdog-bms-production-security-readonly"
  and (.trustTemplateSha256 | e0_hash) and (.inlinePolicyTemplateSha256 | e0_hash)
  and (.observedTrustPolicySha256 | e0_hash) and (.observedInlinePolicySha256 | e0_hash)
  and .trustTemplateSha256 == .observedTrustPolicySha256
  and .inlinePolicyTemplateSha256 == .observedInlinePolicySha256
  and .trustPolicy == {
    Version:"2012-10-17",
    Statement:[{Sid:"GitHubProductionSecurityPreflight",Effect:"Allow",
      Principal:{Federated:"arn:aws:iam::311414082667:oidc-provider/token.actions.githubusercontent.com"},
      Action:"sts:AssumeRoleWithWebIdentity",Condition:{StringEquals:{
        "token.actions.githubusercontent.com:aud":"sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub":("repo:" + $repository + ":environment:production")
      }}}]
  }
  and .inlinePolicy == e0_h3_inline_policy;

def e0_h3_runtime_security($evidence; $artifact):
  . as $runtime
  | e0_exact_keys(["alerting","clamavCandidate","logMonitoring","observedAtEpoch","provider",
      "rds","redis","schemaVersion"])
  and .schemaVersion == 1 and .provider == "AWS"
  and (.observedAtEpoch | e0_positive_integer)
  and .observedAtEpoch <= $evidence.issuedAtEpoch
  and ($evidence.issuedAtEpoch - .observedAtEpoch) <= 1800
  and (.rds
    | e0_exact_keys(["backupRetentionDays","deletionProtection","instanceArn",
        "instanceIdentifier","multiAZ","rawSha256","status","storageEncrypted"])
      and (.instanceIdentifier | type == "string" and test("^[a-z][a-z0-9-]{0,62}$"))
      and .instanceArn == ("arn:aws:rds:ap-southeast-1:311414082667:db:" + .instanceIdentifier)
      and .status == "available" and .storageEncrypted == true and .multiAZ == true
      and .deletionProtection == true and (.backupRetentionDays | e0_positive_integer and . >= 35)
      and (.rawSha256 | e0_hash))
  and (.redis
    | e0_exact_keys(["atRestEncryptionEnabled","authTokenEnabled","automaticFailover","engine",
        "nodeCount","primaryClusterId","rawPrimaryClusterSha256","rawReplicationGroupSha256",
        "replicationGroupArn","replicationGroupId","snapshotRetentionDays","status",
        "transitEncryptionEnabled"])
      and (.replicationGroupId | type == "string" and test("^[a-z][a-z0-9-]{0,39}$"))
      and .replicationGroupArn
        == ("arn:aws:elasticache:ap-southeast-1:311414082667:replicationgroup:"
          + .replicationGroupId)
      and .engine == "redis" and .status == "available"
      and .atRestEncryptionEnabled == true and .transitEncryptionEnabled == true
      and .authTokenEnabled == true and .automaticFailover == "enabled"
      and (.nodeCount | e0_positive_integer and . >= 2)
      and (.primaryClusterId | type == "string" and test("^[A-Za-z0-9-]{1,50}$"))
      and (.snapshotRetentionDays | e0_positive_integer and . >= 35)
      and (.rawReplicationGroupSha256 | e0_hash)
      and (.rawPrimaryClusterSha256 | e0_hash))
  and (.alerting
    | e0_exact_keys(["acknowledgement","actionableAlarmNames","alarmsRawSha256",
        "confirmedHumanSubscriptions","deliveredNotificationCount","deliveryMetricRawSha256",
        "ownerAccount","subscriptionsRawSha256","topicArn","topicRawSha256"])
      and (.topicArn | type == "string"
        and test("^arn:aws:sns:ap-southeast-1:311414082667:[A-Za-z0-9_-]{1,256}$"))
      and .ownerAccount == "311414082667"
      and (.topicRawSha256 | e0_hash) and (.alarmsRawSha256 | e0_hash)
      and (.subscriptionsRawSha256 | e0_hash) and (.deliveryMetricRawSha256 | e0_hash)
      and (.actionableAlarmNames | e0_sorted_unique_strings and length >= 1
        and all(.[]; length <= 255))
      and (.confirmedHumanSubscriptions | type == "array" and length >= 1
        and . == sort_by(.subscriptionArn)
        and (map(.subscriptionArn) | length == (unique | length))
        and all(.[];
          e0_exact_keys(["endpointSha256","protocol","subscriptionArn"])
          and (.endpointSha256 | e0_hash)
          and (.protocol == "email" or .protocol == "email-json" or .protocol == "sms")
          and (.subscriptionArn | type == "string"
            and test("^arn:aws:sns:ap-southeast-1:311414082667:[A-Za-z0-9_-]+:[0-9a-f-]{36}$"))))
      and (.deliveredNotificationCount | e0_positive_integer)
      and (.acknowledgement as $ack
        | $ack | e0_exact_keys(["ackFileSha256","acknowledgedAtEpoch","acknowledgedBy",
            "deliveryEvidenceSha256","endpointSha256","probePublishedAtEpoch",
            "recipientAcknowledged","schemaVersion","subscriptionArn",
            "syntheticMessageIdSha256","topicArn"])
          and .schemaVersion == 1 and .topicArn == $runtime.alerting.topicArn
          and .recipientAcknowledged == true
          and (.ackFileSha256 | e0_hash) and (.endpointSha256 | e0_hash)
          and (.deliveryEvidenceSha256 | e0_hash) and (.syntheticMessageIdSha256 | e0_hash)
          and (.acknowledgedBy | e0_login)
          and (.probePublishedAtEpoch | e0_positive_integer)
          and (.acknowledgedAtEpoch | e0_positive_integer)
          and .probePublishedAtEpoch <= .acknowledgedAtEpoch
          and .acknowledgedAtEpoch <= $evidence.issuedAtEpoch
          and ($evidence.issuedAtEpoch - .acknowledgedAtEpoch) <= 3024000
          and any($runtime.alerting.confirmedHumanSubscriptions[];
            .subscriptionArn == $ack.subscriptionArn
            and .endpointSha256 == $ack.endpointSha256)))
  and (.logMonitoring
    | e0_exact_keys(["groups","prefix"])
      and .prefix == "/ecs/watchdog-bms-prod-"
      and (.groups | type == "array" and length >= 1 and . == sort_by(.name)
        and (map(.name) | length == (unique | length))
        and all(.[];
          e0_exact_keys(["kmsKeyArn","metricFilterCount","name","rawLogGroupSha256",
            "rawMetricFiltersSha256","retentionDays"])
          and (.name | type == "string" and startswith("/ecs/watchdog-bms-prod-"))
          and (.retentionDays | e0_positive_integer and . >= 90)
          and (.kmsKeyArn | type == "string"
            and test("^arn:aws:kms:ap-southeast-1:311414082667:key/[0-9a-f-]{36}$"))
          and (.metricFilterCount | e0_positive_integer)
          and (.rawLogGroupSha256 | e0_hash) and (.rawMetricFiltersSha256 | e0_hash))))
  and (.clamavCandidate as $clamav
    | $clamav | e0_exact_keys(["apiDigest","apiImage","candidateSource","checkedAtEpoch",
        "cleanVerdict","eicarVerdict","outputSha256","provider","scannerHost","scannerPort",
        "scannerVersion","sourceCommit","testScriptSha256"])
      and .provider == "COLOCATED_CLAMAV" and .candidateSource == "UAT_ACCEPTED_API_IMAGE"
      and .sourceCommit == $evidence.sourceCommit and (.apiDigest | e0_digest)
      and .apiImage == ("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/"
        + "watchdog-bms-api@" + .apiDigest)
      and .scannerHost == "127.0.0.1" and .scannerPort == 3310
      and (.scannerVersion | type == "string" and test("^ClamAV 1\\.5\\.[0-9]+/"))
      and .cleanVerdict == "CLEAN" and .eicarVerdict == "MALWARE_DETECTED"
      and (.testScriptSha256 | e0_hash) and (.outputSha256 | e0_hash)
      and (.checkedAtEpoch | e0_positive_integer)
      and .checkedAtEpoch <= $runtime.observedAtEpoch
      and ($runtime.observedAtEpoch - .checkedAtEpoch) <= 3600
      and any($artifact.services[];
        .service == "api-web" and .image == $clamav.apiImage
        and .digest == $clamav.apiDigest and .sourceCommit == $clamav.sourceCommit));

def e0_pass_check:
  e0_exact_keys(["evidenceSha256","status"])
  and .status == "PASS" and (.evidenceSha256 | e0_hash);

def e0_h3($evidence):
  . as $p
  | e0_exact_keys(["candidateMigrationSetHash","checks","expectedClosedWhtRouteHash",
    "expectedDataTransformHash","expectedSchemaDeltaHash","expectedSeededRouteHash",
    "lockBudgetPolicyHash","passed","preflightCatalogHash","releaseManifestSha256",
    "reviewedMigrationOperationsHash","services","uatAcceptanceRef","verificationEvidence"])
  and (.uatAcceptanceRef | e0_child_ref("UAT_DEPLOYMENT_ACCEPTANCE"))
  and (.releaseManifestSha256 | e0_hash)
  and (.candidateMigrationSetHash | e0_hash)
  and (.reviewedMigrationOperationsHash | e0_hash)
  and (.expectedSchemaDeltaHash | e0_hash)
  and (.expectedDataTransformHash | e0_hash)
  and (.preflightCatalogHash | e0_hash)
  and (.lockBudgetPolicyHash | e0_hash)
  and (.expectedSeededRouteHash | e0_hash)
  and (.expectedClosedWhtRouteHash | e0_hash)
  and (.services | type == "array" and length == 3 and . == sort_by(.service)
    and map(.service) == ["ai-gateway","api-web","workers"]
    and all(.[]; e0_security_service($evidence.sourceCommit)))
  and (.verificationEvidence
    | e0_exact_keys(["artifactIntegrity","awsIdentityBoundary","controllerTrust","migrationReview",
        "productionEnvironmentPolicy","protectedMainPolicy","rollbackRecovery",
        "runtimeSecurityBaseline"])
      and (.controllerTrust | e0_h3_controller_evidence($evidence))
      and (.artifactIntegrity
        | e0_h3_artifact_evidence($evidence; $p.uatAcceptanceRef; $p.releaseManifestSha256))
      and (.migrationReview | e0_h3_migration_evidence($evidence))
      and (.rollbackRecovery | e0_h3_rollback_evidence)
      and (.protectedMainPolicy | e0_h3_protected_main_evidence)
      and (.productionEnvironmentPolicy | e0_h3_environment_evidence)
      and (.awsIdentityBoundary | e0_h3_aws_evidence($evidence.repository))
      and (.runtimeSecurityBaseline
        | e0_h3_runtime_security($evidence; $p.verificationEvidence.artifactIntegrity)))
  and .candidateMigrationSetHash
    == .verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.candidateMigrationSetHash
  and .reviewedMigrationOperationsHash
    == .verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.reviewedMigrationOperationsHash
  and .expectedSchemaDeltaHash
    == .verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.expectedSchemaDeltaHash
  and .expectedDataTransformHash
    == .verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.expectedDataTransformHash
  and .preflightCatalogHash
    == .verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.preflightCatalogHash
  and .lockBudgetPolicyHash
    == .verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.lockBudgetPolicyHash
  and .expectedSeededRouteHash
    == .verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.expectedSeededRouteHash
  and .expectedClosedWhtRouteHash
    == .verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.expectedClosedWhtRouteHash
  and .services == (.verificationEvidence.artifactIntegrity.services
    | map({service,image,digest,ociRevision,ciSignatureVerified:true,
        ciSignerIdentity:.liveSignerIdentity,sbomSha256,scanStatus,critical,high}))
  and (.checks
    | e0_exact_keys(["artifactIntegrity","awsIdentityBoundary","controllerTrust","migrationReview",
        "productionEnvironmentPolicy","protectedMainPolicy","rollbackRecovery",
        "runtimeSecurityBaseline"])
      and (.controllerTrust
        | e0_exact_keys(["ciWorkflowBlob","evidenceSha256","productionDeployWorkflowBlob","status",
            "uatDeployWorkflowBlob","validatorSetHash"])
          and .status == "PASS" and (.ciWorkflowBlob | e0_sha)
          and (.uatDeployWorkflowBlob | e0_sha) and (.productionDeployWorkflowBlob | e0_sha)
          and (.validatorSetHash | e0_hash) and (.evidenceSha256 | e0_hash))
      and .controllerTrust.ciWorkflowBlob == $p.verificationEvidence.controllerTrust.ciWorkflowBlob
      and .controllerTrust.uatDeployWorkflowBlob == $p.verificationEvidence.controllerTrust.uatDeployWorkflowBlob
      and .controllerTrust.productionDeployWorkflowBlob
        == $p.verificationEvidence.controllerTrust.productionDeployWorkflowBlob
      and (.artifactIntegrity | e0_pass_check)
      and (.rollbackRecovery | e0_pass_check)
      and (.awsIdentityBoundary | e0_pass_check)
      and (.runtimeSecurityBaseline | e0_pass_check)
      and (.migrationReview
        | e0_exact_keys(["additiveCount","allPreconditionsPass","backwardCompatibleNonadditiveCount",
            "blockingContractCount","boundedTimeoutPolicyVerified","candidateCount","dataBackfillCount",
            "destructiveCustomerDataLossCount","evidenceSha256","legacyExpectedAbsentProfileVerified",
            "manualCustomerInputCount","productionCloneRehearsalPass","status","unreviewedCount"])
          and .status == "PASS"
          and (.candidateCount | e0_integer)
          and all([.additiveCount,.backwardCompatibleNonadditiveCount,.dataBackfillCount,.blockingContractCount][];
            e0_integer)
          and .candidateCount == (.additiveCount + .backwardCompatibleNonadditiveCount
            + .dataBackfillCount + .blockingContractCount)
          and .destructiveCustomerDataLossCount == 0 and .manualCustomerInputCount == 0
          and .unreviewedCount == 0 and .allPreconditionsPass == true
          and .productionCloneRehearsalPass == true and .boundedTimeoutPolicyVerified == true
          and .legacyExpectedAbsentProfileVerified == true and (.evidenceSha256 | e0_hash))
      and .migrationReview.candidateCount
        == $p.verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.migrationRiskSummary.candidateCount
      and .migrationReview.additiveCount
        == $p.verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.migrationRiskSummary.additiveCount
      and .migrationReview.backwardCompatibleNonadditiveCount
        == $p.verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.migrationRiskSummary.backwardCompatibleNonadditiveCount
      and .migrationReview.dataBackfillCount
        == $p.verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.migrationRiskSummary.dataBackfillCount
      and .migrationReview.blockingContractCount
        == $p.verificationEvidence.migrationReview.productionA5PreMutationPayload.migrationState.migrationRiskSummary.blockingContractCount
      and (.protectedMainPolicy
        | e0_exact_keys(["deletionAllowed","dismissStaleReviews","enforceAdmins","evidenceSha256",
            "forcePushAllowed","requireLastPushApproval","requiredPullRequestApprovals",
            "requiredStatusContextCount","requiredStatusContextsHash","status","strictRequiredChecks"])
          and .status == "PASS" and .strictRequiredChecks == true
          and .requiredStatusContextCount == 6 and (.requiredStatusContextsHash | e0_hash)
          and .enforceAdmins == true and .requiredPullRequestApprovals == 1
          and .dismissStaleReviews == true and .requireLastPushApproval == true
          and .forcePushAllowed == false and .deletionAllowed == false
          and (.evidenceSha256 | e0_hash))
      and (.productionEnvironmentPolicy
        | e0_exact_keys(["evidenceSha256","lastConfigurationHttpStatus","mainOnly",
            "nativeRequiredReviewerCount","nativeReviewerRule","nativeSelfReviewPrevented","status"])
          and .status == "PASS" and .mainOnly == true and (.evidenceSha256 | e0_hash)
          and .nativeReviewerRule == "NOT_CONFIGURED"
          and .nativeRequiredReviewerCount == 0 and .nativeSelfReviewPrevented == null
          and .lastConfigurationHttpStatus == null))
  and .passed == true;

def e0_wht_reviewed:
  e0_exact_keys(["closed","open","routeHash","routes","total"])
  and .total == 3 and .open == 0 and .closed == 3
  and (.routeHash | e0_hash) and .routes == e0_wht_route_names;

def e0_h4($evidence):
  . as $p
  | e0_exact_keys(["deploymentClass","enforcement","humanEvidence","pending","productionA5",
      "ownerApprovalRef","securityPreflightRef","shadowOnlyReady","stage","u5Capacity",
      "uatAcceptanceRef","wht"])
  and (.stage == "PRE_AUTHORIZATION" or .stage == "POST_DEPLOYMENT")
  and .deploymentClass == "PRODUCTION_SHADOW_ONLY"
  and (.uatAcceptanceRef | e0_child_ref("UAT_DEPLOYMENT_ACCEPTANCE"))
  and (.securityPreflightRef | e0_child_ref("PRODUCTION_SECURITY_PREFLIGHT_V1"))
  and (.productionA5 as $production
    | $production
    | e0_exact_keys(["cloneRehearsalRef","migrationTool","postDeploymentRef",
        "postMigrationRef","preMutationRef"])
      and (.preMutationRef | e0_child_ref("PRODUCTION_A5_EVIDENCE_V1"))
      and (.cloneRehearsalRef | e0_child_ref("PRODUCTION_A5_CLONE_REHEARSAL_V1"))
      and (.migrationTool | e0_clone_migration_tool($evidence; $production.cloneRehearsalRef;
          $p.enforcement.reviewedMigrationMaterialization.candidateMigrationSetHash))
      and (if $p.stage == "PRE_AUTHORIZATION" then
        .postMigrationRef == null and .postDeploymentRef == null
      else
        (.postMigrationRef | e0_child_ref("PRODUCTION_A5_EVIDENCE_V1"))
        and (.postDeploymentRef | e0_child_ref("PRODUCTION_A5_EVIDENCE_V1"))
      end))
  and (if $p.stage == "PRE_AUTHORIZATION" then .ownerApprovalRef == null
    else (.ownerApprovalRef | e0_child_ref("OWNER_U5E_APPROVAL_V1")) end)
  and (.u5Capacity
    | e0_exact_keys(["restriction","resultRef","status"])
      and (if .status == "PENDING" then
        .resultRef == null and .restriction == "NO_BATCH_OR_ENFORCEMENT"
      elif .status == "PASS" then
        (.resultRef | e0_child_ref("U5_CAPACITY_RESULT_V1")) and .restriction == null
      else false end))
  and (.wht as $wht
    | $wht
      | e0_exact_keys(["actual","reviewedExpectedAfterMigration","status"])
      and (.reviewedExpectedAfterMigration | e0_wht_reviewed)
      and (if $p.stage == "PRE_AUTHORIZATION" then
        .status == "PLANNED_CLOSED_MATERIALIZATION" and .actual == null
      else
        .status == "MATERIALIZED_CLOSED" and (.actual | e0_wht_reviewed)
        and $wht.actual.routeHash == $wht.reviewedExpectedAfterMigration.routeHash
      end))
  and (.enforcement
    | e0_exact_keys(["baseline","requestedAllowListChanges","requestedEntitlementTransitions",
        "requestedLaunchGateTransitions","requestedSafeOffAdmissions","result",
        "reviewedMigrationMaterialization"])
      and (.baseline
        | e0_exact_keys(["effectiveOpenPolicyHash","preexistingAuthorityStateHash",
            "preexistingEntitlementStateHash"])
          and all(.[]; e0_hash))
      and (.reviewedMigrationMaterialization
        | e0_exact_keys(["candidateMigrationSetHash","expectedClosedWhtRouteHash",
            "expectedDataTransformHash","expectedSchemaDeltaHash","expectedSeededRouteHash",
            "lockBudgetPolicyHash","preflightCatalogHash","reviewedMigrationOperationsHash"])
          and all(.[]; e0_hash))
      and .requestedEntitlementTransitions == [] and .requestedLaunchGateTransitions == []
      and .requestedSafeOffAdmissions == [] and .requestedAllowListChanges == []
      and .result == (if $p.stage == "PRE_AUTHORIZATION"
        then "PLANNED_CLOSED_REVIEWED_MATERIALIZATION" else "UNCHANGED" end))
  and .humanEvidence == {
    claimed:false,usabilityReports:[],specialistApprovals:[],restriction:"NOT_GA_OR_WHT_OPEN_AUTHORITY"
  }
  and (.pending | e0_sorted_unique_strings)
  and all(.pending[];
    . == "ASYNC_SHADOW_OR_ROUTE_JOURNEY" or . == "U5_CAPACITY_RESULT"
    or . == "NON_REPORTS_SAFE_OFF" or . == "VAT_NATURALLY_ELIGIBLE_UAT_JOURNEY"
    or . == "WHT_STATUTORY_ACCEPTANCE" or . == "ACTIONABLE_WORK_CARD"
    or . == "ACCESSIBILITY" or . == "MODERATED_USABILITY_2X5")
  and ((.u5Capacity.status == "PENDING") == (.pending | index("U5_CAPACITY_RESULT") != null))
  and .shadowOnlyReady == true;

def e0_h5($evidence):
  . as $approval
  | e0_exact_keys(["approvalScope","approver","authorizedActions","candidateMigrationSetHash",
    "expectedClosedWhtRouteHash","expectedDataTransformHash","expectedSchemaDeltaHash",
    "expectedSeededRouteHash","lockBudgetPolicyHash","maintenanceWindow","migrationTool",
    "preAggregateRef","preflightCatalogHash","productionA5CloneRef",
    "productionA5PreMutationRef","reviewedMigrationOperationsHash","securityPreflightRef",
    "uatAcceptanceRef"])
  and .approvalScope == "PRODUCTION_SHADOW_ONLY"
  and (.approver
    | e0_exact_keys(["authority","login"])
      and .authority == "GITHUB_REPOSITORY_OWNER" and (.login | e0_login)
      and .login == $evidence.producer.actor and .login == $evidence.producer.triggeringActor)
  and (.preAggregateRef | e0_child_ref("U5_SHADOW_AGGREGATE_V1"))
  and (.uatAcceptanceRef | e0_child_ref("UAT_DEPLOYMENT_ACCEPTANCE"))
  and (.productionA5PreMutationRef | e0_child_ref("PRODUCTION_A5_EVIDENCE_V1"))
  and (.productionA5CloneRef | e0_child_ref("PRODUCTION_A5_CLONE_REHEARSAL_V1"))
  and (.securityPreflightRef | e0_child_ref("PRODUCTION_SECURITY_PREFLIGHT_V1"))
  and (.candidateMigrationSetHash | e0_hash)
  and (.reviewedMigrationOperationsHash | e0_hash)
  and (.expectedSchemaDeltaHash | e0_hash)
  and (.expectedDataTransformHash | e0_hash)
  and (.preflightCatalogHash | e0_hash)
  and (.lockBudgetPolicyHash | e0_hash)
  and (.expectedSeededRouteHash | e0_hash)
  and (.expectedClosedWhtRouteHash | e0_hash)
  and (.migrationTool | e0_clone_migration_tool($evidence; $approval.productionA5CloneRef;
      $approval.candidateMigrationSetHash))
  and (.maintenanceWindow | e0_maintenance_window)
  and .maintenanceWindow.windowId == ("u5e-" + $evidence.parentProductionRun.runId
    + "-a" + ($evidence.parentProductionRun.runAttempt|tostring) + "-"
    + $evidence.producer.runId + "-a" + ($evidence.producer.runAttempt|tostring))
  and .maintenanceWindow.startsAtEpochMs == ($evidence.issuedAtEpoch * 1000)
  and .maintenanceWindow.endsAtEpochMs == ($evidence.expiresAtEpoch * 1000)
  and ($evidence.expiresAtEpoch - $evidence.issuedAtEpoch) == 1800
  and .authorizedActions == {
    applyExactReviewedMigrationSet:true,
    materializeExactReviewedClosedFeatureLaunchObjects:true,
    deployExactAcceptedImages:true,
    entitlementTransitions:[],launchGateTransitions:[],safeOffAdmissions:[],allowListChanges:[]
  };

def e0_validate_payload_contract:
  . as $evidence
  | if .artifactKind == "PRODUCTION_A5_EVIDENCE_V1" then
      (.payload as $payload
        | ($payload | e0_h2($evidence))
        and ($payload.readerRuntime
          | e0_reader_runtime_producer($evidence.producer.runId;
              $evidence.producer.runAttempt; $payload.stage)))
    elif .artifactKind == "PRODUCTION_A5_CLONE_REHEARSAL_V1" then (.payload | e0_h2_clone($evidence))
    elif .artifactKind == "PRODUCTION_SECURITY_PREFLIGHT_V1" then (.payload | e0_h3($evidence))
    elif .artifactKind == "U5_SHADOW_AGGREGATE_V1" then (.payload | e0_h4($evidence))
    elif .artifactKind == "OWNER_U5E_APPROVAL_V1" then (.payload | e0_h5($evidence))
    else false end;
