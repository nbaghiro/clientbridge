# Messaging fix-now plan

Status: in progress. This plan fixes the "fix now" items from the messaging audit of 2026-10-11. It makes no schema change. The one data change it needs, normalizing stored client phone numbers, is written as a script and waits for explicit approval before it runs. The before-launch and after-launch roadmap from the same audit (a text number per business, delivery status, inbound email, automated messages in threads, consent capture, templates and the rest) is planned separately once these land. Progress and evidence go in [progress.md](progress.md).

## Tasks

- M1. Inbound routing. With one platform number, an inbound text is matched to a client across every business, and the oldest match wins. Until each business has its own number, inbound matching prefers the business that most recently sent an outbound message to that phone; when no business has texted the number, or the most recent sender cannot be determined, the message is recorded as unmatched rather than guessed. STOP and START apply to the business the text was routed to.
- M2. Twilio signature. The SMS webhook verifies `X-Twilio-Signature` as Twilio defines it (HMAC-SHA1 of the full URL and the sorted form parameters with the auth token) and refuses anything else; production boot requires the token.
- M3. Phone numbers. Client phone numbers are normalized to E.164 when written (API schemas and the app-core client form share one rule), and outbound SMS and inbound matching compare normalized numbers. A script normalizes existing rows and reports numbers it cannot parse; it runs only after approval.
- M4. Sticky STOP. A client's SMS opt-out can only be cleared by the client's own START reply. Staff consent changes do not override it, and the client record shows that texts are stopped by the client.
- M5. CASL identification. Broadcast emails carry the business's mailing address and a contact method from its brand settings, and a broadcast cannot be sent while the address is missing.
- M6. Local daytime. Review requests, pickup reminders and the overdue sweep run per business in its own time zone at a daytime hour, and broadcasts do not send during quiet hours (21:00 to 09:00 local); a scheduled broadcast in quiet hours waits for the morning.
- M7. Resumable broadcasts. Sending commits per recipient, claims work with `FOR UPDATE SKIP LOCKED`, and skips recipients who already have a message for the broadcast, so a crash or retry never sends twice. Immediate broadcasts are handed to the job instead of being sent inside the request.
- M8. Staff alerts. An inbound text or a Connect message pushes a notification to the business's staff devices, and tapping it opens the conversation on mobile.

## Tests

Each task adds its failing test first in the concept's test file: a phone shared by two businesses, a real Twilio signature, a staff toggle after STOP, non-E.164 input, a broadcast that fails partway and resumes, quiet hours and per-zone job timing, CASL identification in the email body, and the staff push on inbound.

## Execution rules

One worker, tasks in order, focused tests per task and the full gate at the end. No schema change and no data change without approval. Other sessions' uncommitted work is preserved. No commit or push without being asked.
