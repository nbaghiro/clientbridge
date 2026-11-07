# Documentation

The root holds the main, maintained documentation. Reviews, explorations, executions and company material belong in the folders below.

| Main document                           | Purpose                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Architecture](architecture.md)         | System, data model, synchronization, authorization and client architecture.                    |
| [Engineering](engineering.md)           | Development conventions, testing, local setup and shipping workflow.                           |
| [Demo](demo.md)                         | Demo businesses, logins and what each shows.                                                   |
| [Launch readiness](launch-readiness.md) | The launch QA tickets (mirrored in Linear) and the after-launch list.                          |
| [Payments](payments.md)                 | Stripe accounts, merchant payments, payouts, platform billing, setup and recovery.             |
| [Operations](operations.md)             | Environments, stacks, settings and secrets, provider setup, deploys, jobs, alerts and restore. |

## Supporting documentation

| Folder                                 | Contents                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Executions](executions/README.md)     | One folder per execution that is planned or in progress, with its plan, task state and progress. |
| [Explorations](explorations/README.md) | Investigations, experiments and proposals that are not yet the maintained architecture.          |
| [Reviews](reviews/README.md)           | Dated findings about one snapshot of the code, kept until they are resolved.                     |
| [Company](company/README.md)           | Material about running the company, such as job descriptions.                                    |

## Placement rules

- Test coverage lives on the launch tickets (Automated by and To automate) and in `backend/e2e/cases.json`, not in separate checklists.
- Put a new review in `reviews/<area>/` and identify its date and source snapshot.
- Put an exploration in `explorations/<topic>/`; promote an accepted decision into the relevant main document.
- Put implementation plans and tracking in `executions/<name>/`. Use `plan.md`, `progress.md` and `tasks.json` when needed; add a date suffix for another execution of the same work.
- Keep generated logs, temporary snapshots, downloaded references and local test artifacts in `.scratchpad/`. Link durable summaries to their evidence instead of copying every log into documentation.
- Update relative links when moving files. When an execution is implemented, move what still matters into the main docs and delete its folder; do the same for a review once its findings are resolved.
