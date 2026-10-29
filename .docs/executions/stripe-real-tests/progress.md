# Real Stripe in CI: progress

## Task 1: merchant pool (done 2026-10-29)

Six pairs in the Clientbridge sandbox (platform `acct_1UPkgSFGqw7iO9oD`), each tagged `clientbridge_qa=payments`, `clientbridge_qa_environment=ci-<n>` and `clientbridge_qa_slot`, with Stripe's test identity, the Canadian test bank account (transit 11000, account ending 6789) and terms accepted. All twelve show charges and payouts enabled with nothing due.

| Pair | Slot a                  | Slot b                  |
| ---- | ----------------------- | ----------------------- |
| ci-1 | `acct_1UW1EAFGqwpchJj8` | `acct_1UW1EKFGqw5WPraS` |
| ci-2 | `acct_1UW1EcFGqwCjmvBg` | `acct_1UW1EmFGqwyiuFg7` |
| ci-3 | `acct_1UW1F2FGqwYug5E4` | `acct_1UW1FDFGqwSDkSq6` |
| ci-4 | `acct_1UW1FUFGqwETL0Wd` | `acct_1UW1FfFGqwnv2Ulo` |
| ci-5 | `acct_1UW1FvFGqwMR1MhI` | `acct_1UW1G6FGqwvqJNFk` |
| ci-6 | `acct_1UW1GNFGqwQLONGh` | `acct_1UW1GWFGqw1tQVIQ` |

How they were made, for adding pairs later:

1. `uv run python -m scripts.stripe_qa_accounts --environment ci-<n> --apply --prepare --bank` creates and prefills a pair (rerunning it is safe).
2. For each account, open a fresh Stripe-hosted onboarding link in a visible Chrome started with `--remote-debugging-port` and a new profile, then click Use test phone number, Use test code and Agree and submit once each. A headless browser gets Stripe's hCaptcha challenge; a visible one passed all twelve without one. One page load timed out and passed on a retry.
3. `uv run python -m scripts.stripe_qa_accounts --environment ci-<n>` confirms both show charges and payouts enabled.

Accounts in this sandbox are shared with staging and local development, but no business there is linked to a pool account, so their events reach staging's webhook and are ignored.

## Next

Task 2, leasing a pair.
