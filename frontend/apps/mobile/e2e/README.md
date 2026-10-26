# Native walkthroughs

These Maestro flows open a release build of the Clientbridge iOS/Android app against a run's own API on the shared test tier. They are separate from the React Native Web component previews. The current verified device and results are recorded in the [mobile surface map](../../../../.docs/reviews/product/mobile.md).

## Run

The native lane runs every flow on a release build against the shared test tier (`make test-tier`), under the run's own namespace, the same way the browser lanes do. Build the e2e app once per native change (about 8 minutes for iOS and 10 for Android here), then run the lane on a device that is already started:

```sh
make test-functional FUNCTIONAL_ARGS="--build-native ios"
make test-functional FUNCTIONAL_ARGS="--surface native --platform ios --device <simulator-udid>"
make test-functional FUNCTIONAL_ARGS="--build-native android"
make test-functional FUNCTIONAL_ARGS="--surface native --platform android --device emulator-5554"
```

Name flow files after the arguments to run only those, for example `... --device <udid> functional-client.yaml`. The build is `ca.clientbridge.app.e2e` ("Clientbridge E2E"), so a development build and its data stay untouched; the lane installs it fresh, and uninstalls it when it finishes. The build has `127.0.0.1` (iOS) or the emulator's `10.0.2.2` (Android) on ports 8794, 8795 and 8796 compiled in, and the lane forwards those to the run's API and the tier's auth and PowerSync, so no `adb reverse` is needed. Because those ports and Maestro's driver port 8797 are fixed, one native run at a time holds them. The lane never starts, boots or shuts down a device.

Flows tagged `lane` call `helpers/control.js`, which asks the lane to cut the forwarded services (`offline`), restore them (`online`) or deliver a push (`push`). Going offline this way leaves the device's own network alone, unlike airplane mode, so a shared emulator stays usable. Flows tagged `ios` run only on iOS. The lane passes `APP_ID`, `E2E_NAMESPACE`, `MAILPIT_URL`, `AUTH_ADMIN_URL` and `CONTROL_URL`; the flows stop with an error when one is missing. Every run has its own copy of the core demo businesses, so the logins carry its namespace (`hannah+<namespace>@birchbark.example`), and a throwaway recovery login does too, which is how the tier routes its reset mail to the run.

The reports land in `.scratchpad/e2e-<id>/`: `native-results.xml` (JUnit, checked against the required cases in `backend/scripts/e2e_results.py`), `native-artifacts/` screenshots, `native-debug/` Maestro and XCUITest logs, and `control.log`.

On iOS the lane restarts the simulator's pasteboard daemon first. A stuck `pasted` blocks the app's main thread whenever a text field takes focus, which Maestro reports as `Unable to perform work on main run loop, process main thread busy for 30.0s`; that was the earlier iOS keyboard failure, not an app fault.

`make test-mobile PLATFORM=ios DEVICE=<udid>` runs the same lane. The demo users are Hannah (owner) and Diego (staff), both using `demo1234`.

## Coverage

| Flow                      | Checks                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-workday.yaml`         | Today, search, notifications, schedule, classes, repeating bookings, booking composer, clients and add-client sheet.                                                    |
| `02-setup.yaml`           | All eight setup destinations, plus Inventory, weekly hours and online-booking add-on/policy tabs.                                                                       |
| `03-payments.yaml`        | All eight payment areas; invoice/estimate composers; sales register/orders/history; credit notes and disputes.                                                          |
| `04-inbox.yaml`           | All five Inbox areas; message composer, new-form editor/settings and contract composer.                                                                                 |
| `05-client-record.yaml`   | Seeded client detail, history, wallet and pets.                                                                                                                         |
| `06-staff-and-auth.yaml`  | Sign-in/signup/reset entry and Google unavailable state; real staff login; reduced Payments/Inbox/Setup surfaces and own hours. Completion restores the owner session.  |
| `11-recovery.yaml`        | Password recovery end to end: the code from Mailpit, a new password, signed in at onboarding. Uses a throwaway auth identity it deletes; completion restores the owner. |
| `12-saved-session.yaml`   | NATIVE-IOS-01: the session in SecureStore (the Keychain on iOS) reopens Today after a relaunch, and signing out removes it, so the next launch asks to sign in.         |
| `13-offline-replica.yaml` | NATIVE-IOS-02: with every service cut, a relaunch opens Today and Olivia Martin's record from the device's SQLite replica.                                              |
| `14-push-tap.yaml`        | NATIVE-IOS-03 (iOS only): the push a client's message sends staff, delivered by the simulator, opens that client's conversation when tapped.                            |
| `functional-client.yaml`  | NATIVE-CRM-01: creates and edits a client through the app, with a relaunch after each, and checks both survive.                                                         |

Flows assert meaningful visible controls/content, then capture screenshots. The modal checks protect the regression where the accessible backdrop parent hid every sheet descendant from iOS's accessibility tree. The Inbox entry also relies on its explicit accessible name.

The helpers launch the app, wait for authentication/sync, and dismiss React Native's development warning banner when present because it covers the bottom navigation. That dismissal uses a point inside the **identified banner**, not a fixed screen coordinate. The staff email entry taps near the end of the input before erasing and asserts the resulting address, since a center tap can leave trailing characters after iOS backspacing. Closing a sheet similarly targets its named backdrop near the upper edge. Other navigation uses labels and relative selectors; horizontal tab scrolling starts from a visible tab. These techniques follow Maestro's [tap](https://docs.maestro.dev/reference/commands-available/tapon) and [swipe](https://docs.maestro.dev/reference/commands-available/swipe) APIs.

The suite does not submit business forms, messages, broadcasts or payments, or deliberately change bookings, inventory, tax or staff pay. It does sign users in/out and may update local notification seen state. It does not clear app data or the system keychain. An unexpected unsynced-changes confirmation is not approved by the tests. Use a dedicated development device; the staff flow changes its session and restores Hannah after completion.

## Known regressions

`regressions/client-editor.yaml` reproduces the client-record Edit transition and expects the editor to appear. It fails on the reviewed iPhone and passes on Android, so it stays outside the shared default suite until the iOS issue is investigated:

```sh
maestro --device <simulator-udid> test e2e/regressions/client-editor.yaml \
  --test-output-dir test-results/regressions --format HTML \
  --output test-results/regressions/index.html
```

The Create → Estimate shortcut (`08-estimate-shortcut.yaml`), the Staff pay total labels (`09-staff-pay-labels.yaml`) and inbox navigation (`10-inbox-navigation.yaml`) were fixed on October 10, 2026 and run with the default suite.

## Boundaries

These are navigation and composition walkthroughs, not exhaustive transaction tests. Real card charging, terminal hardware, push delivery/taps, second factors on the device, fresh-business onboarding, offline reconnect/conflicts, every empty/error state, release builds, iPad layout and further Android device/OS combinations require additional runs. Passing browser “iPhone/Android” frames does not cover those native concerns.

## Sync startup regression

`07-sync-startup.yaml` verifies saved-session restoration, selection of the scoped business, and the recurring-hours editor on the actual native app without submitting a business change. The owner helper waits for the asynchronously loaded viewer name.

Use normal simulator signing when building iOS. A build produced with signing disabled can make SecureStore fail with a missing Keychain entitlement before the replica opens. Rebuilding/installing the same bundle with normal signing preserves app data; deleting the database does not resolve this credential-storage failure.
