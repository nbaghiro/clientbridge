import { useSearchParams } from "react-router-dom";
import {
    groupAdminActivity,
    strings,
    useAdminFilters,
    useAdminResource,
    type AdminSchemas,
} from "@clientbridge/app-core/public";
import { Empty } from "@clientbridge/ui";
import { config } from "../config";
import {
    Filters,
    Identifier,
    Pagination,
    RecordLink,
    RecordPanel,
    Resource,
    When,
} from "../components/Records";

export function Activity() {
    const [params] = useSearchParams();
    const filters = useAdminFilters(params.get("business_id") ?? "", params.get("q") ?? "");
    const state = useAdminResource(
        "AdminPage_AdminActivity_",
        config.apiUrl,
        `activity?${filters.params}`,
    );
    return (
        <>
            <Filters filters={filters} placeholder={strings.admin.queryHint} scoped />
            <p className="text-sm text-muted">{strings.admin.activityNote}</p>
            <Resource state={state}>
                {(data) => (
                    <RecordPanel>
                        <ActivityRecords items={data.items} />
                        <Pagination filters={filters} hasMore={data.has_more} />
                    </RecordPanel>
                )}
            </Resource>
        </>
    );
}
export function ActivityRecords({ items }: { items: AdminSchemas["AdminActivity"][] }) {
    if (!items.length) return <Empty message={strings.admin.noResults} />;
    const groups = groupAdminActivity(items);
    return (
        <div className="divide-y divide-line">
            {Object.entries(groups).map(([business, events]) => (
                <section key={business} className="p-5">
                    <RecordLink to={`/businesses/${business}`}>
                        {events[0]?.business_name ?? business}
                    </RecordLink>
                    <ol className="mt-4 space-y-5 border-l border-line pl-5">
                        {events.map((event) => (
                            <li key={event.id} className="flex flex-wrap justify-between gap-3">
                                <div>
                                    <p className="text-sm font-medium">{event.action}</p>
                                    <p className="text-xs text-muted">{event.entity_type}</p>
                                    <Identifier value={event.entity_id} />
                                    {event.performed_by ? (
                                        <div>
                                            <RecordLink to={`/people/${event.performed_by}`}>
                                                {event.actor_name ?? event.performed_by}
                                            </RecordLink>
                                        </div>
                                    ) : null}
                                </div>
                                <div className="text-xs text-muted">
                                    <When value={event.created_at} />
                                </div>
                            </li>
                        ))}
                    </ol>
                </section>
            ))}
        </div>
    );
}
