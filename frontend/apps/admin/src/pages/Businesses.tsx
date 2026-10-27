import { useParams } from "react-router-dom";
import {
    BUSINESS_CURRENCY,
    formatMoney,
    formatNumber,
    adminEditionOptions,
    adminLabel,
    strings,
    useAdminDriftForm,
    useAdminEditionForm,
    useAdminFilters,
    useAdminResource,
    type AdminSchemas,
} from "@clientbridge/app-core/public";
import { Button, Notice, Panel, Select, Stat, TextField } from "@clientbridge/ui";
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
function EditionPanel({ business }: { business: AdminSchemas["AdminBusiness"] }) {
    const form = useAdminEditionForm(config.apiUrl, business);
    return (
        <Panel>
            <Facts items={[[strings.admin.edition, strings.admin.editionOption(form.current)]]} />
            <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-60 flex-1">
                    <Select
                        label={strings.admin.changeEdition}
                        hint={strings.admin.editionHint}
                        value={form.value}
                        options={adminEditionOptions()}
                        onChange={form.setValue}
                        disabled={form.busy}
                    />
                </div>
                <Button disabled={!form.changed} busy={form.busy} onPress={form.save}>
                    {strings.admin.saveEdition}
                </Button>
            </div>
            {form.outcome === "saved" ? (
                <Notice tone="success">{strings.admin.editionSaved}</Notice>
            ) : form.outcome === "failed" ? (
                <Notice tone="danger">{strings.admin.editionError}</Notice>
            ) : null}
        </Panel>
    );
}

function DriftAcknowledgement({ form }: { form: ReturnType<typeof useAdminDriftForm> }) {
    if (form.findingId === null) {
        if (form.outcome === "saved")
            return <Notice tone="success">{strings.admin.acknowledgementSaved}</Notice>;
        if (form.outcome === "stale")
            return <Notice tone="info">{strings.admin.acknowledgementStale}</Notice>;
        return null;
    }
    return (
        <div className="flex flex-col gap-3 border-t border-line p-4">
            <TextField
                label={strings.admin.acknowledgeReason}
                hint={strings.admin.acknowledgeHint}
                value={form.reason}
                onChange={form.setReason}
                onSubmit={form.save}
            />
            <div className="flex flex-wrap gap-2">
                <Button disabled={!form.ready} busy={form.busy} onPress={form.save}>
                    {strings.admin.saveAcknowledgement}
                </Button>
                <Button
                    variant="outline"
                    disabled={form.busy}
                    onPress={() => {
                        form.choose(null);
                    }}
                >
                    {strings.admin.cancel}
                </Button>
            </div>
            {form.outcome === "failed" ? (
                <Notice tone="danger">{strings.admin.acknowledgementError}</Notice>
            ) : null}
        </div>
    );
}

function DriftPanel({ business }: { business: AdminSchemas["AdminBusiness"] }) {
    const state = useAdminResource(
        "AdminPage_AdminDriftFinding_",
        config.apiUrl,
        `businesses/${encodeURIComponent(business.id)}/drift`,
    );
    const form = useAdminDriftForm(config.apiUrl, business.id, state.refresh);
    const cents = (value: number | null) =>
        value === null ? strings.admin.none : formatMoney(value, BUSINESS_CURRENCY);
    return (
        <RecordPanel title={strings.admin.drift}>
            <p className="px-4 pt-4 text-sm text-muted">{strings.admin.driftHint}</p>
            <Resource state={state}>
                {(data) => (
                    <Records
                        items={data.items}
                        columns={[
                            {
                                label: strings.admin.driftSource,
                                render: (f) =>
                                    f.source === "balance" ? (
                                        strings.admin.driftBalance
                                    ) : (
                                        <Identifier value={f.source} />
                                    ),
                            },
                            {
                                label: strings.admin.driftFound,
                                render: (f) => (
                                    <When value={f.created_at} zone={business.timezone} />
                                ),
                            },
                            {
                                label: strings.admin.driftLedger,
                                render: (f) => cents(f.ledger_cents),
                            },
                            {
                                label: strings.admin.driftStripe,
                                render: (f) => cents(f.stripe_cents),
                            },
                            {
                                label: strings.admin.driftAcknowledged,
                                render: (f) =>
                                    f.acknowledgement ? (
                                        <>
                                            <div className="break-words">
                                                {f.acknowledgement.reason}
                                            </div>
                                            <When
                                                value={f.acknowledgement.acknowledged_at}
                                                zone={business.timezone}
                                            />
                                        </>
                                    ) : (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={form.busy}
                                            onPress={() => {
                                                form.choose(f.id);
                                            }}
                                        >
                                            {strings.admin.acknowledge}
                                        </Button>
                                    ),
                            },
                        ]}
                    />
                )}
            </Resource>
            <DriftAcknowledgement form={form} />
        </RecordPanel>
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
                    <EditionPanel business={b} />
                    <DriftPanel business={b} />
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
