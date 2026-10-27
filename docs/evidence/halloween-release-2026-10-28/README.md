# Halloween release evidence — 2026-10-28

Production and UAT serve `9a3deb73104eb9ffabf8f6f72916229801280657`. The final accepted summaries are
`uat-share-accepted-summary.json` and `production-accepted-summary.json`. Older summaries and initial
failure evidence are retained as history; they are not the final promotion input.

- `production-alarm-owner-exception.json` and both alarm readbacks document the explicit scoped exception; no alarm was changed. Those exact bytes are included in signed browser evidence.
- `prod-result-390.png` and `prod-result-1280.png` show actual Production results at measured viewport widths without sideways overflow. Browser screenshot payloads are JPEG despite their retained `.png` filenames; keep these exact signed bytes.
- `prod-loading-390.png` shows the mobile loading wording. `prod-share-caption.txt` is actual clipboard text. `prod-saved-card.json` verifies the real download is the exact approved image with origin metadata.
- Desktop native share/cancel and mobile engine coverage are in the earlier share/ghost-reveal evidence. No social post or physical iPhone/Android app acceptance is claimed.
- Full administrator observations and signature files remain in the private operation directory. Login200, me200, gate200/live/canOpen/OPEN, public OPEN/login marker and postlogout401 were observed in the browser; actual logout204 was corroborated from scoped read-only current-container request logs. The BFF logout Network row was not retained. No password or cookie values are in committed evidence.

The signed Production receipt hash and all18evidence hashes were independently checked; all four
image IDs and AgentCore archive match the signed UAT bundle. Signature, customer acceptance,
readiness and cleanup passed. See the [release memory](../../agent-memory/halloween-release-2026-10-28.md)
for exact operation IDs, durations, decisions and remaining limits.
