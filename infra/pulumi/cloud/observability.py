"""Uptime checks, alerts to one email channel, log-based failure metrics and the monthly budget."""

from collections.abc import Sequence
from dataclasses import dataclass

import pulumi
import pulumi_gcp as gcp

from cloud import quotas
from environments import Environment, Host

UPTIME_CHECKS: tuple[tuple[Host, str], ...] = (("api", "/health"), ("app", "/"))
UPTIME_REGIONS = (
    "USA_VIRGINIA",
    "USA_OREGON",
    "USA_IOWA",
)  # three regions keep checks in the free tier
# a stopped PowerSync holds its replication slot, and the WAL it retains fills the disk
RETAINED_WAL_BYTES = 2 * 1024**3


@dataclass(frozen=True)
class LogMetric:
    name: str
    description: str
    filter: str


# fields of the backend's JSON log lines (core/logs.py) and arq's job failure records
LOG_METRICS = (
    LogMetric(
        "failed-job-runs",
        "Job runs that raised in the worker",
        'resource.type="k8s_container" AND resource.labels.container_name="worker" '
        'AND jsonPayload.logger=~"^arq" AND severity>=ERROR',
    ),
    LogMetric(
        "webhook-failures",
        "Webhook deliveries the API answered with a server error",
        'resource.type="k8s_container" AND resource.labels.container_name="api" '
        'AND jsonPayload.logger="clientbridge.requests" AND jsonPayload.path=~"^/webhooks/" '
        "AND jsonPayload.status>=500",
    ),
    # reconcile_ledger logs drift and carries on, so the run itself does not fail
    LogMetric(
        "ledger-drift",
        "reconcile_ledger found the ledger out of line with its cache or Stripe",
        'resource.type="k8s_container" AND resource.labels.container_name="worker" '
        'AND jsonPayload.logger="clientbridge.services.ledger" '
        'AND jsonPayload.message=~"^ledger drift" AND severity>=ERROR',
    ),
)


def create(
    project: str,
    region: str,
    project_number: pulumi.Output[str],
    envs: Sequence[Environment],
    instance: gcp.sql.DatabaseInstance,
    alert_email: str,
    billing_account: str,
    budget_amount: str,
    budget_currency: str,
) -> None:
    channel = gcp.monitoring.NotificationChannel(
        "alerts",
        display_name="Clientbridge alerts",
        type="email",
        labels={"email_address": alert_email},
    )
    channels = [channel.name]
    for env in envs:
        for host, path in UPTIME_CHECKS:
            check = gcp.monitoring.UptimeCheckConfig(
                f"{env.name}-{host}",
                display_name=f"{env.name} {env.host(host)}",
                period="60s",
                timeout="10s",
                selected_regions=list(UPTIME_REGIONS),
                http_check={"path": path, "port": 443, "use_ssl": True, "validate_ssl": True},
                monitored_resource={
                    "type": "uptime_url",
                    "labels": {"project_id": project, "host": env.host(host)},
                },
            )
            _threshold(
                f"{env.name}-{host}-down",
                f"{env.host(host)} is failing its uptime check",
                check.uptime_check_id.apply(
                    lambda check_id: (
                        'metric.type="monitoring.googleapis.com/uptime_check/check_passed" '
                        f'AND resource.type="uptime_url" AND metric.label.check_id="{check_id}"'
                    )
                ),
                threshold=1,
                duration="120s",
                aligner="ALIGN_NEXT_OLDER",
                reducer="REDUCE_COUNT_FALSE",
                group_by=["resource.label.host"],
                channels=channels,
            )
    # Autopilot cannot add a node past a quota, so a rollout would wait on pods that never schedule
    for name, metric, location, limit in (
        ("quota-ssd", "ssd_total_storage", region, quotas.SSD_LIMIT_GB),
        ("quota-cpus", "cpus_all_regions", "global", quotas.CPU_LIMIT),
    ):
        _threshold(
            name,
            f"Compute {metric} above 80% of its quota of {limit}: new nodes will soon fail",
            'metric.type="serviceruntime.googleapis.com/quota/allocation/usage" '
            'AND resource.type="consumer_quota" '
            f'AND metric.label.quota_metric="compute.googleapis.com/{metric}" '
            f'AND resource.label.location="{location}"',
            threshold=0.8 * limit,
            duration="0s",
            aligner="ALIGN_MAX",
            channels=channels,
        )
    database = instance.name.apply(
        lambda name: (
            f'resource.type="cloudsql_database" AND resource.label.database_id="{project}:{name}"'
        )
    )
    _threshold(
        "database-cpu",
        "Database CPU above 80% for 15 minutes",
        database.apply(
            lambda f: f'{f} AND metric.type="cloudsql.googleapis.com/database/cpu/utilization"'
        ),
        threshold=0.8,
        duration="900s",
        aligner="ALIGN_MEAN",
        channels=channels,
    )
    _threshold(
        "database-disk",
        "Database disk above 80%",
        database.apply(
            lambda f: f'{f} AND metric.type="cloudsql.googleapis.com/database/disk/utilization"'
        ),
        threshold=0.8,
        duration="300s",
        aligner="ALIGN_MEAN",
        channels=channels,
    )
    _threshold(
        "replication-slot-lag",
        "WAL retained above 2 GiB: a replication slot (PowerSync) is not advancing",
        database.apply(
            lambda f: (
                f"{f} AND "
                'metric.type="cloudsql.googleapis.com/database/disk/bytes_used_by_data_type" '
                'AND metric.label.data_type="wal"'
            )
        ),
        threshold=RETAINED_WAL_BYTES,
        duration="900s",
        aligner="ALIGN_MEAN",
        channels=channels,
    )
    for metric in LOG_METRICS:
        logged = gcp.logging.Metric(
            metric.name,
            name=metric.name,
            description=metric.description,
            filter=metric.filter,
            metric_descriptor={
                "metric_kind": "DELTA",
                "value_type": "INT64",
                "labels": [{"key": "namespace", "value_type": "STRING"}],
            },
            label_extractors={"namespace": "EXTRACT(resource.labels.namespace_name)"},
        )
        _threshold(
            metric.name,
            metric.description,
            logged.name.apply(
                lambda name: (
                    f'metric.type="logging.googleapis.com/user/{name}" '
                    'AND resource.type="k8s_container"'
                )
            ),
            threshold=0,
            duration="0s",
            aligner="ALIGN_SUM",
            reducer="REDUCE_SUM",
            group_by=["metric.label.namespace"],
            channels=channels,
        )
    gcp.billing.Budget(
        "monthly",
        billing_account=billing_account,
        display_name="Clientbridge monthly",
        amount={"specified_amount": {"currency_code": budget_currency, "units": budget_amount}},
        budget_filter={
            "projects": [project_number.apply(lambda number: f"projects/{number}")],
            "calendar_period": "MONTH",
        },
        threshold_rules=[
            {"threshold_percent": 0.5},
            {"threshold_percent": 0.9},
            {"threshold_percent": 1.0},
            {"threshold_percent": 1.0, "spend_basis": "FORECASTED_SPEND"},
        ],
        all_updates_rule={"monitoring_notification_channels": channels},
    )


def _threshold(
    name: str,
    display_name: str,
    metric_filter: pulumi.Input[str],
    *,
    threshold: float,
    duration: str,
    aligner: str,
    channels: Sequence[pulumi.Input[str]],
    reducer: str | None = None,
    group_by: Sequence[str] = (),
) -> None:
    aggregation: gcp.monitoring.AlertPolicyConditionConditionThresholdAggregationArgsDict = {
        "alignment_period": "300s",
        "per_series_aligner": aligner,
    }
    if reducer is not None:
        aggregation["cross_series_reducer"] = reducer
        aggregation["group_by_fields"] = list(group_by)
    gcp.monitoring.AlertPolicy(
        name,
        display_name=display_name,
        combiner="OR",
        conditions=[
            {
                "display_name": display_name,
                "condition_threshold": {
                    "filter": metric_filter,
                    "comparison": "COMPARISON_GT",
                    "threshold_value": threshold,
                    "duration": duration,
                    "aggregations": [aggregation],
                },
            }
        ],
        notification_channels=list(channels),
        alert_strategy={"auto_close": "86400s"},
    )
