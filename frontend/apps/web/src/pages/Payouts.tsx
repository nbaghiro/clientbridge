import {
    formatMoney,
    payoutStatusIntent,
    strings,
    usePayouts,
    useSetupProgress,
    usePaymentAccount,
    formatParts,
    BUSINESS_CURRENCY,
    formatCredit,
} from "@clientbridge/app-core";
import {
    Badge,
    Button,
    PaymentAccount,
    Empty,
    DetailSection,
    KeyValueList,
    ListPage,
    ListRow,
    LoadFailed,
    Money,
    Notice,
    Skeleton,
    Stat,
    StatusPill,
    Tabs,
} from "@clientbridge/ui";
import { useState } from "react";

import { DeskBar, DeskPanel } from "../components/Desk";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const s = strings.payouts;
const PAYOUT_GRID = "grid grid-cols-[minmax(0,1.2fr)_8rem_minmax(0,1.4fr)_8rem] items-center gap-4";
const CHARGE_GRID = "grid grid-cols-[minmax(0,2fr)_8rem_8rem_8rem] items-center gap-4";

export function Payouts() {
    const p = usePayouts(api);
    const account = usePaymentAccount(api);
    const setup = useSetupProgress();
    const openLink = useOpenLink();
    const connected = setup.steps.find((x) => x.key === "stripe")?.done ?? false;
    const [view, setView] = useState<"payouts" | "charges">("payouts");
    const [open, setOpen] = useState(false);
    if (account.props !== null) return <PaymentAccount {...account.props} />;
    const controls = (
        <div className="flex flex-wrap gap-2">
            <Button
                size="sm"
                disabled={!account.ready}
                variant="outline"
                icon="bank"
                onPress={() => {
                    account.open("account");
                }}
            >
                {strings.paymentAccount.manage}
            </Button>
            <Button
                size="sm"
                disabled={!account.ready}
                variant="outline"
                onPress={() => {
                    account.open("payouts");
                }}
            >
                {strings.paymentAccount.viewPayouts}
            </Button>
        </div>
    );

    if (p.load.state === "loading")
        return (
            <div className="space-y-6">
                {controls}
                <Skeleton variant="stat" count={3} columns={3} label={s.loading} />
                <Skeleton variant="row" count={5} label={s.loading} />
            </div>
        );
    if (p.load.state === "error")
        return (
            <div className="space-y-6">
                {controls}
                <LoadFailed
                    variant="card"
                    message={s.loadError}
                    onRetry={p.load.retry}
                    retrying={p.load.retrying}
                />
            </div>
        );
    if (p.load.state === "empty" && !connected)
        return (
            <Empty
                variant="card"
                icon="bank"
                message={strings.business.getSetUp.tasks.stripe.label}
                body={strings.business.getSetUp.fresh.stripe}
                actions={
                    <Button
                        size="sm"
                        onPress={() => {
                            openLink("gettingPaid");
                        }}
                    >
                        {strings.business.getSetUp.start}
                    </Button>
                }
            />
        );
    if (p.load.state === "empty")
        return (
            <Empty
                variant="card"
                icon="bank"
                message={s.noPayouts}
                body={s.noPayoutsBody}
                actions={controls}
            />
        );

    const sel = open ? p.selected : null;
    return (
        <div className="@container space-y-6">
            <DeskBar
                switcher={
                    <Tabs
                        variant="pill"
                        label={s.tabPayouts}
                        items={[
                            { key: "payouts", label: s.tabPayouts },
                            { key: "charges", label: s.tabCharges },
                        ]}
                        active={view}
                        onSelect={setView}
                    />
                }
                summary={view === "charges" ? s.chargesHint : undefined}
                action={controls}
            />
            <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
                <Stat
                    currency={BUSINESS_CURRENCY}
                    label={s.inStripe}
                    cents={p.balanceCents}
                    hint={s.inStripeHint}
                />
                <Stat
                    currency={BUSINESS_CURRENCY}
                    label={s.deposited}
                    cents={p.depositedCents}
                    hint={s.depositedHint}
                    tone="success"
                />
                <Stat
                    currency={BUSINESS_CURRENCY}
                    label={s.fees}
                    cents={p.feesCents}
                    hint={s.feesHint}
                />
            </div>
            {view === "payouts" ? (
                <ListPage
                    head={
                        <div className={PAYOUT_GRID}>
                            <span>{s.colDate}</span>
                            <span>{s.colStatus}</span>
                            <span>{s.colRef}</span>
                            <span className="text-right">{s.colAmount}</span>
                        </div>
                    }
                    rows={p.payouts}
                    rowKey={(row) => row.id}
                    selectedKey={sel?.id}
                    onRowPress={(row) => {
                        p.select(row.id);
                        setOpen(true);
                    }}
                    state={
                        p.historyLoad.state === "loading"
                            ? "loading"
                            : p.historyLoad.state === "error"
                              ? "error"
                              : undefined
                    }
                    onRetry={p.historyLoad.retry}
                    empty={{ message: s.noPayouts, body: s.noPayoutsBody, icon: "bank" }}
                    footer={
                        p.previous !== null || p.next !== null ? (
                            <div className="flex justify-end gap-2">
                                {p.previous !== null ? (
                                    <Button size="sm" variant="outline" onPress={p.previous}>
                                        {s.historyPrevious}
                                    </Button>
                                ) : null}
                                {p.next !== null ? (
                                    <Button size="sm" variant="outline" onPress={p.next}>
                                        {s.historyNext}
                                    </Button>
                                ) : null}
                            </div>
                        ) : undefined
                    }
                    renderRow={(row) => (
                        <div className={PAYOUT_GRID}>
                            <span className="font-medium text-ink">{row.when}</span>
                            <span>
                                <StatusPill
                                    status={s.status[row.status]}
                                    intent={payoutStatusIntent(row.status)}
                                />
                            </span>
                            <span className="truncate font-mono text-xs text-muted">
                                {row.ref ?? s.dash}
                            </span>
                            <span className="text-right">
                                <Money
                                    currency={BUSINESS_CURRENCY}
                                    cents={row.amountCents}
                                    strong
                                />
                            </span>
                        </div>
                    )}
                />
            ) : (
                <ListPage
                    head={
                        <div className={CHARGE_GRID}>
                            <span>{s.colCharge}</span>
                            <span className="text-right">{s.colAmount}</span>
                            <span className="text-right">{s.colFees}</span>
                            <span className="text-right">{s.colNet}</span>
                        </div>
                    }
                    rows={p.charges}
                    rowKey={(c) => c.id}
                    empty={s.noCharges}
                    footer={
                        p.feesPending > 0 ? (
                            <p className="text-xs text-muted">{s.feePendingHint}</p>
                        ) : undefined
                    }
                    renderRow={(c) => (
                        <div className={CHARGE_GRID}>
                            <span className="min-w-0">
                                <span className="block truncate font-medium text-ink">
                                    {c.client}
                                </span>
                                <span className="block truncate text-xs text-muted">
                                    {formatParts([
                                        c.description,
                                        c.refundedCents > 0
                                            ? s.refunded(
                                                  formatMoney(c.refundedCents, BUSINESS_CURRENCY),
                                              )
                                            : null,
                                    ])}
                                </span>
                            </span>
                            <span className="text-right tabular-nums text-ink-soft">
                                {formatMoney(c.grossCents, BUSINESS_CURRENCY)}
                            </span>
                            <span className="text-right tabular-nums text-muted">
                                {c.feeCents === null ? (
                                    <Badge label={s.feePending} intent="warning" />
                                ) : (
                                    formatCredit(c.feeCents, BUSINESS_CURRENCY)
                                )}
                            </span>
                            <span className="text-right font-medium tabular-nums text-ink">
                                {formatMoney(c.netCents, BUSINESS_CURRENCY)}
                            </span>
                        </div>
                    )}
                />
            )}
            {sel !== null ? (
                <DeskPanel
                    title={formatMoney(sel.amountCents, BUSINESS_CURRENCY)}
                    subtitle={sel.when}
                    status={{
                        status: s.status[sel.status],
                        intent: payoutStatusIntent(sel.status),
                    }}
                    onClose={() => {
                        setOpen(false);
                    }}
                >
                    <div className="space-y-5">
                        {sel.status === "failed" ? (
                            <Notice tone="danger" banner>
                                {s.returnedNotice}
                            </Notice>
                        ) : null}
                        {sel.ref !== null ? (
                            <KeyValueList rows={[{ label: s.payoutRef, value: sel.ref }]} />
                        ) : null}
                        <DetailSection title={s.contentsTitle}>
                            {p.contents.load.state === "loading" ? (
                                <Skeleton variant="row" count={3} label={s.loading} />
                            ) : p.contents.load.state === "error" ? (
                                <LoadFailed
                                    message={s.loadError}
                                    onRetry={p.contents.load.retry}
                                    retrying={p.contents.load.retrying}
                                />
                            ) : p.contents.status !== "available" ? (
                                <Notice tone="info" banner>
                                    {p.contents.status === "pending"
                                        ? s.contentsPending
                                        : s.contentsUnavailable}
                                </Notice>
                            ) : p.contents.rows.length === 0 ? (
                                <Empty message={s.contentsEmpty} />
                            ) : (
                                <div className="divide-y divide-line-soft">
                                    {p.contents.rows.map((row) => (
                                        <ListRow
                                            key={row.id}
                                            title={row.title}
                                            detail={row.detail}
                                            meta={row.net}
                                        />
                                    ))}
                                </div>
                            )}
                            {p.contents.previous !== null || p.contents.next !== null ? (
                                <div className="mt-3 flex justify-end gap-2">
                                    {p.contents.previous !== null ? (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onPress={p.contents.previous}
                                        >
                                            {s.contentsPrevious}
                                        </Button>
                                    ) : null}
                                    {p.contents.next !== null ? (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onPress={p.contents.next}
                                        >
                                            {s.contentsNext}
                                        </Button>
                                    ) : null}
                                </div>
                            ) : null}
                        </DetailSection>
                    </div>
                </DeskPanel>
            ) : null}
        </div>
    );
}
