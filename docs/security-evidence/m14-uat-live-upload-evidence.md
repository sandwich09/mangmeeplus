# M-14 UAT live upload, quarantine, audit, and alarm evidence

Date: 2026-07-28

Environment: isolated UAT only (`https://uat.mangmeeplus.com`)

Production: not changed and not promoted

## Release under test

- Source commit: `b3a159380af806cb566c8c871181f2796c5d8004`
- UAT workflow: GitHub Actions run
  [`30377065243`](https://github.com/MangmeeDev/mangmeeplus/actions/runs/30377065243)
- Post-deploy SSM readback: `/watchdog-bms/uat/service-version` = `b3a159380af8`
- Scanner endpoint: co-located ClamAV on `127.0.0.1:3310`
- Isolated test company: `cms4t8phj00051n5qw3atytaj`

No credentials, presigned URLs, object keys, or uploaded bytes are retained in this evidence.

## Live test results

| Case | Attachment | Upload | Completion | Download | Final database state |
| --- | --- | --- | --- | --- | --- |
| Clean PDF | `cms4t8r0o000x1n5qcg7555fa` | intent `201`, S3 PUT `200` | `201` | `200` | `ACTIVE`; version, SHA-256 checksum, and `uploadedAt` present |
| EICAR-in-PDF | `cms4vi4tj000n1e5szdrusi52` | intent `201`, S3 PUT `200` | `400` (`Malware test signature detected.`) | `403` | `QUARANTINED`; no version, checksum, or `uploadedAt` |

The final EICAR completion request ID was
`m14-live-eicar-20260728163133-complete`.

The company audit API returned the correlated event:

- event: `attachment.upload.rejected`
- outcome: `FAILED`
- risk level: `HIGH`
- request ID: `m14-live-eicar-20260728163133-complete`
- created at: `2026-07-28T16:31:35.299Z`

## Database evidence

A short-lived, read-only UAT ECS task queried only the two attachment IDs above and exited `0`:

- task: `21572d4eeb7a45648494e1c9360a70cf`
- clean row: `ACTIVE`, provider version/checksum/upload timestamp all present
- rejected row: `QUARANTINED`, provider version/checksum/upload timestamp all absent

This confirms the rejected bytes were not promoted to an `ACTIVE` attachment.

## Structured log and alarm evidence

`infra/uat/m14-upload-alert.sh verify` found exactly one correlated structured rejection log and
reported:

```json
{
  "event": "m14_alert_evidence",
  "requestId": "m14-live-eicar-20260728163133-complete",
  "rejectionLogs": 1,
  "alarmName": "watchdog-bms-uat-m14-attachment-upload-rejected",
  "alarmState": "ALARM"
}
```

CloudWatch alarm history independently records:

- `2026-07-28T23:32:07+07:00`: `OK` → `ALARM`, one rejected-upload metric datapoint
- `2026-07-28T23:38:07+07:00`: `ALARM` → `OK`, after the non-breaching period

## Residual production gate

The UAT alarm intentionally has no notification action because
`SECURITY_ALERT_TOPIC_ARN` is not configured in UAT. This evidence proves metric ingestion and
alarm state transition, not human notification delivery.

M-14 remains open for production. Production must not be promoted until an owned
`SECURITY_ALERT_TOPIC_ARN` exists, the production alarm routes to it, a synthetic notification is
acknowledged, and the other production prerequisites in
`docs/agent-memory/m14-clamav-provisioning.md` are satisfied.
