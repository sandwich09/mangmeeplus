# Production security alert rules

Two EventBridge rules publish to `watchdog-bms-production-security-alerts`. Both were created on
2026-08-09 and are recorded here so they can be rebuilt or reviewed without reading the console.

They answer two different questions:

| rule | question it answers |
| --- | --- |
| `watchdog-bms-production-bastion-session-opened` | did anyone open a shell into production? |
| `watchdog-bms-production-bastion-sg-changed` | did anyone open a *path* into production? |

The second is the more serious of the two. The bastion is designed to have **zero inbound rules** —
entry is via SSM only, gated by IAM. An inbound rule added to that security group is a way in that
bypasses the whole design, so the alert is worded as CRITICAL and asks the reader to revoke first
and ask later.

## Prerequisite: a CloudTrail trail must exist

EventBridge does **not** receive `AWS API Call via CloudTrail` events unless a trail is logging
management events. This was verified the hard way: with both rules ENABLED, correct patterns, and a
real `StartSession` performed, `AWS/Events Invocations` had **no datapoints at all** — the rules
were never invoked. The account had no trail.

`watchdog-bms-production` (multi-region, management events, log file validation on) now delivers to
`s3://watchdog-bms-cloudtrail-311414082667`, which blocks public access, encrypts with AES256,
versions objects, denies non-TLS access, and expires objects after 400 days.

The first trail copying management events is free; only S3 storage is billed, which for this
account is cents per month.

After creating a trail, allow up to ~15 minutes before the first events reach EventBridge. A rule
that has not fired yet is not evidence that the pattern is wrong.

## Verifying a pattern without waiting

`aws cloudtrail lookup-events` reads the 90-day Event History and needs no trail, so the real event
shape can be checked directly:

```bash
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=StartSession \
  --max-results 1 --query 'Events[0].CloudTrailEvent' --output text | python3 -m json.tool
```

`aws events test-event-pattern` then confirms the pattern matches that shape — and, just as
importantly, that a near-miss does **not** match. Both were checked, including a negative case with
a different security group id.

## Rule 1 — session opened

```json
{
  "source": ["aws.ssm"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["ssm.amazonaws.com"],
    "eventName": ["StartSession", "ResumeSession"],
    "requestParameters": { "target": ["i-0f3b3881690dcf874"] }
  }
}
```

`ResumeSession` is included because reconnecting to an existing session is another way to be at a
production shell. The alert carries the caller ARN, source IP, session id and where to read the
transcript.

## Rule 2 — bastion security group changed

```json
{
  "source": ["aws.ec2"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["ec2.amazonaws.com"],
    "eventName": [
      "AuthorizeSecurityGroupIngress",
      "AuthorizeSecurityGroupEgress",
      "RevokeSecurityGroupIngress",
      "RevokeSecurityGroupEgress",
      "ModifySecurityGroupRules"
    ],
    "requestParameters": { "groupId": ["sg-0e363ecb391c7dd17"] }
  }
}
```

Revokes are included deliberately. An attacker who adds a rule, uses it, and removes it would
otherwise only show up once; and a *removed* egress rule can break the SSM agent, which locks
everyone out of the bastion. Both directions are worth knowing about.

## SNS permission

The topic's default policy grants `SNS:Publish` to `AWS: *` conditioned on `AWS:SourceOwner`. That
covers IAM principals, not the EventBridge service principal, so an explicit statement was added —
scoped by `aws:SourceArn` to exactly these two rule ARNs rather than to EventBridge in general:

```json
{
  "Sid": "AllowEventBridgeSecurityRules",
  "Effect": "Allow",
  "Principal": {"Service": "events.amazonaws.com"},
  "Action": "SNS:Publish",
  "Resource": "arn:aws:sns:ap-southeast-1:<ACCOUNT_ID>:watchdog-bms-production-security-alerts",
  "Condition": {"ArnEquals": {"aws:SourceArn": [
    "arn:aws:events:ap-southeast-1:<ACCOUNT_ID>:rule/watchdog-bms-production-bastion-session-opened",
    "arn:aws:events:ap-southeast-1:<ACCOUNT_ID>:rule/watchdog-bms-production-bastion-sg-changed"
  ]}}
}
```

## Resolved: the stray bastion inbound rule

The bastion security group `sg-0e363ecb391c7dd17` carried one inbound rule where the design calls
for zero:

```
tcp 5432 from sg-0e363ecb391c7dd17   (the group referencing itself)
```

Removed 2026-08-09 (`sgr-0301c3539914cba4f`). Before removing it, the bastion was checked for
anything listening on 5432 — nothing was — confirming it permitted traffic no process could accept.
It most likely arrived alongside the RDS-side rule that genuinely was needed.

The group is now at zero inbound, and SSM access was re-verified afterwards: entry is outbound-only,
so removing inbound rules cannot affect it.

Restore, if it ever turns out to have been load-bearing:

```bash
aws ec2 authorize-security-group-ingress --group-id sg-0e363ecb391c7dd17 \
  --protocol tcp --port 5432 --source-group sg-0e363ecb391c7dd17 --region ap-southeast-1
```

### This doubled as the live test of rule 2

The revoke produced a `RevokeSecurityGroupIngress` event, EventBridge invoked the rule, and SNS
delivered the alert — which is why the rule watches revokes and not only authorizes. Both rules have
now fired against real events rather than test payloads:

| rule | proven by |
| --- | --- |
| `…bastion-session-opened` | a real `StartSession` on the bastion |
| `…bastion-sg-changed` | this `RevokeSecurityGroupIngress` |
