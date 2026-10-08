# Documentation

Keep the root for the main, maintained documentation. Reviews, explorations and execution records belong in the folders below.

| Main document | Purpose |
|---|---|
| [Architecture](architecture.md) | System, data model, synchronization, authorization and client architecture. |
| [Engineering](engineering.md) | Development conventions, testing, local setup and shipping workflow. |
| [Launch readiness](launch-readiness.md) | Product scope, launch work and deferred capabilities. |

## Supporting documentation

| Folder | Contents |
|---|---|
| [Design](design/app-explorer.html) | Design system, information architecture and visual references. |
| [Reviews](reviews/README.md) | Dated findings and implementation inventories; evidence of the system at the reviewed snapshot. |
| [Explorations](explorations/README.md) | Investigations, experiments and proposals that are not yet the maintained architecture. |
| [Executions](executions/README.md) | One folder per execution, containing its plan, task state, progress and durable decisions. |

## Placement rules

- Put a new review in `reviews/<area>/` and identify its date and source snapshot.
- Put an exploration in `explorations/<topic>/`; promote an accepted decision into the relevant main document.
- Put implementation plans and tracking in `executions/<name>/`. Use `plan.md`, `progress.md` and `tasks.json` when needed; add a date suffix for another execution of the same work.
- Keep generated logs, temporary snapshots, downloaded references and local test artifacts in `.scratchpad/`. Link durable summaries to their evidence instead of copying every log into documentation.
- Update relative links when moving files. Completed execution records stay with their execution; current system behavior belongs in the main docs.

Current execution: [backend hardening](executions/backend-hardening/plan.md), [progress](executions/backend-hardening/progress.md).
