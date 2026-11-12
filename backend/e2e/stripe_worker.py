"""The Stripe browser lane's worker: production's schedule without the missed-event repairs."""

from arq.cron import CronJob

from clientbridge.tasks.worker import WorkerSettings

# the hold cases keep Stripe's event back on purpose; STR-E25 and STR-E12 run reconcile themselves
REPAIRS = frozenset({"cron:reconcile_ledger", "cron:replay_missed_events"})

# arq reads only a settings class's own attributes, so the lane copies production's as a dict
LANE_WORKER: dict[str, object] = {
    **{name: value for name, value in vars(WorkerSettings).items() if not name.startswith("__")},
    "cron_jobs": [
        job
        for job in WorkerSettings.cron_jobs
        if not (isinstance(job, CronJob) and job.name in REPAIRS)
    ],
}
