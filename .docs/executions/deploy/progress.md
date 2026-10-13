# Deploy progress

Planned on 13 October 2026; no task has started. The [task queue](tasks.json) is the status source and the [plan](plan.md) holds the design, costs and scaling steps.

## Inputs

| Input                                 | Where it came from                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What Clientbridge needs in production | A read-only review of `main` covering every process, self-hosted service, Postgres requirement, hostname and webhook.                                                                                  |
| What to copy and avoid                | A read-only review of the flowmaestro GKE and Pulumi setup: keep its private Cloud SQL, keyless CI and migration step; avoid its missing backups, split ownership between tools and unchecked deploys. |
| Cloud and cost comparison             | Google Cloud against AWS for a single VM and for Kubernetes; the VM tier costs the same, Kubernetes is about $145 a month cheaper on GKE.                                                              |
| Decisions                             | GKE Autopilot from the start, sized for cost, in `us-east1`, `staging.clientbridge.ca`, separate `book.`, `pay.` and `shop.` hosts, a zonal database with PITR, Pulumi in Python.                      |
