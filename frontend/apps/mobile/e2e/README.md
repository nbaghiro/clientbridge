# Native walkthroughs

These Maestro flows open the actual Clientbridge iOS/Android development build against the local API and PowerSync replica. They are separate from the React Native Web component previews. The current verified device and results are recorded in the [mobile surface map](../../../../.docs/reviews/product/mobile.md).

## Run

Install the [Maestro CLI](https://docs.maestro.dev/get-started/installing-maestro), the frontend dependencies and the platform's native build tools. The reviewed runs use Maestro 2.11.0, an iPhone 17 Pro simulator on iOS 26.5, and the Shared Pixel emulator on Android 14 / API 34.

Start the local stack and API using the [engineering guide](../../../../.docs/engineering.md). Use a development database with the demo seed; do not reset a database containing work you need to keep. The flows expect Hannah's seeded business and Olivia Martin's client record. Demo users are Hannah (owner) and Diego (staff), both using `demo1234`.

Install the native build with `pnpm --filter mobile ios` or `pnpm --filter mobile android` from `frontend/`, then run Metro on the app's configured port:

```sh
make dev-mobile
```

Expo Go cannot load the required native SQLite/Stripe modules. A physical device or Android emulator also needs `API_URL` and `POWERSYNC_URL` set to reachable hosts when building/configuring the app; the localhost defaults work for the reviewed iOS simulator. If Metro reports that a file is missing even though it exists, restart it with `pnpm --filter mobile exec expo start --port 8707 --clear` from `frontend/`.

For an Android development build configured with localhost endpoints, forward the services to the host (substitute the device ID as needed):

```sh
adb -s emulator-5554 reverse tcp:8701 tcp:8701
adb -s emulator-5554 reverse tcp:8704 tcp:8704
adb -s emulator-5554 reverse tcp:8707 tcp:8707
# If the installed build requests Metro on its default port:
adb -s emulator-5554 reverse tcp:8081 tcp:8707
```

Start signed out or signed in as the demo owner. With one target device available, run from the repo root:

```sh
make test-mobile
```

To choose a particular simulator, run from `frontend/apps/mobile/`:

```sh
maestro --device <simulator-udid> test e2e \
  --test-output-dir test-results --format HTML --output test-results/index.html
```

The report and per-flow screenshots live under the ignored `test-results/` directory. A normal directory run discovers the top-level flow files; `helpers/` and `regressions/` are not independent suite entries. See Maestro's [workspace discovery rules](https://docs.maestro.dev/reference/workspace-configuration).

## Coverage

| Flow                     | Checks                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-workday.yaml`        | Today, search, notifications, schedule, classes, repeating bookings, booking composer, clients and add-client sheet.                                                   |
| `02-setup.yaml`          | All eight setup destinations, plus Inventory, weekly hours and online-booking add-on/policy tabs.                                                                      |
| `03-payments.yaml`       | All eight payment areas; invoice/estimate composers; sales register/orders/history; credit notes and disputes.                                                         |
| `04-inbox.yaml`          | All five Inbox areas; message composer, new-form editor/settings and contract composer.                                                                                |
| `05-client-record.yaml`  | Seeded client detail, history, wallet and pets.                                                                                                                        |
| `06-staff-and-auth.yaml` | Sign-in/signup/reset entry and Google unavailable state; real staff login; reduced Payments/Inbox/Setup surfaces and own hours. Completion restores the owner session. |

Flows assert meaningful visible controls/content, then capture screenshots. The modal checks protect the regression where the accessible backdrop parent hid every sheet descendant from iOS's accessibility tree. The Inbox entry also relies on its explicit accessible name.

The helpers launch the app, wait for authentication/sync, and dismiss React Native's development warning banner when present because it covers the bottom navigation. That dismissal uses a point inside the **identified banner**, not a fixed screen coordinate. The staff email entry taps near the end of the input before erasing and asserts the resulting address, since a center tap can leave trailing characters after iOS backspacing. Closing a sheet similarly targets its named backdrop near the upper edge. Other navigation uses labels and relative selectors; horizontal tab scrolling starts from a visible tab. These techniques follow Maestro's [tap](https://docs.maestro.dev/reference/commands-available/tapon) and [swipe](https://docs.maestro.dev/reference/commands-available/swipe) APIs.

The suite does not submit business forms, messages, broadcasts or payments, or deliberately change bookings, inventory, tax or staff pay. It does sign users in/out and may update local notification seen state. It does not clear app data or the system keychain. An unexpected unsynced-changes confirmation is not approved by the tests. Use a dedicated development device; the staff flow changes its session and restores Hannah after completion.

## Known regressions

The Create → Estimate shortcut routes to a new invoice. Keep this independently runnable assertion until the routing is fixed:

```sh
maestro --device <simulator-udid> test e2e/regressions/estimate-shortcut.yaml \
  --test-output-dir test-results/regressions --format HTML \
  --output test-results/regressions/index.html
```

`regressions/staff-pay-labels.yaml` asserts that the three Staff pay totals retain their labels; the reviewed iPhone and Android screens show only the amounts.

The separate `regressions/client-editor.yaml` reproduces the client-record Edit transition and expects the editor to appear. It fails on the reviewed iPhone and passes on Android; it remains outside the shared default suite while the iOS issue is investigated.

The estimate test expects the correct product behavior (`New estimate`), so a failure showing `New invoice` is a product regression, not a passing smoke check. It is deliberately outside the default top-level suite.

## Boundaries

These are navigation and composition walkthroughs, not exhaustive transaction tests. Real card charging, terminal hardware, push delivery/taps, reset email completion, fresh-business onboarding, offline reconnect/conflicts, every empty/error state, release builds, iPad layout and further Android device/OS combinations require additional runs. Passing browser “iPhone/Android” frames does not cover those native concerns.
