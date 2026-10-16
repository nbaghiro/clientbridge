import { useParams, useSearchParams } from "react-router-dom";
import {
    formatMoney,
    adminLabel,
    strings,
    useAdminFilters,
    useAdminResource,
    type AdminSchemas,
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

export function Payments() {
    const [params] = useSearchParams();
    const filters = useAdminFilters(
        params.get("business_id") ?? "",
        params.get("q") ?? "",
        params.get("status") ?? "",
    );
    const state = useAdminResource(
        "AdminPage_AdminPayment_",
        config.apiUrl,
        `payments?${filters.params}`,
    );
    return (
        <>
            <Filters
                filters={filters}
                placeholder={strings.admin.searchPayments}
                scoped
                statuses={["pending", "succeeded", "failed", "canceled"]}
            />
            <Resource state={state}>
                {(data) => (
                    <RecordPanel>
                        <PaymentRecords items={data.items} />
                        <Pagination filters={filters} hasMore={data.has_more} />
                    </RecordPanel>
                )}
            </Resource>
        </>
    );
}
function PaymentRecords({ items }: { items: AdminSchemas["AdminPayment"][] }) {
    return (
        <Records
            items={items}
            columns={[
                {
                    label: strings.admin.amount,
                    render: (p) => (
                        <RecordLink to={`/payments/${p.id}`}>
                            {formatMoney(p.amount_cents, p.currency)}
                        </RecordLink>
                    ),
                },
                {
                    label: strings.admin.business,
                    render: (p) => (
                        <RecordLink to={`/businesses/${p.business_id}`}>
                            {p.business_name ?? p.business_id}
                        </RecordLink>
                    ),
                },
                { label: strings.admin.kind, render: (p) => adminLabel(p.kind) },
                { label: strings.admin.status, render: (p) => <RecordStatus value={p.status} /> },
                { label: strings.admin.method, render: (p) => adminLabel(p.method) },
                {
                    label: strings.admin.reference,
                    render: (p) => <Identifier value={p.provider_ref ?? p.id} />,
                },
                { label: strings.admin.recorded, render: (p) => <When value={p.created_at} /> },
            ]}
        />
    );
}
export function PaymentDetail() {
    const { id = "" } = useParams();
    const state = useAdminResource(
        "AdminPaymentDetail",
        config.apiUrl,
        `payments/${encodeURIComponent(id)}`,
    );
    return (
        <Resource state={state}>
            {({ payment: p, business, client, refunds, entries, stripe_url }) => (
                <>
                    <RecordLink to="/payments">{strings.admin.back}</RecordLink>
                    <Panel
                        title={formatMoney(p.amount_cents, p.currency)}
                        subtitle={p.id}
                        actions={
                            stripe_url ? (
                                <a
                                    className="font-medium text-accent hover:underline"
                                    href={stripe_url}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    {strings.admin.stripe}
                                </a>
                            ) : undefined
                        }
                    >
                        <Facts
                            items={[
                                [strings.admin.status, adminLabel(p.status)],
                                [strings.admin.kind, adminLabel(p.kind)],
                                [
                                    strings.admin.business,
                                    <RecordLink to={`/businesses/${business.id}`}>
                                        {business.name}
                                    </RecordLink>,
                                ],
                                [strings.admin.client, client?.name],
                                [strings.admin.method, adminLabel(p.method)],
                                [strings.admin.provider, adminLabel(p.provider)],
                                [strings.admin.reference, <Identifier value={p.provider_ref} />],
                                [strings.admin.invoice, <Identifier value={p.invoice_id} />],
                                [strings.admin.order, <Identifier value={p.order_id} />],
                                [strings.admin.booking, <Identifier value={p.booking_id} />],
                                [
                                    strings.admin.parentPayment,
                                    p.parent_payment_id ? (
                                        <RecordLink to={`/payments/${p.parent_payment_id}`}>
                                            {p.parent_payment_id}
                                        </RecordLink>
                                    ) : null,
                                ],
                                [strings.admin.recorded, <When value={p.created_at} />],
                            ]}
                        />
                    </Panel>
                    <RecordLink to={`/activity?business_id=${business.id}&q=${p.id}`}>
                        {strings.admin.viewActivity}
                    </RecordLink>
                    <RecordPanel title={strings.admin.refunds}>
                        <PaymentRecords items={refunds} />
                    </RecordPanel>
                    <RecordPanel title={strings.admin.ledger}>
                        <Records
                            items={entries}
                            columns={[
                                { label: strings.admin.event, render: (e) => e.event },
                                {
                                    label: strings.admin.amount,
                                    render: (e) => formatMoney(e.amount_cents, e.currency),
                                },
                                {
                                    label: strings.admin.journal,
                                    render: (e) => <Identifier value={e.journal_id} />,
                                },
                                {
                                    label: strings.admin.account,
                                    render: (e) => (
                                        <>
                                            {e.account_category}
                                            <div>
                                                <Identifier value={e.account_id} />
                                            </div>
                                        </>
                                    ),
                                },
                                {
                                    label: strings.admin.recorded,
                                    render: (e) => <When value={e.occurred_at} />,
                                },
                            ]}
                        />
                    </RecordPanel>
                </>
            )}
        </Resource>
    );
}
