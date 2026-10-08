import { type GettingPaidView, formatDate, strings, useGettingPaid } from "@clientbridge/app-core";
import {
    Button,
    PaymentAccount,
    Empty,
    Icon,
    KeyValueList,
    LoadFailed,
    Money,
    Panel,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";

import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { api } from "../lib/api";

const g = strings.gettingPaid;

function Hero({ paid }: { paid: GettingPaidView }) {
    const warn = paid.phase !== "enabled";
    const act = paid.phase === "restricted" || paid.phase === "in_progress";
    return (
        <section
            className={`rounded-lg border p-5 ${warn ? "border-warn-fg/25 bg-warn-bg" : "border-line bg-surface shadow-card"}`}
        >
            <div className="flex items-start gap-4">
                <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${warn ? "bg-surface text-warn-fg" : "bg-ok-bg text-ok-fg"}`}
                >
                    <Icon name={warn ? "alert" : "checkCircle"} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="font-display text-lg font-bold text-ink">{paid.title}</h2>
                    <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-soft">
                        {paid.message}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                            variant="outline"
                            icon="bank"
                            disabled={!paid.account.ready}
                            onPress={() => {
                                paid.account.open("account");
                            }}
                        >
                            {strings.paymentAccount.manage}
                        </Button>
                        {act ? (
                            <Button
                                disabled={!paid.account.ready}
                                onPress={paid.finish}
                                icon="card"
                            >
                                {g.finish}
                            </Button>
                        ) : null}
                        <Button variant="outline" onPress={paid.refresh} busy={paid.refreshing}>
                            {paid.refreshing ? g.checking : g.refresh}
                        </Button>
                    </div>
                </div>
            </div>
        </section>
    );
}

function Body({ paid }: { paid: GettingPaidView }) {
    const deadline = paid.deadline === null ? "" : formatDate(paid.deadline);
    return (
        <div className="space-y-6">
            <Hero paid={paid} />
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <div className="self-start">
                    <Panel flush title={g.whatsNeeded}>
                        {paid.requirements.length === 0 ? (
                            <p className="px-4 py-4 text-sm text-muted">{g.nothingNeeded}</p>
                        ) : (
                            <ul className="divide-y divide-line-soft">
                                {paid.requirements.map((r) => (
                                    <li key={r.key} className="flex gap-3 px-4 py-3.5">
                                        <span
                                            className={`mt-0.5 ${r.pastDue ? "text-danger" : "text-warn-fg"}`}
                                        >
                                            <Icon name={r.icon} size={18} />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-ink">
                                                {r.label}
                                            </p>
                                            {r.why !== "" ? (
                                                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                                                    {r.why}
                                                </p>
                                            ) : null}
                                        </div>
                                        <span className="shrink-0">
                                            <StatusPill
                                                asWritten
                                                status={
                                                    r.pastDue
                                                        ? g.pastDue
                                                        : deadline === ""
                                                          ? g.dueSoon
                                                          : g.due(deadline)
                                                }
                                                intent={r.pastDue ? "danger" : "warning"}
                                            />
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-muted">
                            <Icon name="shield" size={14} />
                            {g.help}
                        </p>
                    </Panel>
                </div>
                <div className="space-y-6">
                    <Panel title={g.capabilities}>
                        <KeyValueList
                            rows={[
                                {
                                    label: g.capCards,
                                    value: paid.chargesEnabled ? g.capOn : g.capOff,
                                    intent: paid.chargesEnabled ? "success" : "warning",
                                },
                                {
                                    label: g.capTap,
                                    value: paid.chargesEnabled ? g.capOn : g.capOff,
                                    intent: paid.chargesEnabled ? "success" : "warning",
                                },
                                {
                                    label: g.capPayouts,
                                    value: paid.payoutsEnabled ? g.capOn : g.capOff,
                                    intent: paid.payoutsEnabled ? "success" : "warning",
                                },
                            ]}
                        />
                    </Panel>
                    <Panel title={g.balance}>
                        <KeyValueList
                            rows={[
                                {
                                    label: paid.payoutsEnabled ? g.available : g.held,
                                    value:
                                        paid.availableCents === null ? (
                                            g.balanceUnknown
                                        ) : (
                                            <Money cents={paid.availableCents} />
                                        ),
                                },
                            ]}
                        />
                    </Panel>
                </div>
            </div>
        </div>
    );
}

export function GettingPaid() {
    const paid = useGettingPaid(api);
    const [params, setParams] = useSearchParams();
    const handled = useRef(false);
    useEffect(() => {
        if (params.get("manage") !== "account") {
            handled.current = false;
            return;
        }
        if (
            handled.current ||
            !paid.account.ready ||
            paid.phase === "loading" ||
            paid.phase === "error"
        )
            return;
        handled.current = true;
        paid.account.open(paid.phase === "not_connected" ? "onboarding" : "account");
        setParams(
            (current) => {
                const next = new URLSearchParams(current);
                next.delete("manage");
                return next;
            },
            { replace: true },
        );
    }, [params, setParams, paid.phase, paid.account]);
    if (paid.account.props !== null) return <PaymentAccount {...paid.account.props} />;

    return (
        <div>
            <p className="mt-1 text-sm text-muted">{g.subtitle}</p>
            <div className="mt-6">
                {paid.phase === "loading" ? (
                    <div className="space-y-6">
                        <Panel flush>
                            <Skeleton variant="line" count={3} label={g.loadingStatus} />
                        </Panel>
                        <Panel flush>
                            <Skeleton variant="row" count={3} label={g.loadingStatus} />
                        </Panel>
                    </div>
                ) : paid.phase === "error" ? (
                    <Panel flush>
                        <LoadFailed
                            message={g.loadError}
                            retrying={paid.refreshing}
                            onRetry={paid.refresh}
                        />
                    </Panel>
                ) : paid.phase === "not_connected" ? (
                    <Panel flush>
                        <Empty
                            icon="card"
                            message={g.connectTitle}
                            body={paid.message}
                            actions={
                                <Button
                                    disabled={!paid.account.ready}
                                    onPress={paid.finish}
                                    icon="card"
                                >
                                    {g.connect}
                                </Button>
                            }
                        />
                    </Panel>
                ) : (
                    <Body paid={paid} />
                )}
            </div>
        </div>
    );
}
