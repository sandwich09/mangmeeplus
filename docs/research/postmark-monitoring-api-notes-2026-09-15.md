# Postmark monitoring reference — 2026-09-15

Checked official [Server API](https://postmarkapp.com/developer/api/server-api), [Message Streams API](https://postmarkapp.com/developer/api/message-streams-api) and [Stats API](https://postmarkapp.com/developer/api/stats-api). This is preparation for the remaining mail monitoring implementation, not provider acceptance.

GET /server uses the Server Token and returns ID and DeliveryType (Live/Sandbox). Its response also contains ApiTokens and other private fields: project an explicit safe DTO before returning/persisting/auditing anything. Missing DeliveryType must remain unknown in an observation; the documented create default does not prove an existing server's mode. Do not use billing Stripe mode to classify an email server.

GET /message-streams/{stream_ID} returns exact ID/ServerID/MessageStreamType/ArchivedAt. Validate the configured server and Transactional stream; no caller-supplied server ID, URL or credentials. ExpectedPurgeDate concerns deletion of an archived stream, not message content retention. These APIs do not establish a company's actual content retention or monthly purchased sending allowance; do not invent these values from the45-day stream archive rule or the number of local attempts.

Local operational counts come from durable EmailSendAttempt and sanitized Postmark outbox facts, scoped to the configured server/stream. Count attempts separately from unique intents and preserve accepted vs receiving-server delivery. Dates/coverage must be explicit; absent callback does not prove webhook pause or inbox failure. A mode/configuration check is read-only and is not send readiness or a live inbox receipt.

No native account access, provider mutation, message delivery or deployment was performed during this reference check.
