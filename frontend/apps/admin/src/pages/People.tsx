import { useParams, useSearchParams } from "react-router-dom";
import {
    adminLabel,
    strings,
    useAdminFilters,
    useAdminResource,
} from "@clientbridge/app-core/public";
import { Panel } from "@clientbridge/ui";
import { config } from "../config";
import {
    RecordStatus,
    Facts,
    Filters,
    Identifier,
    Pagination,
    RecordLink,
    RecordPanel,
    Records,
    Resource,
    When,
} from "../components/Records";

export function People() {
    const [params] = useSearchParams();
    const clients = params.get("kind") === "clients";
    return (
        <>
            <div className="flex gap-6">
                <RecordLink to="/people">{strings.admin.users}</RecordLink>
                <RecordLink to="/people?kind=clients">{strings.admin.clients}</RecordLink>
            </div>
            {clients ? (
                <Clients
                    key={params.get("business_id")}
                    business={params.get("business_id") ?? ""}
                />
            ) : (
                <Users />
            )}
        </>
    );
}
function Users() {
    const filters = useAdminFilters();
    const state = useAdminResource(
        "AdminPage_AdminUser_",
        config.apiUrl,
        `users?${filters.params}`,
    );
    return (
        <>
            <Filters filters={filters} placeholder={strings.admin.searchPeople} />
            <Resource state={state}>
                {(data) => (
                    <RecordPanel>
                        <Records
                            items={data.items}
                            columns={[
                                {
                                    label: strings.admin.name,
                                    render: (u) => (
                                        <RecordLink to={`/people/${u.id}`}>
                                            {u.name ?? u.email}
                                        </RecordLink>
                                    ),
                                },
                                { label: strings.admin.email, render: (u) => u.email },
                                {
                                    label: strings.admin.lastSeen,
                                    render: (u) => <When value={u.last_seen_at} />,
                                },
                            ]}
                        />
                        <Pagination filters={filters} hasMore={data.has_more} />
                    </RecordPanel>
                )}
            </Resource>
        </>
    );
}
function Clients({ business }: { business: string }) {
    const filters = useAdminFilters(business);
    const state = useAdminResource(
        "AdminPage_AdminClient_",
        config.apiUrl,
        `clients?${filters.params}`,
    );
    return (
        <>
            <Filters filters={filters} placeholder={strings.admin.searchPeople} scoped />
            <Resource state={state}>
                {(data) => (
                    <RecordPanel>
                        <Records
                            items={data.items}
                            columns={[
                                {
                                    label: strings.admin.name,
                                    render: (c) => (
                                        <>
                                            <RecordLink
                                                to={`/activity?business_id=${c.business_id}&q=${c.id}`}
                                            >
                                                {c.name}
                                            </RecordLink>
                                            <div>
                                                <Identifier value={c.id} />
                                            </div>
                                        </>
                                    ),
                                },
                                {
                                    label: strings.admin.business,
                                    render: (c) => (
                                        <RecordLink to={`/businesses/${c.business_id}`}>
                                            {c.business_id}
                                        </RecordLink>
                                    ),
                                },
                                {
                                    label: strings.admin.details,
                                    render: (c) => (
                                        <div className="flex flex-col gap-2">
                                            <RecordLink
                                                to={`/payments?business_id=${c.business_id}&q=${c.id}`}
                                            >
                                                {strings.admin.payments}
                                            </RecordLink>
                                            <RecordLink
                                                to={`/activity?business_id=${c.business_id}&q=${c.id}`}
                                            >
                                                {strings.admin.activity}
                                            </RecordLink>
                                        </div>
                                    ),
                                },
                            ]}
                        />
                        <Pagination filters={filters} hasMore={data.has_more} />
                    </RecordPanel>
                )}
            </Resource>
        </>
    );
}
export function PersonDetail() {
    const { id = "" } = useParams();
    const state = useAdminResource(
        "AdminPersonDetail",
        config.apiUrl,
        `users/${encodeURIComponent(id)}`,
    );
    return (
        <Resource state={state}>
            {({ user: u, memberships, clients }) => (
                <>
                    <RecordLink to="/people">{strings.admin.back}</RecordLink>
                    <Panel title={u.name ?? u.email}>
                        <Facts
                            items={[
                                [strings.admin.identifier, <Identifier value={u.id} />],
                                [strings.admin.email, u.email],
                                [strings.admin.phone, u.phone],
                                [strings.admin.lastSeen, <When value={u.last_seen_at} />],
                            ]}
                        />
                    </Panel>
                    <RecordPanel title={strings.admin.staff}>
                        <Records
                            items={memberships}
                            columns={[
                                {
                                    label: strings.admin.business,
                                    render: (m) => (
                                        <RecordLink to={`/businesses/${m.business_id}`}>
                                            {m.business_name}
                                        </RecordLink>
                                    ),
                                },
                                { label: strings.admin.role, render: (m) => adminLabel(m.role) },
                                {
                                    label: strings.admin.status,
                                    render: (m) => <RecordStatus value={m.status} />,
                                },
                            ]}
                        />
                    </RecordPanel>
                    <RecordPanel title={strings.admin.clientProfiles}>
                        <Records
                            items={clients}
                            columns={[
                                { label: strings.admin.name, render: (c) => c.name },
                                {
                                    label: strings.admin.business,
                                    render: (c) => (
                                        <RecordLink to={`/businesses/${c.business_id}`}>
                                            {c.business_id}
                                        </RecordLink>
                                    ),
                                },
                                {
                                    label: strings.admin.identifier,
                                    render: (c) => <Identifier value={c.id} />,
                                },
                            ]}
                        />
                    </RecordPanel>
                    <RecordLink to={`/activity?q=${u.id}`}>{strings.admin.viewActivity}</RecordLink>
                </>
            )}
        </Resource>
    );
}
