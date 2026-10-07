import {
    type ChargeView,
    formatMoney,
    payoutStatusIntent,
    strings,
    usePayouts,
} from "@clientbridge/app-core";
import {
    Badge,
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

const s = strings.payouts;

export function Payouts() {
    const p = usePayouts();
    const sel = p.selected;

    if (p.load.state === "loading")
        return (
            <div className="space-y-6">
                <Skeleton variant="stat" count={3} columns={3} label={s.loading} />
                <Skeleton variant="row" count={5} label={s.loading} />
            </div>
        );
    if (p.load.state === "error")
        return (
            <LoadFailed
                variant="card"
                message={s.loadError}
                onRetry={p.load.retry}
                retrying={p.load.retrying}
            />
        );
    if (p.load.state === "empty")
        return <Empty variant="card" icon="bank" message={s.noPayouts} body={s.noPayoutsBody} />;

    return (
        <div>
            <p className="text-sm text-muted">{s.subtitle}</p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat label={s.inStripe} cents={p.balanceCents} hint={s.inStripeHint} />
                <Stat
                    label={s.deposited}
                    cents={p.depositedCents}
                    hint={s.depositedHint}
                    tone="success"
                />
                <Stat label={s.fees} cents={p.feesCents} hint={s.feesHint} />
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
                                                {formatMoney(row.amountCents)}
                                            </span>
                                        }
                                        detail={row.when}
                                        meta={
                                            <StatusPill
                                                status={s.status[row.status] ?? row.status}
                                                intent={payoutStatusIntent(row.status)}
                                                asWritten
                                            />
                                        }
                                        onPress={() => {
                                            p.select(row.id);
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </Panel>
                </div>

                <div className="space-y-6 self-start">
                    {sel !== null ? (
                        <Panel
                            title={formatMoney(sel.amountCents)}
                            subtitle={sel.when}
                            actions={
                                <StatusPill
                                    status={s.status[sel.status] ?? sel.status}
                                    intent={payoutStatusIntent(sel.status)}
                                    asWritten
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
                                <Notice tone="info" banner>
                                    {s.settledNotice}
                                </Notice>
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
                                {c.description}
                                {c.refundedCents > 0
                                    ? ` · ${s.refunded(formatMoney(c.refundedCents))}`
                                    : ""}
                            </p>
                        </td>
                        <td className={`${cell} text-ink-soft`}>{formatMoney(c.grossCents)}</td>
                        <td className={`${cell} text-muted`}>
                            {c.feeCents === null ? (
                                <Badge label={s.feePending} intent="warning" />
                            ) : (
                                `−${formatMoney(c.feeCents)}`
                            )}
                        </td>
                        <td className={`${cell} font-medium text-ink`}>
                            {formatMoney(c.netCents)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
