# UAT SSM transport and sub-10-minute release plan

Status: COMPLETE; MERGED TO DEVELOP/MAIN AND MAIN-TREE PREFLIGHT PASSED

## Goal

UAT deployment must not depend on a changing workstation IP or public TCP/22, and the live apply
command must normally finish within 600 seconds without weakening exact-source, configuration,
migration, readiness, customer-OPEN, retirement, or KMS-signature gates.

## Smallest correct change

1. Enroll the two UAT EC2 hosts in Systems Manager with the AWS-managed core instance policy.
2. Give only the UAT deploy role permission to inventory those hosts and open/own port-forwarding
   sessions; remove CloudFormation-managed public SSH ingress.
3. Have the existing release controller open local SSM port forwards and feed host-specific
   `ProxyCommand` entries to both direct SSH checks and the pinned Kamal container.
4. Permit UAT main to reuse an exact-SHA prepared build through the existing source-tree, image,
   architecture, label, phase-log, and AgentCore archive verification. Cap an unprepared UAT build
   at 240 seconds and stop before mutation when the first 360 seconds are exhausted.
5. Record the 600-second target in the signed UAT acceptance artifact.
6. Fail before publication when the exact candidate cannot fit with bounded Docker headroom, retry
   only transient read-only provider checks, and fail the command unless SSM cleanup is proved after
   the final remote-lock operation.

## Acceptance

- Both UAT hosts report `Online` in Systems Manager.
- Read-only UAT preflight passes with `sshTransport: ssm` while no operator `/32` TCP/22 rule exists.
- Every controller-owned Systems Manager session is explicitly terminated during cleanup.
- The change set has no EC2 replacement and changes only the two runtime roles, deploy role, and two
  security groups.
- Focused controller tests and repository CI pass.
- The success path, every phase failure, rollback, exact prepared-build identity, low-disk refusal,
  provider retry boundary, SSM cleanup failures, and 360/600-second boundaries pass in the isolated
  controller rehearsal without customer data or cloud mutation.
- A later deploy receipt records whether the 600-second target was met; no safety gate is skipped.
