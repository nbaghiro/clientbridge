# Mobile deploy progress

Started on 16 October 2026 from the deploy branch. The goal of this round is staging builds in the hands of internal testers, with the same infrastructure as code as the backend; store submission follows. The durable procedure is in [operations](../../operations.md#mobile-app) and the update-or-build rules in [engineering](../../engineering.md#mobile-changes-an-update-or-a-store-build).

## Done in code

| Stage | What                                                                                                                                                                                                                                                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0    | EAS project `@clientbridge-ca/clientbridge` created with the staging robot token. Checked in eas-cli 25.0.0: a prompt-free build creates Android keystores and iOS provisioning profiles (with an App Store Connect key), but not an iOS distribution certificate, and credentials upload only through the GraphQL API. |
| M1    | `expo-updates` with the fingerprint runtime policy; the app id, name, hosts and Tap to Pay entitlement come from EAS variables; Android `tapToPayCheck`; `webcredentials:` on `app.`; `eas.json` profiles that name only their EAS environment and channel; `app.config.test.ts`.                                       |
| M2    | `cloud/firebase.py`: Firebase, an Android app and push sender per environment, the Play upload account; `Mobile` in `environments.py`.                                                                                                                                                                                  |
| M3    | The web image serves `apple-app-site-association` and `assetlinks.json` on `app.` from `clientbridge:appleTeamId` and `clientbridge:androidCertFingerprints`.                                                                                                                                                           |
| M4    | `mobile_init.py` and `make infra-mobile`, tested with fakes in `tests/test_mobile_init.py`.                                                                                                                                                                                                                             |
| M5    | `deploy-mobile.yml`, called after each environment in `deploy.yml`: an update where a build matches the fingerprint, a build (and store submission) otherwise, and rollback by republishing.                                                                                                                            |
| M7    | `operations.md` (Mobile app, Deploys and rollback, First deploy) and `engineering.md`.                                                                                                                                                                                                                                  |

The development build profile was removed with `expo-dev-client` never added: local runs use `expo run:*`, and a development client would change how they start.

## Review round (16 October 2026)

- Two Expo robots: `EXPO_ACCESS_TOKEN` (push, in the cluster) and `EAS_ROBOT_TOKEN` (builds and updates, GitHub only); `mobile_init.py` refuses the same token for both. Staging's `EXPO_ACCESS_TOKEN` is still the Developer robot until a push-only robot replaces it.
- A new service account key replaces the account's older ones, and a key EAS refuses is deleted.
- Production's Android build is submitted to Play only once `PLAY_APP_READY` is set; the mobile jobs run only for deploys started by CI; the token reaches `gh` on stdin; `APPLE_TEAM_TYPE` covers a personal Apple account.

## Still open

- Create the push-only Expo robot, put its token in `EXPO_ACCESS_TOKEN` and rerun `make infra-providers ENV=staging`, which replaces the Secret Manager value, then restart the API and worker.
- M6, a minimum supported app version, waits on a decision: the backend would refuse requests from a bundle older than a floor with a stable error code, and the app would show an update screen.
- The Apple developer account (D-U-N-S for ClientBridge Inc. first), then the `APPLE_` values and a rerun of `make infra-mobile`; the TestFlight testers group.
- Google Play: the organization account, the production app and its first upload by hand, inviting `cb-play-publisher`, and the Play signing certificate's SHA-256 in `clientbridge:androidCertFingerprints`.
- The Tap to Pay entitlement request, and Apple's "How to Tap" screen before Tap to Pay review.
- Store submission work tracked in launch readiness: account deletion in the app, Sign in with Apple, the reviewer account, privacy labels and Play's Data safety form.
