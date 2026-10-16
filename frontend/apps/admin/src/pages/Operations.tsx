import { useSearchParams } from "react-router-dom";
import {
    formatNumber,
    adminLabel,
    strings,
    useAdminFilters,
    useAdminResource,
} from "@clientbridge/app-core/public";
import { Button, Panel, Select, Stat } from "@clientbridge/ui";
import { config } from "../config";
import {
    RecordStatus,
    Facts,
    Identifier,
    Pagination,
    RecordPanel,
    Records,
    Resource,
    When,
} from "../components/Records";

export function Operations() {
    const [params] = useSearchParams();
    const filters = useAdminFilters("", "", params.get("status") ?? "");
    const state = useAdminResource(
        "AdminOperations",
        config.apiUrl,
        `operations?${filters.params}`,
    );
    return (
        <Resource state={state}>
            {(data) => (
                <>
                    <Panel
                        title={strings.admin.database}
                        actions={
                            <Button variant="outline" onPress={state.refresh}>
                                {strings.admin.refresh}
                            </Button>
                        }
                    >
                        <Facts
                            items={[
                                [strings.admin.environmentLabel, data.environment],
                                [strings.admin.emailTransport, data.email_transport],
                                [
                                    strings.admin.revision,
                                    data.database_revision.map((r) => (
                                        <Identifier key={r} value={r} />
                                    )),
                                ],
                                [
                                    strings.admin.expectedRevision,
                                    data.expected_revision.map((r) => (
                                        <Identifier key={r} value={r} />
                                    )),
                                ],
                            ]}
                        />
                        <p className="pt-3 text-sm text-muted">{strings.admin.migrationNote}</p>
                    </Panel>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Stat
                            label={strings.admin.pendingWebhooks}
                            value={formatNumber(data.pending_webhooks)}
                        />
                        <Stat
                            label={strings.admin.failedWebhooks}
                            value={formatNumber(data.failed_webhooks)}
                            tone={data.failed_webhooks ? "warning" : "ink"}
                        />
                    </div>
                    <Select
                        label={strings.admin.status}
                        value={filters.status}
                        onChange={filters.setStatus}
                        options={[
                            { key: "", label: strings.admin.allStatuses },
                            ...(["pending", "processed", "failed"] as const).map((key) => ({
                                key,
                                label: adminLabel(key),
                            })),
                        ]}
                    />
                    <RecordPanel title={strings.admin.webhooks}>
                        <Records
                            items={data.webhooks.items}
                            columns={[
                                {
                                    label: strings.admin.event,
                                    render: (w) => (
                                        <>
                                            {w.event}
                                            <div>
                                                <Identifier value={w.id} />
                                            </div>
                                        </>
                                    ),
                                },
                                { label: strings.admin.provider, render: (w) => w.provider },
                                {
                                    label: strings.admin.status,
                                    render: (w) => <RecordStatus value={w.status} />,
                                },
                                {
                                    label: strings.admin.recorded,
                                    render: (w) => <When value={w.created_at} />,
                                },
                            ]}
                        />
                        <Pagination filters={filters} hasMore={data.webhooks.has_more} />
                    </RecordPanel>
                </>
            )}
        </Resource>
    );
}
