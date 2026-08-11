include "evidence-contracts";

def e0_fixture_hash: ("a" * 64);
def e0_fixture_sha: ("b" * 40);
def e0_fixture_ref($kind): {
  artifactKind:$kind,producerRunId:"7001",producerRunAttempt:1,artifactName:"derived-artifact",
  contentSha256:e0_fixture_hash,artifactDigest:("sha256:" + e0_fixture_hash)
};

def e0_fixture_endpoint_boundary($clone_task_sg; $reader_task_sg; $subnets): {
  vpcId:"vpc-00000000",endpointSecurityGroupId:"sg-00000003",
  authorizedTaskSecurityGroupIds:([$clone_task_sg,$reader_task_sg,"sg-00000004","sg-00000005","sg-00000006","sg-00000007"]|sort),
  taskSubnetIds:($subnets|sort),taskRouteTableIds:["rtb-00000000"],
  s3PrefixListId:"pl-00000000",
  interfaceEndpoints:[
    {serviceName:"com.amazonaws.ap-southeast-1.ecr.api",vpcEndpointId:"vpce-00000001"},
    {serviceName:"com.amazonaws.ap-southeast-1.ecr.dkr",vpcEndpointId:"vpce-00000002"},
    {serviceName:"com.amazonaws.ap-southeast-1.logs",vpcEndpointId:"vpce-00000003"},
    {serviceName:"com.amazonaws.ap-southeast-1.secretsmanager",vpcEndpointId:"vpce-00000004"}
  ],
  s3GatewayEndpoint:{serviceName:"com.amazonaws.ap-southeast-1.s3",vpcEndpointId:"vpce-00000005"},
  natGatewayRoutePresent:true,publicInternetGatewayRoutePresent:false,
  taskSecurityGroupsAllowNatEgress:false,
  policies:{ecrSha256:e0_fixture_hash,logsSha256:e0_fixture_hash,
    secretsManagerSha256:e0_fixture_hash,s3Sha256:e0_fixture_hash},
  rawEvidence:{describeVpcEndpointsSha256:e0_fixture_hash,
    describeRouteTablesSha256:e0_fixture_hash,describeEndpointSecurityGroupSha256:e0_fixture_hash}
};

def e0_fixture_migration: {
  relativePath:"apps/api/prisma/migrations/20260801000000_fixture/migration.sql",
  migrationName:"20260801000000_fixture",checksumSha256:e0_fixture_hash,operationClass:"ADDITIVE",
  preconditions:[{id:"fixture:pre",queryHash:e0_fixture_hash,expectedResultHash:e0_fixture_hash}],
  executionBudget:{lockTimeoutMs:2000,statementTimeoutMs:300000},
  postSchemaInvariants:[{id:"fixture:post-schema",queryHash:e0_fixture_hash,
    expectedResultHash:e0_fixture_hash}],postDataInvariants:[]
};

def e0_fixture_seeded_routes:
  ([range(0;17) | {gateKey:("cap.fixture" + (.|tostring)),routeKey:"READ",state:"OPEN"}]
    + e0_wht_routes) | sort_by([.gateKey,.routeKey]);

def e0_fixture_reviewed_manifest: {
  schemaVersion:3,
  catalogScope:{version:1,schema:"public",
    objectKinds:["COLUMN","CONSTRAINT","ENUM_VALUE","INDEX","RELATION"]},
  reviewedMigrationManifest:[e0_fixture_migration],
  preSchemaCatalogObjects:[],postSchemaCatalogObjects:[],
  expectedSeededRoutes:e0_fixture_seeded_routes,
  expectedClosedWhtRoutes:e0_wht_routes
};

def e0_fixture_applied_migrations: [{
  name:"20260701000000_fixture",checksum:e0_fixture_hash,appliedOrder:1
}];

def e0_fixture_result($id): {migrationName:"20260801000000_fixture",id:$id,
  queryHash:e0_fixture_hash,expectedResultHash:e0_fixture_hash,actualResultHash:e0_fixture_hash};
def e0_fixture_verified_results($results):
  {status:"VERIFIED",results:$results,resultsHash:e0_fixture_hash};
def e0_fixture_executed_migrations:
  {status:"VERIFIED",migrations:[{
    relativePath:"apps/api/prisma/migrations/20260801000000_fixture/migration.sql",
    migrationName:"20260801000000_fixture",checksumSha256:e0_fixture_hash,executionOrder:1
  }],migrationsHash:e0_fixture_hash};
def e0_fixture_budget_results: [{migrationName:"20260801000000_fixture",
  maintenanceWindowId:"fixture-window",effectiveLockTimeoutMs:2000,
  effectiveStatementTimeoutMs:300000,lockTimeoutEnforced:true,statementTimeoutEnforced:true,
  lockWaitBelowTimeout:true,observedStatementDurationMs:100,
  maintenanceWindowStartedAtEpochMs:1100,maintenanceWindowFinishedAtEpochMs:1200}];
def e0_fixture_production_budget_results:
  e0_fixture_budget_results | map(.maintenanceWindowId="u5e-8001-a1-7001-a1");
def e0_fixture_clone_rehearsal: {
  result:"PASSED",engine:"PostgreSQL",engineVersion:"18.1",
  sourceDatabaseFingerprint:e0_fixture_hash,sourceAppliedMigrationsHash:e0_fixture_hash,
  sourceSchemaCatalogFingerprint:e0_fixture_hash,
  resultSchemaCatalogFingerprint:e0_fixture_hash,reviewedMigrationOperationsHash:e0_fixture_hash,
  expectedSchemaDeltaHash:e0_fixture_hash,expectedDataTransformHash:e0_fixture_hash,
  preconditionResults:e0_fixture_verified_results([e0_fixture_result("fixture:pre")]),
  postSchemaResults:e0_fixture_verified_results([e0_fixture_result("fixture:post-schema")]),
  postDataResults:e0_fixture_verified_results([]),executedMigrations:e0_fixture_executed_migrations,
  executionBudgetResults:e0_fixture_budget_results,executionBudgetResultsHash:e0_fixture_hash,
  cleanup:{status:"DESTROYED",cloneIdentifierHash:e0_fixture_hash,destroyedAtEpochMs:1300,
    residualObjectCount:0},resultHash:e0_fixture_hash
};
def e0_fixture_verification($stage): {
  cloneRehearsalRef:e0_fixture_ref("PRODUCTION_A5_CLONE_REHEARSAL_V1"),
  preconditionResults:e0_fixture_verified_results([e0_fixture_result("fixture:pre")]),
  postSchemaResults:(if $stage == "PRE_MUTATION" then {status:"NOT_RUN",results:null,resultsHash:null}
    else e0_fixture_verified_results([e0_fixture_result("fixture:post-schema")]) end),
  postDataResults:(if $stage == "PRE_MUTATION" then {status:"NOT_RUN",results:null,resultsHash:null}
    else e0_fixture_verified_results([]) end),
  executedMigrations:(if $stage == "PRE_MUTATION"
    then {status:"NOT_RUN",migrations:null,migrationsHash:null}
    else e0_fixture_executed_migrations end),
  executionBudgetResults:(if $stage == "PRE_MUTATION" then e0_fixture_budget_results
    else e0_fixture_production_budget_results end),executionBudgetResultsHash:e0_fixture_hash,
  cloneRehearsal:e0_fixture_clone_rehearsal
};

def e0_fixture_comparisons($stage): {
  preexistingEntitlementsUnchanged:(if $stage == "PRE_MUTATION" then null else true end),
  preexistingAuthorityUnchanged:(if $stage == "PRE_MUTATION" then null else true end),
  effectiveOpenPolicyUnchanged:(if $stage == "PRE_MUTATION" then null else true end),
  safeOffAdmissionsUnchanged:(if $stage == "PRE_MUTATION" then null else true end),
  allowListUnchanged:(if $stage == "PRE_MUTATION" then null else true end),
  exactReviewedMigrationSetApplied:(if $stage == "PRE_MUTATION" then null else true end),
  exactExpectedSchemaDeltaMaterialized:(if $stage == "PRE_MUTATION" then null else true end),
  exactExpectedDataTransformsVerified:(if $stage == "PRE_MUTATION" then null else true end),
  allPreflightConditionsSatisfied:(if $stage == "PRE_MUTATION" then null else true end),
  lockBudgetSatisfied:(if $stage == "PRE_MUTATION" then null else true end),
  exactReviewedSeedMaterialized:(if $stage == "PRE_MUTATION" then null else true end),
  closedWhtMaterialized:(if $stage == "PRE_MUTATION" then null else true end),
  postMigrationLaunchStateUnchanged:(if $stage == "POST_DEPLOYMENT" then true else null end)
};

def e0_fixture_reimbursement_image:
  ("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:" + e0_fixture_hash);
def e0_fixture_reimbursement_proof($name; $source; $quiesced; $observed): {
  sourceCommit:$source,image:e0_fixture_reimbursement_image,
  serviceRevisionArn:("arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/api-web/" + $name),
  activeTaskArns:[("arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/" + $name)],
  quiesceEnabled:$quiesced,observedAtEpoch:$observed
};
def e0_fixture_reimbursement_quiesce($stage; $source): {
  status:(if $stage == "PRE_MUTATION" then "BRIDGE_ONLY_QUIESCED"
    elif $stage == "POST_MIGRATION" then "BRIDGE_ONLY_QUIESCED_POST_MIGRATION"
    else "FINAL_ONLY_UNQUIESCED" end),
  acceptedFinalSourceCommit:$source,acceptedFinalApiImage:e0_fixture_reimbursement_image,
  bridgeProof:e0_fixture_reimbursement_proof("bridge";$source;true;1010),
  finalQuiescedProof:(if $stage == "POST_DEPLOYMENT"
    then e0_fixture_reimbursement_proof("final-closed";$source;true;1100) else null end),
  finalUnquiescedProof:(if $stage == "POST_DEPLOYMENT"
    then e0_fixture_reimbursement_proof("final-open";$source;false;1190) else null end),
  quiesceStartedAtEpoch:1000,quiesceEndedAtEpoch:(if $stage == "POST_DEPLOYMENT" then 1200 else null end),
  durationSeconds:(if $stage == "POST_DEPLOYMENT" then 200 else null end),
  blockedMutations:{status:"NOT_AVAILABLE",count:null},
  reimbursementInvariantHash:(if $stage == "PRE_MUTATION" then null else e0_fixture_hash end),
  allActiveTasksGuarded:true,allPreBridgeTasksRetired:true,
  allBridgeTasksRetired:(if $stage == "POST_DEPLOYMENT" then true else null end),
  sameFinalImageAcrossUnquiesce:(if $stage == "POST_DEPLOYMENT" then true else null end),
  failurePolicy:"LEAVE_QUIESCED"
};

def e0_fixture_health_service($service):
  (if $service == "api-web" then {
    name:"watchdog-bms-api-web-pub",parameter:"/watchdog-bms/production/ecs-express-api-web-url",
    path:"/v1/health"
  } elif $service == "ai-gateway" then {
    name:"watchdog-bms-ai-gateway-v2",parameter:"/watchdog-bms/production/ecs-express-ai-gateway-url",
    path:"/v1/health"
  } else {
    name:"watchdog-bms-workers",parameter:"/watchdog-bms/production/ecs-express-workers-url",
    path:"/health"
  } end) as $expected
  | ($expected.name + ".example.com") as $host
  | ("https://" + $host) as $endpoint
  | ("arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:targetgroup/"
      + $expected.name + "/aaaaaaaaaaaaaaaa") as $target_group
  | ("arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/"
      + $expected.name + "/1") as $revision
  | ("arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/"
      + $expected.name) as $service_arn
  | ("arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-prod-"
      + $service + ":1") as $task_definition
  | ("arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/"
      + (if $service == "ai-gateway" then "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        elif $service == "api-web" then "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        else "cccccccccccccccccccccccccccccccc" end)) as $task_arn
  | (if $service == "ai-gateway" then "10.0.0.11"
      elif $service == "api-web" then "10.0.0.12" else "10.0.0.13" end) as $private_ip
  | {minTaskCount:1,maxTaskCount:2,autoScalingMetric:"AVERAGE_CPU",
      autoScalingTargetValue:70} as $scaling
  | {serviceArn:$service_arn,status:{statusCode:"ACTIVE"},currentDeployment:null,
      activeConfigurations:[{serviceRevisionArn:$revision,scalingTarget:$scaling,
        primaryContainer:{containerPort:3000},
        ingressPaths:[{accessType:"PUBLIC",endpoint:$host,
          targetGroups:[{arn:$target_group}]}]}]} as $express
  | {
    service:$service,
    serviceArn:$service_arn,serviceRevisionArn:$revision,serviceStatus:"ACTIVE",
    currentDeployment:null,containerName:"Main",containerPort:3000,
    taskDefinition:{arn:$task_definition,revision:1},
    scalingTarget:$scaling,runningTaskArns:[$task_arn],runningTaskPrivateIps:[$private_ip],
    targetGroupArn:$target_group,targetHealth:[{privateIp:$private_ip,port:3000,state:"healthy"}],
    ingress:{accessType:"PUBLIC",endpoint:$endpoint},ssmUrlParameter:$expected.parameter,
    healthPath:$expected.path,healthUrl:($endpoint+$expected.path),httpStatus:200,
    healthBody:{status:"ok"},observedAtEpoch:1699999980,
    rawEvidence:{
      describeExpressGatewayService:{sha256:e0_fixture_hash,
        raw:{first:{service:$express},second:{service:$express}}},
      describeServiceRevisions:{sha256:e0_fixture_hash,raw:{serviceRevisions:[{
        serviceArn:$service_arn,serviceRevisionArn:$revision,taskDefinition:$task_definition,
        resolvedConfiguration:{scalingTarget:$scaling},
        loadBalancers:[{targetGroupArn:$target_group,containerName:"Main",containerPort:3000}],
        ecsManagedResources:{ingressPaths:[{accessType:"PUBLIC",endpoint:$host,
          targetGroups:[{arn:$target_group}]}]}
      }]}},
      listTasks:{sha256:e0_fixture_hash,raw:{taskArns:[$task_arn]}},
      describeTasks:{sha256:e0_fixture_hash,raw:{failures:[],tasks:[{
        taskArn:$task_arn,taskDefinitionArn:$task_definition,lastStatus:"RUNNING",
        desiredStatus:"RUNNING",group:("service:"+$expected.name),
        attachments:[{type:"ElasticNetworkInterface",details:[
          {name:"networkInterfaceId",value:"eni-aaaaaaaaaaaaaaaaa"},
          {name:"privateIPv4Address",value:$private_ip}]}]
      }]}},
      describeNetworkInterfaces:{sha256:e0_fixture_hash,raw:{NetworkInterfaces:[{
        NetworkInterfaceId:"eni-aaaaaaaaaaaaaaaaa",PrivateIpAddress:$private_ip,Status:"in-use"
      }]}},
      describeTargetGroups:{sha256:e0_fixture_hash,raw:{TargetGroups:[{
        TargetGroupArn:$target_group,TargetType:"ip",Port:3000,HealthCheckPath:$expected.path
      }]}},
      describeTargetHealth:{sha256:e0_fixture_hash,raw:{TargetHealthDescriptions:[{
        Target:{Id:$private_ip,Port:3000},TargetHealth:{State:"healthy"}
      }]}},
      ssmParameter:{sha256:e0_fixture_hash,raw:{Parameter:{Name:$expected.parameter,
        Type:"String",Value:$endpoint}}},
      publicHealth:{sha256:e0_fixture_hash,raw:{url:($endpoint+$expected.path),httpStatus:200,
        body:{status:"ok"},checkedAtEpoch:1699999980}}
    }
  };

def e0_fixture_current_health: {
  status:"PASS",observedAtEpoch:1699999990,
  services:[e0_fixture_health_service("ai-gateway"),e0_fixture_health_service("api-web"),
    e0_fixture_health_service("workers")],servicesHash:e0_fixture_hash
};

def e0_fixture_reader_runtime($stage; $source):
  (if $stage == "PRE_MUTATION" then "pre"
    elif $stage == "POST_MIGRATION" then "post-migration" else "post-deployment" end) as $slug
  | (if $stage == "PRE_MUTATION" then "p"
    elif $stage == "POST_MIGRATION" then "m" else "d" end) as $short_stage
  | ("watchdog-a5-production-reader-7001-a1-"+$slug) as $family
  | ("arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/"
      + "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") as $task
  | {
    schemaVersion:1,sourceCommit:$source,stage:$stage,
    migrationImage:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/"
      + "watchdog-bms-migration-tool@sha256:"+e0_fixture_hash),
    clusterArn:"arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod",
    readerSecret:{
      arn:("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"
        + "watchdog-bms/production/a5-readonly-database-url-AbCd12"),
      versionId:"12345678-1234-1234-1234-123456789abc",versionStage:"AWSCURRENT",
      metadataSha256:e0_fixture_hash},
    taskDefinition:{
      arn:("arn:aws:ecs:ap-southeast-1:311414082667:task-definition/"+$family+":1"),
      family:$family,revision:1,sha256:e0_fixture_hash,
      executionRoleArn:("arn:aws:iam::311414082667:role/"
        + "watchdog-bms-production-a5-readonly-execution"),taskRoleArn:null},
    task:{arn:$task,startedBy:("a5r-7001-a1-"+$short_stage),lastStatus:"STOPPED",exitCode:0,
      privateIps:["10.0.1.10"],describeTasksSha256:e0_fixture_hash,
      describeNetworkInterfacesSha256:e0_fixture_hash},
    network:{assignPublicIp:"DISABLED",privateSubnetIds:["subnet-00000000","subnet-00000001"],
      taskSecurityGroupId:"sg-00000000",databaseSecurityGroupId:"sg-00000001",
      databaseInstanceIdentifier:"watchdog-bms-prod-db",databasePubliclyAccessible:false,
      endpointBoundary:e0_fixture_endpoint_boundary("sg-00000002";"sg-00000000";
        ["subnet-00000000","subnet-00000001"]),
      describeTaskSecurityGroupSha256:e0_fixture_hash,
      describeDatabaseSecurityGroupSha256:e0_fixture_hash,describeSubnetsSha256:e0_fixture_hash,
      describeDbInstanceSha256:e0_fixture_hash,describeEndpointSecurityGroupSha256:e0_fixture_hash,
      describeVpcEndpointsSha256:e0_fixture_hash,describeRouteTablesSha256:e0_fixture_hash},
    inputBundleSha256:e0_fixture_hash,
    output:{marker:("a5-prod-7001-a1-"+$slug),
      logGroup:"/ecs/watchdog-bms-production-a5-readonly",
      logStream:("production-a5/reader/"+($task|split("/")[-1])),frameCount:1,
      payloadBytes:4096,payloadSha256:e0_fixture_hash,eventsSha256:e0_fixture_hash,exitCode:0}
  };

def e0_fixture_migration_tool($source): {
  digest:("sha256:"+e0_fixture_hash),
  image:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/"
    + "watchdog-bms-migration-tool@sha256:"+e0_fixture_hash),
  sourceCommit:$source,dockerfilePath:"apps/api/Dockerfile",dockerfileBlob:e0_fixture_sha,
  lockfilePath:"pnpm-lock.yaml",lockfileSha256:e0_fixture_hash,
  migrationCatalogHash:e0_fixture_hash,target:"migration-tool",
  registryBinding:{indexPath:"migration-tool.registry.index.json",sha256:e0_fixture_hash,
    runnablePlatform:"linux/amd64",runnableDigest:("sha256:"+("2"*64)),
    attestationManifestDigest:("sha256:"+("3"*64)),
    attestationManifestSha256:e0_fixture_hash},
  sbom:{format:"SPDX-2.3",path:"migration-tool.registry.sbom.in-toto.json",sha256:e0_fixture_hash},
  provenance:{path:"migration-tool.registry.provenance.in-toto.json",
    predicateType:"https://slsa.dev/provenance/v1",sha256:e0_fixture_hash,
    sourceCommit:$source,subjectDigest:("sha256:"+("2"*64))},
  signature:{verified:true,signedDigest:("sha256:"+e0_fixture_hash),
    identity:"https://github.com/example/repo/.github/workflows/production-a5-clone.yml@refs/heads/main",
    issuer:"https://token.actions.githubusercontent.com",outputSha256:e0_fixture_hash},
  runtimeBoundary:{serviceTrafficAttached:false,taskRoleArn:null,
    executionRoleArn:"arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone-execution"},
  tagCleanup:{temporaryTag:("u5-a5-7001-a1-"+$source[0:8]),mutableTagDeleted:true,
    digestStillPresent:true}
};

def e0_fixture_h3_migration_tool_verification($source):
  (e0_fixture_migration_tool($source)) as $tool
  | {image:$tool.image,digest:$tool.digest,sourceCommit:$source,
     registryBinding:$tool.registryBinding,sbom:$tool.sbom,provenance:$tool.provenance,
     signature:{verified:true,signedDigest:$tool.digest,identity:$tool.signature.identity,
       issuer:$tool.signature.issuer,outputSha256:e0_fixture_hash},
     scan:{requestedDigest:$tool.digest,resolvedDigest:$tool.registryBinding.runnableDigest,
       status:"COMPLETE",providerStatus:"COMPLETE",providerDescription:"fixture",
       enhancedFindingsArray:true,severityCounts:{LOW:1},critical:0,high:0,
       imagePushedAtEpoch:1699999000,scanCompletedAtEpoch:1699999500}};

def e0_fixture_reimbursement_compatibility: {
  command:("REIMBURSEMENT_PG_GATE_REQUIRED=true "
    + "pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec "
    + "src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts "
    + "src/modules/reimbursements/infrastructure/"
    + "prisma-reimbursement.repository.draft-submit-race.spec.ts"),
  commandSha256:e0_fixture_hash,combinedOutputSha256:e0_fixture_hash,
  databaseUrlBinding:"DATABASE_URL",requiredGate:"REIMBURSEMENT_PG_GATE_REQUIRED=true",
  suites:2,tests:13,pass:13,skipped:0,status:"PASSED"
};

def e0_fixture_h2($stage; $source): {
  stage:$stage,targetEnvironment:"production",
  currentHealth:e0_fixture_current_health,
  readerRuntime:e0_fixture_reader_runtime($stage;$source),
  readerBoundary:{
    role:"watchdog_a5_prod_ro",defaultReadOnly:true,transactionReadOnly:true,noTaskRole:true,
    nonPrivileged:true,noCreateOrDmlOrMaintain:true,noOutsideCoreSelect:true,
    noExecutableSecurityDefiner:true,noOwnershipOrMembership:true,coreRlsVisible:true
  },
  queryCatalogHash:e0_fixture_hash,databaseFingerprint:e0_fixture_hash,
  schemaProfile:{
    profile:(if $stage == "PRE_MUTATION" then "LEGACY_PRE_F1_EXPECTED_ABSENT" else "F1_REVIEWED_MATERIALIZED" end),
    scopeHash:e0_fixture_hash,expectedLegacyPresentRelations:e0_legacy_present,
    expectedLegacyAbsentRelations:e0_legacy_absent,
    observedPresentRelations:(if $stage == "PRE_MUTATION" then e0_legacy_present else e0_materialized_relations end),
    observedAbsentRelations:(if $stage == "PRE_MUTATION" then e0_legacy_absent else [] end),
    observedPresentFingerprint:e0_fixture_hash,observedAbsentFingerprint:e0_fixture_hash,
    unexpectedPresent:[],unexpectedMissing:[]
  },
  schemaFingerprintScope:{
    included:["tables","columns","types","defaults","nullability","identity","generated","indexes","constraints","enums"],
    excluded:["triggers","views","policies"]
  },
  migrationState:{
    appliedMigrationsHash:e0_fixture_hash,candidateMigrationSetHash:e0_fixture_hash,
    reviewedMigrationOperationsHash:e0_fixture_hash,expectedSchemaDeltaHash:e0_fixture_hash,
    expectedDataTransformHash:e0_fixture_hash,preflightCatalogHash:e0_fixture_hash,
    lockBudgetPolicyHash:e0_fixture_hash,expectedSeededRouteHash:e0_fixture_hash,
    expectedClosedWhtRouteHash:e0_fixture_hash,reviewedManifest:e0_fixture_reviewed_manifest,
    productionApplyAuthority:(if $stage == "PRE_MUTATION" then null else {
      ownerApprovalRef:e0_fixture_ref("OWNER_U5E_APPROVAL_V1"),
      maintenanceWindow:{windowId:"u5e-8001-a1-7001-a1",startsAtEpochMs:1000,
        endsAtEpochMs:2000,
        failurePolicy:"LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL"}
    } end),
    migrationRiskSummary:{candidateCount:1,additiveCount:1,backwardCompatibleNonadditiveCount:0,
      dataBackfillCount:0,blockingContractCount:0,destructiveCustomerDataLossCount:0,
      manualCustomerInputCount:0,unreviewedCount:0},
    candidateSetApplied:($stage != "PRE_MUTATION"),verificationEvidence:e0_fixture_verification($stage)
  },
  servingBuilds:[
    {service:"ai-gateway",sourceCommit:$source},{service:"api-web",sourceCommit:$source},
    {service:"workers",sourceCommit:$source}
  ],
  reimbursementApprovalSnapshots:{total:2,v2Valid:1,exactV1Compatible:1,missingHash:0,invalid:0,
    currentStepPending:2,legacyPartialApproved:0,legacyPartialRejected:0,invalidCurrentStep:0},
  reimbursementWriteQuiesce:e0_fixture_reimbursement_quiesce($stage;$source),
  authoritySnapshot:{
    preexistingEntitlementStateHash:e0_fixture_hash,preexistingAuthorityStateHash:e0_fixture_hash,
    effectiveOpenPolicyHash:e0_fixture_hash,safeOffAdmissionHash:e0_fixture_hash,
    allowListHash:e0_fixture_hash,
    featureLaunchStateHash:(if $stage == "PRE_MUTATION" then null else e0_fixture_hash end),
    launchCatalog:(if $stage == "PRE_MUTATION"
      then {status:"NOT_MATERIALIZED",materialized:0,expectedAfterMigration:20,unexpected:0}
      else {status:"MATERIALIZED",materialized:20,expectedAfterMigration:20,unexpected:0} end),
    whtMaterialization:{
      status:(if $stage == "PRE_MUTATION" then "NOT_MATERIALIZED" else "MATERIALIZED" end),
      actualCounts:(if $stage == "PRE_MUTATION" then null else {total:3,open:0,closed:3} end),
      actualRoutes:(if $stage == "PRE_MUTATION" then [] else e0_wht_routes end),
      reviewedExpectedCounts:{total:3,open:0,closed:3},reviewedExpectedRoutes:e0_wht_routes
    }
  },
  normalization:(if $stage == "PRE_MUTATION"
    then {status:"NOT_MATERIALIZED",incomplete:null,drift:null,unexpectedOrigin:null}
    else {status:"MATERIALIZED",incomplete:0,drift:0,unexpectedOrigin:0} end),
  baselineRefs:{
    preMutationRef:(if $stage == "PRE_MUTATION" then null else e0_fixture_ref("PRODUCTION_A5_EVIDENCE_V1") end),
    postMigrationRef:(if $stage == "POST_DEPLOYMENT" then e0_fixture_ref("PRODUCTION_A5_EVIDENCE_V1") else null end)
  },
  comparisons:e0_fixture_comparisons($stage),passed:true
};

def e0_fixture_clone_payload($source): {
  targetEnvironment:"production-isolated-clone",
  isolationBoundary:{productionSourceReadOnly:true,noProductionWriterCredential:true,
    isolatedNetwork:true,publiclyAccessible:false,cloneDestroyed:true},
  cloneInfrastructure:{
    sourceDbInstanceArn:"arn:aws:rds:ap-southeast-1:311414082667:db:watchdog-bms-production",
    sourceDbIdentifier:"watchdog-bms-production",
    snapshotArn:"arn:aws:rds:ap-southeast-1:311414082667:snapshot:rds:fixture",
    snapshotCreatedAtEpoch:1699999900,snapshotType:"automated",
    temporaryDbInstanceArn:("arn:aws:rds:ap-southeast-1:311414082667:db:watchdog-a5-clone-7001-a1-" + $source[0:8]),
    temporaryDbIdentifier:("watchdog-a5-clone-7001-a1-" + $source[0:8]),
    requiredRunTags:[
      {key:"parentRunAttempt",value:"1"},{key:"parentRunId",value:"8001"},
      {key:"producerRunAttempt",value:"1"},{key:"producerRunId",value:"7001"},
      {key:"purpose",value:"production-a5-clone"},{key:"sourceCommit",value:$source}
    ],engine:"postgres",engineVersion:"18.1",storageEncrypted:true,
    kmsKeyArn:"arn:aws:kms:ap-southeast-1:311414082667:key/00000000-0000-0000-0000-000000000000",
    publiclyAccessible:false,dbSubnetGroupName:"watchdog-private",
    dbSubnetIds:["subnet-00000000","subnet-00000001"],dbSecurityGroupIds:["sg-00000000"],
    migrationTaskSubnetIds:["subnet-00000002"],migrationTaskSecurityGroupIds:["sg-00000001"],
    dbSecurityGroupIngress:[{ipProtocol:"tcp",fromPort:5432,toPort:5432,
      sourceSecurityGroupId:"sg-00000001"}],
    migrationTaskArn:"arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/fixture",
    migrationTaskDefinitionArn:"arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-a5-clone:1",
    migrationImage:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/"
      + "watchdog-bms-migration-tool@sha256:"+e0_fixture_hash),
    migrationSourceCommit:$source,
    migrationExecutionRoleArn:"arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone-execution",
    migrationTaskRoleArn:null,
    temporaryDatabaseSecretArn:("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"
      + "rds!db-00000000-0000-0000-0000-000000000000-AbCdEf"),
    temporaryDatabaseSecretVersionId:"00000000-0000-0000-0000-000000000001",
    networkBoundary:e0_fixture_endpoint_boundary("sg-00000001";"sg-00000002";
      ["subnet-00000002","subnet-00000003"]),
    networkEvidence:{
      describeDbInstances:{sha256:e0_fixture_hash,raw:{DBInstances:[{
        DBInstanceArn:("arn:aws:rds:ap-southeast-1:311414082667:db:watchdog-a5-clone-7001-a1-"
          + $source[0:8]),PubliclyAccessible:false,
        DBSubnetGroup:{Subnets:[{SubnetIdentifier:"subnet-00000000"},
          {SubnetIdentifier:"subnet-00000001"}]},
        VpcSecurityGroups:[{VpcSecurityGroupId:"sg-00000000"}]
      }]}},
      describeNetworkInterfaces:{sha256:e0_fixture_hash,raw:{NetworkInterfaces:[{
        NetworkInterfaceId:"eni-00000000",SubnetId:"subnet-00000002",
        Groups:[{GroupId:"sg-00000001"}]
      }]}},
      describeSecret:{sha256:e0_fixture_hash,raw:{
        ARN:("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"
          + "rds!db-00000000-0000-0000-0000-000000000000-AbCdEf"),
        Name:"rds!db-00000000-0000-0000-0000-000000000000",
        VersionIdsToStages:{"00000000-0000-0000-0000-000000000001":["AWSCURRENT"]}
      }},
      describeSubnets:{sha256:e0_fixture_hash,raw:{Subnets:[
        {SubnetId:"subnet-00000000",MapPublicIpOnLaunch:false},
        {SubnetId:"subnet-00000001",MapPublicIpOnLaunch:false},
        {SubnetId:"subnet-00000002",MapPublicIpOnLaunch:false}]}},
      describeEndpointSecurityGroup:{sha256:e0_fixture_hash,raw:{SecurityGroups:[{
        GroupId:"sg-00000003",IpPermissions:[{IpProtocol:"tcp",FromPort:443,ToPort:443,
          IpRanges:[],Ipv6Ranges:[],PrefixListIds:[],UserIdGroupPairs:[
            {GroupId:"sg-00000001"},{GroupId:"sg-00000002"}]}],IpPermissionsEgress:[]}]}},
      describeVpcEndpoints:{sha256:e0_fixture_hash,raw:{VpcEndpoints:[]}},
      describeRouteTables:{sha256:e0_fixture_hash,raw:{RouteTables:[]}},
      describeSecurityGroups:{sha256:e0_fixture_hash,raw:{SecurityGroups:[
        {GroupId:"sg-00000000",IpPermissions:[{IpProtocol:"tcp",FromPort:5432,ToPort:5432,
          IpRanges:[],Ipv6Ranges:[],PrefixListIds:[],UserIdGroupPairs:[{GroupId:"sg-00000001"}]}],
          IpPermissionsEgress:[]},
        {GroupId:"sg-00000001",IpPermissions:[],IpPermissionsEgress:[
          {IpProtocol:"tcp",FromPort:443,ToPort:443,IpRanges:[],Ipv6Ranges:[],
            PrefixListIds:[{PrefixListId:"pl-00000000"}],UserIdGroupPairs:[]},
          {IpProtocol:"tcp",FromPort:443,ToPort:443,IpRanges:[],Ipv6Ranges:[],
            PrefixListIds:[],UserIdGroupPairs:[{GroupId:"sg-00000003"}]},
          {IpProtocol:"tcp",FromPort:5432,ToPort:5432,IpRanges:[],Ipv6Ranges:[],
            PrefixListIds:[],UserIdGroupPairs:[{GroupId:"sg-00000000"}]}
        ]}
      ]}},
      describeTasks:{sha256:e0_fixture_hash,raw:{tasks:[{
        taskArn:"arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/fixture",
        taskDefinitionArn:"arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-a5-clone:1"
      }]}},
      describeTaskDefinition:{sha256:e0_fixture_hash,raw:{taskDefinition:{
        taskDefinitionArn:"arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-a5-clone:1",
        executionRoleArn:"arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone-execution",
        taskRoleArn:null,networkMode:"awsvpc",containerDefinitions:[{
          image:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/"
            + "watchdog-bms-migration-tool@sha256:"+e0_fixture_hash),
          secrets:[
            {name:"PGDATABASE",valueFrom:("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"
              + "rds!db-00000000-0000-0000-0000-000000000000-AbCdEf:dbname::"
              + "00000000-0000-0000-0000-000000000001")},
            {name:"PGHOST",valueFrom:("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"
              + "rds!db-00000000-0000-0000-0000-000000000000-AbCdEf:host::"
              + "00000000-0000-0000-0000-000000000001")},
            {name:"PGPASSWORD",valueFrom:("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"
              + "rds!db-00000000-0000-0000-0000-000000000000-AbCdEf:password::"
              + "00000000-0000-0000-0000-000000000001")},
            {name:"PGUSER",valueFrom:("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"
              + "rds!db-00000000-0000-0000-0000-000000000000-AbCdEf:username::"
              + "00000000-0000-0000-0000-000000000001")}
          ]
        }]
      }}},
      endpointBoundary:e0_fixture_endpoint_boundary("sg-00000001";"sg-00000002";
        ["subnet-00000002","subnet-00000003"])
    },
    cleanup:{deleteRequestedAtEpoch:1699999950,deleteCompletedAtEpoch:1699999990,instanceAbsent:true,
      secretDeleted:true,taskStopped:true,residualResourceCount:0}
  },
  sourceDatabaseFingerprint:e0_fixture_hash,sourceAppliedMigrations:e0_fixture_applied_migrations,
  sourceAppliedMigrationsHash:e0_fixture_hash,candidateMigrationSetHash:e0_fixture_hash,
  reviewedMigrationOperationsHash:e0_fixture_hash,expectedSchemaDeltaHash:e0_fixture_hash,
  expectedDataTransformHash:e0_fixture_hash,preflightCatalogHash:e0_fixture_hash,
  lockBudgetPolicyHash:e0_fixture_hash,expectedSeededRouteHash:e0_fixture_hash,
  expectedClosedWhtRouteHash:e0_fixture_hash,reviewedManifest:e0_fixture_reviewed_manifest,
  migrationTool:e0_fixture_migration_tool($source),
  reimbursementCompatibility:e0_fixture_reimbursement_compatibility,
  cloneRehearsal:e0_fixture_clone_rehearsal,passed:true
};

def e0_fixture_h3_service($service; $source):
  (if $service == "api-web" then "watchdog-bms-api"
    elif $service == "ai-gateway" then "watchdog-bms-ai-gateway" else "watchdog-bms-workers" end) as $repo
  | {service:$service,repository:$repo,
    image:("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/" + $repo + "@sha256:" + e0_fixture_hash),
    digest:("sha256:" + e0_fixture_hash),sourceCommit:$source,
    sbomFile:("sbom-" + $service + ".spdx.json"),sbomSha256:e0_fixture_hash,
    sbomSpdxVersion:"SPDX-2.3",ciSignatureFile:("cosign-" + $service + ".json"),
    ciSignatureFileSha256:e0_fixture_hash,
    ciSignerIdentity:"https://github.com/example/repo/.github/workflows/ci.yml@refs/heads/main",
    ciIssuer:"https://token.actions.githubusercontent.com",ciSignedDigest:("sha256:" + e0_fixture_hash),
    liveSignerIdentity:"https://github.com/example/repo/.github/workflows/ci.yml@refs/heads/main",
    liveIssuer:"https://token.actions.githubusercontent.com",liveSignedDigest:("sha256:" + e0_fixture_hash),
    liveSignatureOutputSha256:e0_fixture_hash,ociRevision:$source,
    scanRequestedDigest:("sha256:" + e0_fixture_hash),scanResolvedDigest:("sha256:" + e0_fixture_hash),
    scanStatus:"COMPLETE",scanProviderStatus:"COMPLETE",
    scanProviderDescription:"The scan was completed successfully.",scanEnhancedFindingsArray:false,
    scanSeverityCounts:{},critical:0,high:0,imagePushedAtEpoch:1000,scanCompletedAtEpoch:1001};

def e0_fixture_h3_runtime($source):
  (e0_fixture_h3_service("api-web";$source)) as $api
  | {schemaVersion:1,provider:"AWS",observedAtEpoch:1699999900,
    rds:{instanceIdentifier:"watchdog-bms-production",
      instanceArn:"arn:aws:rds:ap-southeast-1:311414082667:db:watchdog-bms-production",
      status:"available",storageEncrypted:true,multiAZ:true,deletionProtection:true,
      backupRetentionDays:35,rawSha256:e0_fixture_hash},
    redis:{replicationGroupId:"watchdog-bms-production",
      replicationGroupArn:("arn:aws:elasticache:ap-southeast-1:311414082667:replicationgroup:"
        + "watchdog-bms-production"),status:"available",engine:"redis",
      atRestEncryptionEnabled:true,transitEncryptionEnabled:true,authTokenEnabled:true,
      automaticFailover:"enabled",nodeCount:2,primaryClusterId:"watchdog-bms-production-001",
      snapshotRetentionDays:35,rawReplicationGroupSha256:e0_fixture_hash,
      rawPrimaryClusterSha256:e0_fixture_hash},
    alerting:{topicArn:"arn:aws:sns:ap-southeast-1:311414082667:watchdog-security-alerts",
      ownerAccount:"311414082667",topicRawSha256:e0_fixture_hash,
      actionableAlarmNames:["watchdog-bms-production-security"],alarmsRawSha256:e0_fixture_hash,
      confirmedHumanSubscriptions:[{
        subscriptionArn:("arn:aws:sns:ap-southeast-1:311414082667:watchdog-security-alerts:"
          + "00000000-0000-0000-0000-000000000000"),protocol:"email",
        endpointSha256:e0_fixture_hash}],subscriptionsRawSha256:e0_fixture_hash,
      deliveredNotificationCount:1,deliveryMetricRawSha256:e0_fixture_hash,
      acknowledgement:{schemaVersion:1,
        topicArn:"arn:aws:sns:ap-southeast-1:311414082667:watchdog-security-alerts",
        subscriptionArn:("arn:aws:sns:ap-southeast-1:311414082667:watchdog-security-alerts:"
          + "00000000-0000-0000-0000-000000000000"),endpointSha256:e0_fixture_hash,
        probePublishedAtEpoch:1699999700,acknowledgedAtEpoch:1699999800,
        acknowledgedBy:"fixture-owner",recipientAcknowledged:true,
        syntheticMessageIdSha256:e0_fixture_hash,deliveryEvidenceSha256:e0_fixture_hash,
        ackFileSha256:e0_fixture_hash}},
    logMonitoring:{prefix:"/ecs/watchdog-bms-prod-",groups:[{
      name:"/ecs/watchdog-bms-prod-api",retentionDays:90,
      kmsKeyArn:"arn:aws:kms:ap-southeast-1:311414082667:key/00000000-0000-0000-0000-000000000000",
      metricFilterCount:1,rawLogGroupSha256:e0_fixture_hash,
      rawMetricFiltersSha256:e0_fixture_hash}]},
    clamavCandidate:{provider:"COLOCATED_CLAMAV",candidateSource:"UAT_ACCEPTED_API_IMAGE",
      sourceCommit:$source,apiImage:$api.image,apiDigest:$api.digest,
      scannerHost:"127.0.0.1",scannerPort:3310,scannerVersion:"ClamAV 1.5.3/fixture",
      cleanVerdict:"CLEAN",eicarVerdict:"MALWARE_DETECTED",testScriptSha256:e0_fixture_hash,
      outputSha256:e0_fixture_hash,checkedAtEpoch:1699999800}};

def e0_fixture_h3($source):
  (e0_fixture_ref("UAT_DEPLOYMENT_ACCEPTANCE")) as $uat
  | (["ai-gateway","api-web","workers"] | map(e0_fixture_h3_service(.;$source))) as $raw_services
  | ({
      controllerTrust:{sourceCommit:$source,producerControllerCommit:e0_fixture_sha,
        parentControllerCommit:e0_fixture_sha,ciWorkflowBlob:e0_fixture_sha,
        uatDeployWorkflowBlob:e0_fixture_sha,productionDeployWorkflowBlob:e0_fixture_sha,
        securityPreflightWorkflowBlob:e0_fixture_sha,
        validators:(e0_h3_validator_paths | map({path:.,sha256:e0_fixture_hash}))},
      artifactIntegrity:{sourceCommit:$source,uatAcceptanceContentSha256:$uat.contentSha256,
        uatAcceptanceFileSha256:e0_fixture_hash,releaseManifestSha256:e0_fixture_hash,
        healthVerified:true,releaseFinalized:true,
        releaseFiles:(e0_h3_release_files | map({name:.,sha256:e0_fixture_hash})),services:$raw_services},
      migrationReview:{productionA5PreMutationRef:e0_fixture_ref("PRODUCTION_A5_EVIDENCE_V1"),
        productionA5CloneRef:e0_fixture_ref("PRODUCTION_A5_CLONE_REHEARSAL_V1"),
        migrationTool:e0_fixture_migration_tool($source),
        migrationToolVerification:e0_fixture_h3_migration_tool_verification($source),
        productionA5PreMutationPayload:e0_fixture_h2("PRE_MUTATION";$source)},
      rollbackRecovery:{mode:"NON_MUTATING_REHEARSAL",acceptanceHealthVerified:true,
        acceptanceReleaseFinalized:true,commandListSha256:e0_fixture_hash,
        commands:[
          {command:"bash infra/prod-ecs-express/release-safety.spec.sh",exitCode:0,outputSha256:e0_fixture_hash},
          {command:"bash infra/prod-ecs-express/rollout-waves.spec.sh",exitCode:0,outputSha256:e0_fixture_hash}
        ],combinedOutputSha256:e0_fixture_hash,
        protectedMainBlobs:[
          {path:".github/workflows/deploy-production.yml",blob:e0_fixture_sha},
          {path:".github/workflows/recover-release-intent.yml",blob:e0_fixture_sha},
          {path:"infra/prod-ecs-express/deploy.sh",blob:e0_fixture_sha},
          {path:"infra/prod-ecs-express/release-safety.spec.sh",blob:e0_fixture_sha},
          {path:"infra/prod-ecs-express/rollout-waves.spec.sh",blob:e0_fixture_sha}
        ]},
      protectedMainPolicy:{httpStatus:200,strictRequiredChecks:true,
        requiredStatusContexts:["AI Gateway Tests","API Tests","Build","Security","Web Tests","Workers Tests"],
        enforceAdmins:true,requiredPullRequestApprovals:1,dismissStaleReviews:true,
        requireLastPushApproval:true,forcePushAllowed:false,deletionAllowed:false},
      productionEnvironmentPolicy:{environmentHttpStatus:200,branchPoliciesHttpStatus:200,
        deploymentBranchPolicy:{protectedBranches:false,customBranchPolicies:true},
        branchPolicies:[{name:"main",type:"branch"}],requiredReviewerRules:[],
        nativeReviewerRule:"NOT_CONFIGURED",nativeRequiredReviewerCount:0,
        nativeSelfReviewPrevented:null,lastConfigurationHttpStatus:null},
      runtimeSecurityBaseline:e0_fixture_h3_runtime($source),
      awsIdentityBoundary:{
        expectedRoleArn:"arn:aws:iam::311414082667:role/watchdog-bms-production-security-readonly",
        callerAccount:"311414082667",
        callerArn:"arn:aws:sts::311414082667:assumed-role/watchdog-bms-production-security-readonly/fixture",
        callerUserId:"fixture:fixture",roleArn:"arn:aws:iam::311414082667:role/watchdog-bms-production-security-readonly",
        roleName:"watchdog-bms-production-security-readonly",inlinePolicyName:"watchdog-bms-production-security-readonly",
        trustTemplateSha256:e0_fixture_hash,observedTrustPolicySha256:e0_fixture_hash,
        inlinePolicyTemplateSha256:e0_fixture_hash,observedInlinePolicySha256:e0_fixture_hash,
        trustPolicy:{Version:"2012-10-17",Statement:[{Sid:"GitHubProductionSecurityPreflight",Effect:"Allow",
          Principal:{Federated:"arn:aws:iam::311414082667:oidc-provider/token.actions.githubusercontent.com"},
          Action:"sts:AssumeRoleWithWebIdentity",Condition:{StringEquals:{
            "token.actions.githubusercontent.com:aud":"sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub":"repo:example/repo:environment:production"}}}]},
        inlinePolicy:e0_h3_inline_policy}
    }) as $verification
  | {
      uatAcceptanceRef:$uat,releaseManifestSha256:e0_fixture_hash,
      candidateMigrationSetHash:e0_fixture_hash,reviewedMigrationOperationsHash:e0_fixture_hash,
      expectedSchemaDeltaHash:e0_fixture_hash,expectedDataTransformHash:e0_fixture_hash,
      preflightCatalogHash:e0_fixture_hash,lockBudgetPolicyHash:e0_fixture_hash,
      expectedSeededRouteHash:e0_fixture_hash,expectedClosedWhtRouteHash:e0_fixture_hash,
      services:($raw_services | map({service,image,digest,ociRevision,ciSignatureVerified:true,
        ciSignerIdentity:.liveSignerIdentity,sbomSha256,scanStatus,critical,high})),
      checks:{
        controllerTrust:{status:"PASS",ciWorkflowBlob:e0_fixture_sha,uatDeployWorkflowBlob:e0_fixture_sha,
          productionDeployWorkflowBlob:e0_fixture_sha,validatorSetHash:e0_fixture_hash,evidenceSha256:e0_fixture_hash},
        artifactIntegrity:{status:"PASS",evidenceSha256:e0_fixture_hash},
        migrationReview:{status:"PASS",candidateCount:1,additiveCount:1,
          backwardCompatibleNonadditiveCount:0,dataBackfillCount:0,blockingContractCount:0,
          destructiveCustomerDataLossCount:0,manualCustomerInputCount:0,unreviewedCount:0,
          allPreconditionsPass:true,productionCloneRehearsalPass:true,boundedTimeoutPolicyVerified:true,
          legacyExpectedAbsentProfileVerified:true,evidenceSha256:e0_fixture_hash},
        rollbackRecovery:{status:"PASS",evidenceSha256:e0_fixture_hash},
        protectedMainPolicy:{status:"PASS",strictRequiredChecks:true,requiredStatusContextCount:6,
          requiredStatusContextsHash:e0_fixture_hash,enforceAdmins:true,requiredPullRequestApprovals:1,
          dismissStaleReviews:true,requireLastPushApproval:true,forcePushAllowed:false,
          deletionAllowed:false,evidenceSha256:e0_fixture_hash},
        productionEnvironmentPolicy:{status:"PASS",mainOnly:true,nativeReviewerRule:"NOT_CONFIGURED",
          nativeRequiredReviewerCount:0,nativeSelfReviewPrevented:null,lastConfigurationHttpStatus:null,
          evidenceSha256:e0_fixture_hash},
        runtimeSecurityBaseline:{status:"PASS",evidenceSha256:e0_fixture_hash},
        awsIdentityBoundary:{status:"PASS",evidenceSha256:e0_fixture_hash}
      },verificationEvidence:$verification,passed:true
    };

def e0_fixture_wht: {total:3,open:0,closed:3,routeHash:e0_fixture_hash,routes:e0_wht_route_names};
def e0_fixture_h4($stage; $source): {
  stage:$stage,deploymentClass:"PRODUCTION_SHADOW_ONLY",
  uatAcceptanceRef:e0_fixture_ref("UAT_DEPLOYMENT_ACCEPTANCE"),
  securityPreflightRef:e0_fixture_ref("PRODUCTION_SECURITY_PREFLIGHT_V1"),
  ownerApprovalRef:(if $stage == "POST_DEPLOYMENT" then e0_fixture_ref("OWNER_U5E_APPROVAL_V1") else null end),
  productionA5:{preMutationRef:e0_fixture_ref("PRODUCTION_A5_EVIDENCE_V1"),
    cloneRehearsalRef:e0_fixture_ref("PRODUCTION_A5_CLONE_REHEARSAL_V1"),
    migrationTool:e0_fixture_migration_tool($source),
    postMigrationRef:(if $stage == "POST_DEPLOYMENT" then e0_fixture_ref("PRODUCTION_A5_EVIDENCE_V1") else null end),
    postDeploymentRef:(if $stage == "POST_DEPLOYMENT" then e0_fixture_ref("PRODUCTION_A5_EVIDENCE_V1") else null end)},
  u5Capacity:{status:"PENDING",resultRef:null,restriction:"NO_BATCH_OR_ENFORCEMENT"},
  wht:{status:(if $stage == "PRE_AUTHORIZATION" then "PLANNED_CLOSED_MATERIALIZATION" else "MATERIALIZED_CLOSED" end),
    reviewedExpectedAfterMigration:e0_fixture_wht,
    actual:(if $stage == "POST_DEPLOYMENT" then e0_fixture_wht else null end)},
  enforcement:{
    baseline:{preexistingEntitlementStateHash:e0_fixture_hash,
      preexistingAuthorityStateHash:e0_fixture_hash,effectiveOpenPolicyHash:e0_fixture_hash},
    reviewedMigrationMaterialization:{candidateMigrationSetHash:e0_fixture_hash,
      reviewedMigrationOperationsHash:e0_fixture_hash,expectedSchemaDeltaHash:e0_fixture_hash,
      expectedDataTransformHash:e0_fixture_hash,preflightCatalogHash:e0_fixture_hash,
      lockBudgetPolicyHash:e0_fixture_hash,expectedSeededRouteHash:e0_fixture_hash,
      expectedClosedWhtRouteHash:e0_fixture_hash},
    requestedEntitlementTransitions:[],requestedLaunchGateTransitions:[],requestedSafeOffAdmissions:[],
    requestedAllowListChanges:[],result:(if $stage == "PRE_AUTHORIZATION"
      then "PLANNED_CLOSED_REVIEWED_MATERIALIZATION" else "UNCHANGED" end)
  },
  humanEvidence:{claimed:false,usabilityReports:[],specialistApprovals:[],
    restriction:"NOT_GA_OR_WHT_OPEN_AUTHORITY"},
  pending:["U5_CAPACITY_RESULT"],shadowOnlyReady:true
};

def e0_fixture_h5($source): {
  approvalScope:"PRODUCTION_SHADOW_ONLY",
  approver:{authority:"GITHUB_REPOSITORY_OWNER",login:"MangmeeDev"},
  preAggregateRef:e0_fixture_ref("U5_SHADOW_AGGREGATE_V1"),
  uatAcceptanceRef:e0_fixture_ref("UAT_DEPLOYMENT_ACCEPTANCE"),
  productionA5PreMutationRef:e0_fixture_ref("PRODUCTION_A5_EVIDENCE_V1"),
  productionA5CloneRef:e0_fixture_ref("PRODUCTION_A5_CLONE_REHEARSAL_V1"),
  securityPreflightRef:e0_fixture_ref("PRODUCTION_SECURITY_PREFLIGHT_V1"),
  candidateMigrationSetHash:e0_fixture_hash,reviewedMigrationOperationsHash:e0_fixture_hash,
  expectedSchemaDeltaHash:e0_fixture_hash,expectedDataTransformHash:e0_fixture_hash,
  preflightCatalogHash:e0_fixture_hash,lockBudgetPolicyHash:e0_fixture_hash,
  expectedSeededRouteHash:e0_fixture_hash,expectedClosedWhtRouteHash:e0_fixture_hash,
  migrationTool:e0_fixture_migration_tool($source),
  maintenanceWindow:{windowId:"u5e-8001-a1-7001-a1",startsAtEpochMs:1700000000000,
    endsAtEpochMs:1700001800000,
    failurePolicy:"LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL"},
  authorizedActions:{applyExactReviewedMigrationSet:true,
    materializeExactReviewedClosedFeatureLaunchObjects:true,deployExactAcceptedImages:true,
    entitlementTransitions:[],launchGateTransitions:[],safeOffAdmissions:[],allowListChanges:[]}
};

def e0_fixture_payload($kind; $stage; $source):
  if $kind == "PRODUCTION_A5_EVIDENCE_V1" then e0_fixture_h2($stage; $source)
  elif $kind == "PRODUCTION_A5_CLONE_REHEARSAL_V1" then e0_fixture_clone_payload($source)
  elif $kind == "PRODUCTION_SECURITY_PREFLIGHT_V1" then e0_fixture_h3($source)
  elif $kind == "U5_SHADOW_AGGREGATE_V1" then e0_fixture_h4($stage; $source)
  elif $kind == "OWNER_U5E_APPROVAL_V1" then e0_fixture_h5($source)
  else error("unknown fixture kind") end;
