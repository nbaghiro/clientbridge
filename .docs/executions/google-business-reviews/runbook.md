# Google Business Profile setup and pilot

## Enablement

1. Reauthenticate gcloud and select the approved project. Inspect enabled APIs and GBP quota without changing resources. Confirm access approval through Google's [prerequisites](https://developers.google.com/my-business/content/prereqs).
2. Create dedicated OAuth credentials and configure consent for `https://www.googleapis.com/auth/business.manage`. Configure each exact callback as `https://api.<environment-domain>/v1/reviews/google/callback`. The backend redirects native handoffs to the fixed `clientbridge://reviews/google` route and browser handoffs to the configured app's Reviews page.
3. Set `googleBusinessEnabled: true` in the cloud stack configuration and preview. This creates one protected credential key and the empty `GOOGLE_BUSINESS_CLIENT_ID` and `GOOGLE_BUSINESS_CLIENT_SECRET` containers per environment; the cloud stack enables the GBP API family whatever the flag says. This key is separate from Pulumi state encryption.
4. After reviewing and applying the cloud preview, populate the environment's `GOOGLE_BUSINESS_CLIENT_ID` and `GOOGLE_BUSINESS_CLIENT_SECRET` Secret Manager containers. Never put secret values in stack files or screenshots.
5. Set `googleBusinessEnabled: true` and `googleBusinessKmsKey` (the environment's exported key resource name) in the workload stack. Preview runtime secret access and key IAM. The API and worker need encryption/decryption; frontend workloads do not.
6. Deploy only after the migration and application tests pass and deployment is authorized. Existing businesses start disconnected. The old manual review URLs are discarded by the migration; restore from backup is the only way to recover them.

Local integration remains disabled by default. A real local pilot requires GOOGLE_BUSINESS_ENABLED, GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET, GOOGLE_BUSINESS_REDIRECT_URI and GOOGLE_BUSINESS_KMS_KEY, valid ADC credentials with access to that key, and Redis. Register the exact local callback with Google. Test fakes are restricted to test dependency overrides.

## Runtime behavior

One location is linked per business. Google review content is fetched online and remains in foreground client memory. OAuth state expires within ten minutes; completion handoffs expire sooner. Disconnect clears credentials and selected identifiers and cancels local reply work. It does not revoke the entire Google application grant because the same owner may have authorized another business; owners can revoke that grant in their Google account.

Reply operations preserve explicit owner intent. An uncertain write is read back before any conclusion is shown. Conflicting observed edits fail safely; writes made directly in Google cannot be made atomically conditional by Clientbridge. Unresolved operations expire after seven days and erase encrypted draft text. Terminal operations erase draft text immediately.

Invitations are not proof of a review or of delivery. Their destination comes from the connected profile. Notification delivery uses the existing durable queue and consent rules. No reviewer-to-client matching is performed.

## Pilot evidence

Use a consenting verified location. Record authorization, account/location selection, pagination, an empty-review location when available, refresh, a specifically authorized reply/edit/delete, token expiration, revocation, reconnect and disconnect. Send an invitation only to an explicitly selected test recipient. Verify the destination and delivery evidence. Test mobile cancellation and browser popup blocking.

Google provides no sandbox; [review reads require a verified location](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list). Keep API approval and consent verification separate from application test results.

## Recovery

Disable GOOGLE_BUSINESS_ENABLED to stop new Google operations. Retain encrypted operational rows until their disposition is approved. Do not drop the tables as a rollback shortcut. Keep restored credentials disabled until reconciling disconnects and revocations that occurred after the backup. Monitor Google error codes, queue age and unknown operations without logging credentials, authorization codes, review text or reply drafts.
