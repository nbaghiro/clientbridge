# Demo seed simplification

Status: planned, on hold. We are testing the eleven demo businesses first and will come back to this once we know what each one needs.

The demo seed works, but it grew quickly: Birchbark is still built by its own modules, each business is declared twice, and the nine vertical branches added overlapping engine options. This plan makes the system smaller without changing any demo row or losing any way to define a business.

## Rules

- No demo data changes. Each commit is proven with `scripts/demo_fingerprint.py --compare` against main, seeded at the same `--as-of` in both full and `--core` mode. Where a commit touches them, `make demo-snapshot` must leave no diff and the `stripe_setup` plan must report nothing to change.
- No lost flexibility. A new vertical stays one edition module and one registry line; `--core`, `--jobs` and `--scratch` keep working.
- If a step can't keep the fingerprint identical, it stops there and is reviewed rather than changing data.

## Commits

| # | Change | What goes |
| --- | --- | --- |
| 1 | Remove dead demo code | `PACKAGE_USED` and `CORE_IDS`, the never-built webhook path and `DemoContext.discard`, the pre-engine `refresh_catalog`, Birchbark's ignored tax markers and unused `_invoice_for` arguments, the duplicate `Field` type; about 120 lines |
| 2 | Validate each seed once | the second cross-business pass; the write runs only the database checks, and `make demo-check` keeps the graph re-check for drifted databases |
| 3 | Wrap Birchbark as an engine edition | `Birchbark(Demo)` runs its existing pipeline against its own context, and `Demo.post_ledger` lets it keep its finance posting; the special cases for Birchbark in `seed_demo` go |
| 4 | Move Birchbark into `demo_birchbark.py` | its ten legacy modules become one edition module and the module globals go; eight modules are removed and `seed_demo.py` drops from about 2,500 to about 330 lines; tests build Birchbark alone |
| 5 | One declaration per business | the registry entry folds into the spec, the owner's name and login are derived from the owner, and the registry becomes the ordered list of editions; about 120 lines |
| 6 | Shared photo screening | the copy in Brightwater and Foothills becomes one engine option those two opt into; it is not made the default, because the Python rule would drop portraits elsewhere |
| 7 | Shared desk checkout | Maple and Main's and Inkwell's identical checkout code becomes one `Desk(Demo)` base, with their e-transfer delay and tip policy as settings and the same random call order |
| 8 | Shared time helpers | `on`, `days_to` and `fits` move into the engine |
| 9 | Simpler `fill()` | per-member client pools move into `Pacing`, leaving `fill(clients, pacing)`; the shared turn counter and the order of the per-member maps are kept |
| 10 | Write only into empty databases | tests and CI write straight into their fresh database, while local `make seed` and staging seed a scratch database and copy each business in one transaction; the purge-everything-first pass goes, so a failed business keeps its old data everywhere |
| 11 | Trim the demo tests and docs | the calendar test stops repeating graph validation, tests stop building every edition when they need Birchbark, and the demo paragraph in `engineering.md` describes the single path |

Together these remove about 600 to 700 lines and eight modules, and leave one build path and one write rule for all eleven businesses.

## Kept on purpose

- Ledger posting through `services/ledger.py`, since money moves only through the ledger.
- The parallel writer with one transaction per business, which is where the speed comes from.
- The scratch database and COPY for staging, because of its round-trip time on the shared-core instance.
- The trigger pauses the append-only ledger needs during purge and copy.
- Birchbark's hand-written story, which about 94 test files pin by id, and each edition's own story code, since unifying them would change data.

## Verification for the whole run

Fingerprint each commit as above, then run the full gate once through the pre-commit hook, `make test-connect`, and a seed of a populated throwaway database with `demo_validate`, before pushing and checking CI and the staging seed.
