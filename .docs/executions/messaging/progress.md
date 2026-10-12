# Messaging fix-now progress

Started on 2026-10-11. Record per-task evidence here.

## M1 to M8 (completed)

- M1: inbound texts route to the business that most recently sent an SMS to that client's number (`route_inbound_sms`, read through `scoped()`); no sender or a tie is recorded as unmatched, and STOP or START applies only to the routed business. Until automated messages are stored in threads, a client who only received reminders and replies STOP is unmatched.
- M2: `valid_twilio_signature` checks Twilio's HMAC-SHA1 over `API_BASE_URL` plus path and sorted parameters; production boot requires `TWILIO_AUTH_TOKEN`, which replaces the static SMS secret.
- M3: `core/phones.py` (`e164`, the `Phone` validator, `same_phone` SQL) and app-core `normalizePhone` share one rule; outbound texts and matching use E.164. `scripts/normalize_phones.py` would change 1 of 93 local numbers and waits for approval.
- M4: only the client's own START reply lifts a STOP; staff grants and the preferences page cannot, and the client record shows that texts were stopped by the client.
- M5: broadcast emails carry the business address and a contact; sending is refused with `broadcast_address_missing` or `broadcast_contact_missing`.
- M6: broadcasts do not send between 21:00 and 09:00 local and wait for the morning. Daily client messages already follow each business's morning upstream (a8511c4).
- M7: the job sends broadcasts one recipient at a time, claiming with `SKIP LOCKED`, saving before and after each send and skipping recipients already sent; delivery is at most once.
- M8: inbound texts and Connect messages push to the business's active staff devices; tapping opens the conversation on mobile; sign-out unregisters the device through `POST /v1/devices/unregister`.
- Integrated onto a8511c4 and 880f721 (conflicts in `services/business.py`, `tasks/worker.py`, `tests/test_business.py`; messaging uses `core.zones`). Full gate on the merged tree passed: backend and frontend lint and tests, playground (153), web (17), Connect (37) and site (63).
