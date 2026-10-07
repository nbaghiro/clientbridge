import {
    earningStageIntent,
    formatMoney,
    formatShortDay,
    strings,
    useEarningApprovals,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    Checkbox,
    Empty,
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

const s = strings.earnings;

export function Earnings() {
    const e = useEarningApprovals(api);
    const openLink = useOpenLink();
    const sel = e.selected;
    const pendingIds = e.lines.filter((l) => l.status === "pending").map((l) => l.id);
    const allPicked = pendingIds.length > 0 && pendingIds.every((id) => e.picked.includes(id));

    if (e.load.state === "loading")
        return (
            <div className="space-y-6">
                <Skeleton variant="stat" count={3} columns={3} label={s.loading} />
                <Skeleton variant="row" count={5} label={s.loading} />
            </div>
        );
    if (e.load.state === "error")
        return <LoadFailed variant="card" onRetry={e.load.retry} retrying={e.load.retrying} />;
    if (e.load.state === "empty")
        return (
            <Empty
                variant="card"
                icon="user"
                message={s.noStaff}
                body={s.noStaffBody}
                actions={
                    <Button
                        variant="outline"
                        onPress={() => {
                            openLink("team");
                        }}
                    >
                        {s.openTeam}
                    </Button>
                }
            />
        );

    return (
        <div>
            <p className="text-sm text-muted">{s.subtitle}</p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat label={s.toApprove} cents={e.totals.pendingCents} />
                <Stat label={s.toPay} cents={e.totals.approvedCents} />
                <Stat label={s.paidYtd} cents={e.totals.paidYtdCents} tone="success" />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[300px_1fr]">
                <div className="self-start">
                    <Panel flush>
                        <div className="divide-y divide-line-soft">
                            {e.payees.map((p) => (
                                <ListRow
                                    key={p.staffId}
                                    leading={<Avatar name={p.name} color={p.color} />}
                                    selected={p.staffId === sel?.staffId}
                                    title={p.name}
                                    detail={p.title ?? undefined}
                                    meta={
                                        <span className="flex flex-col items-end gap-1">
                                            <span className="text-sm font-medium tabular-nums text-ink">
                                                {formatMoney(p.pendingCents)}
                                            </span>
                                            <span>{s.count(p.pendingCount)}</span>
                                        </span>
                                    }
                                    onPress={() => {
                                        e.select(p.staffId);
                                    }}
                                />
                            ))}
                        </div>
                    </Panel>
                </div>

                {sel === null ? (
                    <Panel>
                        <Empty message={s.choosePayee} />
                    </Panel>
                ) : (
                    <Panel flush>
                        <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
                            <Avatar name={sel.name} color={sel.color} size="lg" />
                            <div className="min-w-0 flex-1">
                                <h2 className="font-display text-lg font-bold text-ink">
                                    {sel.name}
                                </h2>
                                <p className="text-sm text-muted">
                                    {sel.rates === "" ? s.noRate : sel.rates}
                                </p>
                            </div>
                            <dl className="flex gap-6 text-right text-sm">
                                <div>
                                    <dt className="text-xs text-muted">{s.toApprove}</dt>
                                    <dd className="font-semibold tabular-nums text-warn-fg">
                                        {formatMoney(sel.pendingCents)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-muted">{s.toPay}</dt>
                                    <dd className="font-semibold tabular-nums text-accent-strong">
                                        {formatMoney(sel.approvedCents)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-muted">{s.paidYtd}</dt>
                                    <dd className="font-semibold tabular-nums text-ink">
                                        {formatMoney(sel.paidYtdCents)}
                                    </dd>
                                </div>
                            </dl>
                        </div>

                        <div className="flex items-center gap-3 border-b border-line bg-head px-5 py-2.5">
                            <Checkbox
                                label={s.selectAll}
                                value={allPicked}
                                mixed={e.picked.length > 0 && !allPicked}
                                disabled={pendingIds.length === 0}
                                onChange={e.pickAllPending}
                            />
                            <span className="ml-auto flex gap-2">
                                <Button
                                    size="sm"
                                    busy={e.busy}
                                    disabled={e.picked.length === 0}
                                    onPress={e.approvePicked}
                                >
                                    {e.busy ? s.working : s.approveSelected(e.picked.length)}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={sel.approvedCents === 0 || e.busy}
                                    onPress={e.payApproved}
                                >
                                    {s.payApproved(formatMoney(sel.approvedCents))}
                                </Button>
                            </span>
                        </div>
                        {e.error !== null ? (
                            <div className="px-5 pt-3">
                                <Notice tone="danger">{e.error}</Notice>
                            </div>
                        ) : null}

                        {e.lines.length === 0 ? (
                            <Empty message={s.noEarnings} />
                        ) : (
                            <ul className="divide-y divide-line-soft">
                                {e.lines.map((l) => (
                                    <li key={l.id} className="flex items-center gap-4 px-5 py-3">
                                        <span className="w-5">
                                            {l.status === "pending" ? (
                                                <Checkbox
                                                    label={`${l.title}, ${l.detail}`}
                                                    hideLabel
                                                    value={e.picked.includes(l.id)}
                                                    onChange={() => {
                                                        e.togglePick(l.id);
                                                    }}
                                                />
                                            ) : null}
                                        </span>
                                        <span className="w-14 shrink-0 text-xs text-muted">
                                            {formatShortDay(l.at)}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium text-ink">
                                                {l.title}
                                            </span>
                                            <span className="block truncate text-xs text-muted">
                                                {l.detail}
                                            </span>
                                        </span>
                                        <StatusPill
                                            status={s.stage[l.status] ?? l.status}
                                            intent={earningStageIntent(l.status)}
                                            asWritten
                                        />
                                        <span className="w-20 text-right text-sm font-semibold tabular-nums text-ink">
                                            {formatMoney(l.amountCents)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className="border-t border-line px-5 py-3 text-xs text-muted">
                            {s.paidVia}
                        </p>
                    </Panel>
                )}
            </div>
        </div>
    );
}
