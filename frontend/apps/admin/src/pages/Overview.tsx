import { formatNumber, strings, useAdminResource } from "@clientbridge/app-core/public";
import { Stat } from "@clientbridge/ui";
import { config } from "../config";
import { RecordLink, RecordPanel, Resource } from "../components/Records";
import { BusinessRecords } from "./Businesses";
import { ActivityRecords } from "./Activity";

export function Overview() {
    const state = useAdminResource("AdminOverview", config.apiUrl, "overview");
    return (
        <Resource state={state}>
            {(data) => (
                <>
                    <div className="grid gap-4 sm:grid-cols-3">
                        <RecordLink to="/businesses">
                            <Stat
                                size="lg"
                                label={strings.admin.businesses}
                                value={formatNumber(data.businesses)}
                            />
                        </RecordLink>
                        <RecordLink to="/people">
                            <Stat
                                size="lg"
                                label={strings.admin.users}
                                value={formatNumber(data.users)}
                            />
                        </RecordLink>
                        <RecordLink to="/people?kind=clients">
                            <Stat
                                size="lg"
                                label={strings.admin.clients}
                                value={formatNumber(data.clients)}
                            />
                        </RecordLink>
                    </div>
                    <div className="flex flex-wrap gap-6">
                        <RecordLink to="/payments?status=failed">
                            {strings.admin.failedPayments}{" "}
                            <span className="tabular-nums">
                                {formatNumber(data.failed_payments)}
                            </span>
                        </RecordLink>
                        <RecordLink to="/operations?status=failed">
                            {strings.admin.failedWebhooks}{" "}
                            <span className="tabular-nums">
                                {formatNumber(data.failed_webhooks)}
                            </span>
                        </RecordLink>
                    </div>
                    <RecordPanel title={strings.admin.recentBusinesses}>
                        <BusinessRecords items={data.recent_businesses} />
                    </RecordPanel>
                    <RecordPanel title={strings.admin.recentActivity}>
                        <ActivityRecords items={data.activity} />
                    </RecordPanel>
                </>
            )}
        </Resource>
    );
}
