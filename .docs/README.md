# Documentation

Keep the root for the main, maintained documentation. Reviews, explorations and execution records belong in the folders below.

| Main document                           | Purpose                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------- |
| [Architecture](architecture.md)         | System, data model, synchronization, authorization and client architecture. |
| [Engineering](engineering.md)           | Development conventions, testing, local setup and shipping workflow.        |
| [Launch readiness](launch-readiness.md) | Product scope, launch work and deferred capabilities.                       |

## Supporting documentation

| Folder                                 | Contents                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Design](design/app-explorer.html)     | Design system, information architecture and visual references.                                   |
| [Reviews](reviews/README.md)           | Dated findings and implementation inventories; evidence of the system at the reviewed snapshot.  |
| [Explorations](explorations/README.md) | Investigations, experiments and proposals that are not yet the maintained architecture.          |
| [Executions](executions/README.md)     | One folder per execution that is planned or in progress, with its plan, task state and progress. |

## Placement rules

- Put a new review in `reviews/<area>/` and identify its date and source snapshot.
- Put an exploration in `explorations/<topic>/`; promote an accepted decision into the relevant main document.
- Put implementation plans and tracking in `executions/<name>/`. Use `plan.md`, `progress.md` and `tasks.json` when needed; add a date suffix for another execution of the same work.
- Keep generated logs, temporary snapshots, downloaded references and local test artifacts in `.scratchpad/`. Link durable summaries to their evidence instead of copying every log into documentation.
- Update relative links when moving files. When an execution is implemented, move what still matters into the main docs and delete its folder; do the same for a review once its findings are resolved.

Current executions are listed in [executions/README.md](executions/README.md).
