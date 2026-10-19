import {
    type ChargeView,
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
    KeyValueList,
    ListRow,
    LoadFailed,
    Notice,
    Panel,
    Skeleton,
    Stat,
    StatusPill,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const s = strings.payouts;

export function Payouts() {
    const p = usePayouts(api);
    const account = usePaymentAccount(api);
    const setup = useSetupProgress();
    const openLink = useOpenLink();
    const connected = setup.steps.find((x) => x.key === "stripe")?.done ?? false;
    const sel = p.selected;
    if (account.props !== null) return <PaymentAccount {...account.props} />;
    const controls = (
        <div className="flex flex-wrap gap-2">
            <Button
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

    return (
        <div>
            <div className="mb-5">{controls}</div>
            <p className="text-sm text-muted">{s.subtitle}</p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

            <div className="mt-6 grid gap-6 xl:grid-cols-[340px_1fr]">
                <div className="self-start">
                    <Panel flush>
                        {p.payouts.length === 0 ? (
                            <Empty message={s.noPayouts} body={s.noPayoutsBody} />
                        ) : (
                            <div className="divide-y divide-line-soft">
                                {p.payouts.map((row) => (
                                    <ListRow
                                        key={row.id}
                                        icon={row.status === "failed" ? "alert" : "bank"}
                                        intent={
                                            row.status === "failed"
                                                ? "danger"
                                                : row.id === sel?.id
                                                  ? "accent"
                                                  : "neutral"
                                        }
                                        selected={row.id === sel?.id}
                                        title={
                                            <span className="tabular-nums">
                                                {formatMoney(row.amountCents, BUSINESS_CURRENCY)}
                                            </span>
                                        }
                                        detail={row.when}
                                        meta={
                                            <StatusPill
                                                status={s.status[row.status]}
                                                intent={payoutStatusIntent(row.status)}
                                            />
                                        }
                                        onPress={() => {
                                            p.select(row.id);
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                        {p.previous !== null ? (
                            <Button variant="outline" onPress={p.previous}>
                                {s.historyPrevious}
                            </Button>
                        ) : null}
                        {p.next !== null ? (
                            <Button variant="outline" onPress={p.next}>
                                {s.historyNext}
                            </Button>
                        ) : null}
                    </Panel>
                </div>

                <div className="space-y-6 self-start">
                    {sel !== null ? (
                        <Panel
                            title={formatMoney(sel.amountCents, BUSINESS_CURRENCY)}
                            subtitle={sel.when}
                            actions={
                                <StatusPill
                                    status={s.status[sel.status]}
                                    intent={payoutStatusIntent(sel.status)}
                                />
                            }
                        >
                            <div className="space-y-4">
                                {sel.status === "failed" ? (
                                    <Notice tone="danger" banner>
                                        {s.returnedNotice}
                                    </Notice>
                                ) : null}
                                {sel.ref !== null ? (
                                    <KeyValueList rows={[{ label: s.payoutRef, value: sel.ref }]} />
                                ) : null}
                                <Panel flush title={s.contentsTitle}>
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
                                        p.contents.rows.map((row) => (
                                            <ListRow
                                                key={row.id}
                                                title={row.title}
                                                detail={row.detail}
                                                meta={row.net}
                                            />
                                        ))
                                    )}
                                    {p.contents.previous !== null ? (
                                        <Button variant="outline" onPress={p.contents.previous}>
                                            {s.contentsPrevious}
                                        </Button>
                                    ) : null}
                                    {p.contents.next !== null ? (
                                        <Button variant="outline" onPress={p.contents.next}>
                                            {s.contentsNext}
                                        </Button>
                                    ) : null}
                                </Panel>
                            </div>
                        </Panel>
                    ) : null}
                    <Panel flush title={s.chargesTitle} subtitle={s.chargesHint}>
                        {p.charges.length === 0 ? (
                            <Empty message={s.noCharges} />
                        ) : (
                            <ChargeTable charges={p.charges} />
                        )}
                        {p.feesPending > 0 ? (
                            <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
                                {s.feePendingHint}
                            </p>
                        ) : null}
                    </Panel>
                </div>
            </div>
        </div>
    );
}

const head = "px-4 pb-2 pt-3 text-xs font-semibold uppercase tracking-wide text-muted";
const cell = "border-t border-line-soft px-4 py-2.5 text-right tabular-nums";

function ChargeTable({ charges }: { charges: ChargeView[] }) {
    return (
        <table className="w-full text-sm">
            <thead>
                <tr>
                    <th className={`${head} text-left`}>{s.colCharge}</th>
                    <th className={`${head} text-right`}>{s.colAmount}</th>
                    <th className={`${head} text-right`}>{s.colFees}</th>
                    <th className={`${head} text-right`}>{s.colNet}</th>
                </tr>
            </thead>
            <tbody>
                {charges.map((c) => (
                    <tr key={c.id}>
                        <td className="border-t border-line-soft px-4 py-2.5">
                            <p className="font-medium text-ink">{c.client}</p>
                            <p className="text-xs text-muted">
                                {formatParts([
                                    c.description,
                                    c.refundedCents > 0
                                        ? s.refunded(
                                              formatMoney(c.refundedCents, BUSINESS_CURRENCY),
                                          )
                                        : null,
                                ])}
                            </p>
                        </td>
                        <td className={`${cell} text-ink-soft`}>
                            {formatMoney(c.grossCents, BUSINESS_CURRENCY)}
                        </td>
                        <td className={`${cell} text-muted`}>
                            {c.feeCents === null ? (
                                <Badge label={s.feePending} intent="warning" />
                            ) : (
                                formatCredit(c.feeCents, BUSINESS_CURRENCY)
                            )}
                        </td>
                        <td className={`${cell} font-medium text-ink`}>
                            {formatMoney(c.netCents, BUSINESS_CURRENCY)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
