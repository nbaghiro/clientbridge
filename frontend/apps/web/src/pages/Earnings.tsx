import {
    earningStageIntent,
    formatMoney,
    formatShortDay,
    strings,
    useEarningApprovals,
    formatList,
    formatParts,
    BUSINESS_CURRENCY,
    useBusinessZone,
    usePeoplePhotos,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    Checkbox,
    Empty,
    KeyValueList,
    ListPage,
    LoadFailed,
    Notice,
    Skeleton,
    Stat,
    StatusPill,
} from "@clientbridge/ui";

import { type ReactNode, useState } from "react";

import { DeskPanel } from "../components/Desk";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const s = strings.earnings;
const GRID = "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.6fr)_8rem_8rem_8rem] items-center gap-4";

export function Earnings() {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const e = useEarningApprovals(api);
    const openLink = useOpenLink();
    const sel = e.selected;
    const pendingIds = e.lines.filter((l) => l.status === "pending").map((l) => l.id);
    const allPicked = pendingIds.length > 0 && pendingIds.every((id) => e.picked.includes(id));
    const [open, setOpen] = useState(false);

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

    const money = (cents: number, tone = "text-ink"): ReactNode => (
        <span
            className={`text-right font-medium tabular-nums ${cents === 0 ? "text-muted" : tone}`}
        >
            {formatMoney(cents, BUSINESS_CURRENCY)}
        </span>
    );
    return (
        <div className="@container space-y-6">
            {e.totals.pendingCents + e.totals.approvedCents + e.totals.paidYtdCents === 0 ? null : (
                <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
                    <Stat
                        currency={BUSINESS_CURRENCY}
                        label={s.toApprove}
                        cents={e.totals.pendingCents}
                        tone={e.totals.pendingCents > 0 ? "warning" : "ink"}
                    />
                    <Stat
                        currency={BUSINESS_CURRENCY}
                        label={s.toPay}
                        cents={e.totals.approvedCents}
                    />
                    <Stat
                        currency={BUSINESS_CURRENCY}
                        label={s.paidYtd}
                        cents={e.totals.paidYtdCents}
                        tone="success"
                    />
                </div>
            )}
            <ListPage
                head={
                    <div className={GRID}>
                        <span>{s.colMember}</span>
                        <span>{s.colPay}</span>
                        <span className="text-right">{s.toApprove}</span>
                        <span className="text-right">{s.toPay}</span>
                        <span className="text-right">{s.paidYtd}</span>
                    </div>
                }
                rows={e.payees}
                rowKey={(p) => p.staffId}
                selectedKey={open ? sel?.staffId : undefined}
                onRowPress={(p) => {
                    e.select(p.staffId);
                    setOpen(true);
                }}
                empty={s.noStaff}
                renderRow={(p) => (
                    <div className={GRID}>
                        <span className="flex min-w-0 items-center gap-3">
                            <Avatar
                                name={p.name}
                                src={photos.staff(p.staffId)}
                                color={p.color}
                                size="sm"
                            />
                            <span className="min-w-0">
                                <span className="block truncate font-medium text-ink">
                                    {p.name}
                                </span>
                                {p.title !== null ? (
                                    <span className="block truncate text-xs text-muted">
                                        {p.title}
                                    </span>
                                ) : null}
                            </span>
                        </span>
                        <span className="truncate text-ink-soft">
                            {p.rates === "" ? s.noRate : p.rates}
                        </span>
                        <span className="flex flex-col items-end">
                            {money(p.pendingCents, "text-warn-fg")}
                            {p.pendingCount > 0 ? (
                                <span className="text-xs text-muted">
                                    {s.count(p.pendingCount)}
                                </span>
                            ) : null}
                        </span>
                        {money(p.approvedCents)}
                        {money(p.paidYtdCents)}
                    </div>
                )}
            />
            {open && sel !== null ? (
                <DeskPanel
                    title={sel.name}
                    subtitle={sel.rates === "" ? s.noRate : sel.rates}
                    leading={
                        <Avatar name={sel.name} src={photos.staff(sel.staffId)} color={sel.color} />
                    }
                    onClose={() => {
                        setOpen(false);
                    }}
                    actions={
                        <>
                            <Button
                                variant="outline"
                                disabled={sel.approvedCents === 0 || e.busy}
                                onPress={e.payApproved}
                            >
                                {s.payApproved(formatMoney(sel.approvedCents, BUSINESS_CURRENCY))}
                            </Button>
                            <Button
                                busy={e.busy}
                                disabled={e.picked.length === 0}
                                onPress={e.approvePicked}
                            >
                                {e.busy ? s.working : s.approveSelected(e.picked.length)}
                            </Button>
                        </>
                    }
                >
                    <div className="space-y-5">
                        <div className="rounded-md border border-line bg-bg px-4 py-3">
                            <KeyValueList
                                layout="stack"
                                columns={3}
                                rows={[
                                    {
                                        label: s.toApprove,
                                        value: formatMoney(sel.pendingCents, BUSINESS_CURRENCY),
                                        intent: sel.pendingCents > 0 ? "warning" : undefined,
                                    },
                                    {
                                        label: s.toPay,
                                        value: formatMoney(sel.approvedCents, BUSINESS_CURRENCY),
                                    },
                                    {
                                        label: s.paidYtd,
                                        value: formatMoney(sel.paidYtdCents, BUSINESS_CURRENCY),
                                    },
                                ]}
                            />
                        </div>
                        {e.error !== null ? <Notice tone="danger">{e.error}</Notice> : null}
                        {e.lines.length === 0 ? (
                            <Empty message={s.noEarnings} />
                        ) : (
                            <div>
                                <div className="border-b border-line pb-2">
                                    <Checkbox
                                        label={s.selectAll}
                                        value={allPicked}
                                        mixed={e.picked.length > 0 && !allPicked}
                                        disabled={pendingIds.length === 0}
                                        onChange={e.pickAllPending}
                                    />
                                </div>
                                <ul className="divide-y divide-line-soft">
                                    {e.lines.map((l) => (
                                        <li key={l.id} className="flex items-center gap-3 py-3">
                                            <span className="w-5 shrink-0">
                                                {l.status === "pending" ? (
                                                    <Checkbox
                                                        label={formatList(
                                                            [l.title, l.detail],
                                                            "unit",
                                                        )}
                                                        hideLabel
                                                        value={e.picked.includes(l.id)}
                                                        onChange={() => {
                                                            e.togglePick(l.id);
                                                        }}
                                                    />
                                                ) : null}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-medium text-ink">
                                                    {l.title}
                                                </span>
                                                <span className="block truncate text-xs text-muted">
                                                    {formatParts([
                                                        formatShortDay(l.at, zone),
                                                        l.detail,
                                                    ])}
                                                </span>
                                            </span>
                                            <StatusPill
                                                status={s.stage[l.status] ?? l.status}
                                                intent={earningStageIntent(l.status)}
                                            />
                                            <span className="w-20 text-right text-sm font-semibold tabular-nums text-ink">
                                                {formatMoney(l.amountCents, BUSINESS_CURRENCY)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <p className="text-xs text-muted">{s.paidVia}</p>
                    </div>
                </DeskPanel>
            ) : null}
        </div>
    );
}
