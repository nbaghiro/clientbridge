import { useParams } from "react-router-dom";
import {
    formatNumber,
    adminLabel,
    strings,
    useAdminFilters,
    useAdminResource,
    type AdminSchemas,
} from "@clientbridge/app-core/public";
import { Panel, Stat } from "@clientbridge/ui";
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

export function Businesses() {
    const filters = useAdminFilters();
    const state = useAdminResource(
        "AdminPage_AdminBusiness_",
        config.apiUrl,
        `businesses?${filters.params}`,
    );
    return (
        <>
            <Filters filters={filters} placeholder={strings.admin.searchBusiness} />
            <Resource state={state}>
                {(data) => (
                    <RecordPanel>
                        <BusinessRecords items={data.items} />
                        <Pagination filters={filters} hasMore={data.has_more} />
                    </RecordPanel>
                )}
            </Resource>
        </>
    );
}
export function BusinessRecords({ items }: { items: AdminSchemas["AdminBusiness"][] }) {
    return (
        <Records
            items={items}
            columns={[
                {
                    label: strings.admin.business,
                    render: (b) => (
                        <>
                            <RecordLink to={`/businesses/${b.id}`}>{b.name}</RecordLink>
                            <div>
                                <Identifier value={b.id} />
                            </div>
                        </>
                    ),
                },
                { label: strings.admin.plan, render: (b) => adminLabel(b.plan ?? b.plan_status) },
                { label: strings.admin.status, render: (b) => <RecordStatus value={b.status} /> },
                {
                    label: strings.admin.created,
                    render: (b) => <When value={b.created_at} zone={b.timezone} />,
                },
            ]}
        />
    );
}
export function BusinessDetail() {
    const { id = "" } = useParams();
    const state = useAdminResource(
        "AdminBusinessDetail",
        config.apiUrl,
        `businesses/${encodeURIComponent(id)}`,
    );
    return (
        <Resource state={state}>
            {({ business: b, staff, clients, payments }) => (
                <>
                    <RecordLink to="/businesses">{strings.admin.back}</RecordLink>
                    <Panel title={b.name}>
                        <Facts
                            items={[
                                [strings.admin.identifier, <Identifier value={b.id} />],
                                [strings.admin.email, b.billing_email],
                                [strings.admin.status, adminLabel(b.status)],
                                [strings.admin.plan, adminLabel(b.plan ?? b.plan_status)],
                                [strings.admin.timezone, b.timezone],
                                [
                                    strings.admin.reference,
                                    <Identifier value={b.stripe_account_id} />,
                                ],
                                [
                                    strings.admin.charges,
                                    b.stripe_charges_enabled ? strings.admin.yes : strings.admin.no,
                                ],
                                [
                                    strings.admin.payouts,
                                    b.stripe_payouts_enabled ? strings.admin.yes : strings.admin.no,
                                ],
                            ]}
                        />
                    </Panel>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Stat label={strings.admin.clients} value={formatNumber(clients)} />
                        <Stat label={strings.admin.payments} value={formatNumber(payments)} />
                    </div>
                    <div className="flex flex-wrap gap-5">
                        <RecordLink to={`/people?business_id=${b.id}&kind=clients`}>
                            {strings.admin.viewClients}
                        </RecordLink>
                        <RecordLink to={`/payments?business_id=${b.id}`}>
                            {strings.admin.viewPayments}
                        </RecordLink>
                        <RecordLink to={`/activity?business_id=${b.id}`}>
                            {strings.admin.viewActivity}
                        </RecordLink>
                    </div>
                    <RecordPanel title={strings.admin.staff}>
                        <Records
                            items={staff}
                            columns={[
                                {
                                    label: strings.admin.name,
                                    render: (s) =>
                                        s.user_id ? (
                                            <RecordLink to={`/people/${s.user_id}`}>
                                                {s.name ?? s.user_id}
                                            </RecordLink>
                                        ) : (
                                            s.name
                                        ),
                                },
                                { label: strings.admin.role, render: (s) => adminLabel(s.role) },
                                {
                                    label: strings.admin.status,
                                    render: (s) => <RecordStatus value={s.status} />,
                                },
                            ]}
                        />
                    </RecordPanel>
                </>
            )}
        </Resource>
    );
}
