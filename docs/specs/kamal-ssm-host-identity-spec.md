# Kamal SSM Host Identity Spec

Status: implemented; UAT host reconciliation passed, application rollout pending after pre-mutation build timeout, 2026-09-22
Owner: Platform / release owner

## Goal

The root project must retain a dependable release path to both UAT and Production without depending on a workstation CIDR, a host public IPv4 address, or a manual target edit after an ordinary EC2 stop/start.

## Rules

1. A target using `sshTransport: "ssm"` identifies each enrolled host by its existing `instanceId`, VPC, CloudFormation stack, **primary private IPv4 address**, and pinned `ssh-ed25519` host key. Its `address` must equal the EC2 `PrivateIpAddress`; a public address is invalid for this transport.
2. Direct SSH retains the existing reachable-address check. This change never enables public SSH or adds an ingress rule.
3. A release never learns or accepts a new host key. A changed key fails preflight before a remote lock, build publication, database work, rollout, or customer-access change.
4. A separate root-project reconciliation command may update only the private `address` and host key of the already enrolled instance IDs. It starts SSM tunnels only to those IDs, checks EC2/VPC/stack/running/IMDS identity, and records a private receipt.
5. A host-key change requires both `--accept-host-key-rotation` and a non-empty reason. Address-only reconciliation is allowed only when the observed key still matches. Reconciliation may not replace an instance ID, stack, VPC, environment, or target kind.
6. UAT and Production use the same controller and reconciliation rules but retain separate private targets, IAM profiles, KMS keys, endpoints, source paths, acceptance, and deployment commands. This work does not deploy Production or relax its acceptance protocol.
7. Every bounded local controller command runs in its own process group. If it times out, the controller terminates that group before returning a failure, so a timed-out build cannot leave child compilers or Docker builds running while a later operation begins.

## Acceptance

- SSM preflight accepts an enrolled private address and rejects an enrolled public address even if it currently resolves to the same instance.
- The reconciler fails closed for a wrong EC2 identity, a missing/changed host key without explicit approval, an empty reason, an active deployment, or an unproved SSM cleanup.
- With explicit approved rotation, it writes only the existing target's private addresses/keys and an auditable private receipt; it does not deploy or mutate AWS application infrastructure.
- Controller and reconciliation tests cover UAT and Production-shaped targets.
- A local-command timeout proves its build process group has been terminated; a later UAT apply may reuse only a separately completed, exact-SHA `--prepared-build` artifact.
