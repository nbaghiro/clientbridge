import {
    canManagePayments,
    currencyAffix,
    earningStageIntent,
    formatMoney,
    formatShortDay,
    runCsvFile,
    strings,
    useAdjustmentForm,
    useStatementHeader,
    useEarningApprovals,
    useMyEarnings,
    useStaffPayFile,
    formatParts,
    BUSINESS_CURRENCY,
    EARNINGS_VIEWS,
    type EarningsView,
    useBusinessZone,
    usePeoplePhotos,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    Checkbox,
    Choice,
    DateField,
    Empty,
    KeyValueList,
    ListPage,
    LoadFailed,
    Modal,
    Notice,
    Panel,
    Skeleton,
    Stat,
    StatusPill,
    TextField,
} from "@clientbridge/ui";

import { type ReactNode, useState } from "react";

import { DeskBar, DeskPanel } from "../components/Desk";
import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { saveFile } from "../lib/files";
import { useOpenLink } from "../lib/links";
import { usePrintSheet } from "../lib/print";

const s = strings.earnings;
const GRID = "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.6fr)_8rem_8rem_8rem] items-center gap-4";

type Group = ReturnType<typeof useEarningApprovals>["paidGroups"][number];
type Line = Group["lines"][number];

export function Earnings() {
    const viewer = useViewer();
    return canManagePayments(viewer?.role ?? null) ? (
        <TeamPay staffId={viewer?.staffId ?? null} owner={viewer?.role === "owner"} />
    ) : (
        <MyPay staffId={viewer?.staffId ?? null} />
    );
}

function MyPay({ staffId }: { staffId: string | null }) {
    const zone = useBusinessZone();
    const m = useMyEarnings(staffId);
    const printing = useStatementPrint();
    if (m.load.state === "loading") return <Skeleton variant="row" count={5} label={s.loading} />;
    if (m.load.state === "error")
        return <LoadFailed variant="card" onRetry={m.load.retry} retrying={m.load.retrying} />;
    if (m.load.state === "empty")
        return <Empty variant="card" icon="dollar" message={s.mine.empty} />;
    return (
        <div className="@container space-y-6">
            <p className="text-sm text-muted">{s.mine.subtitle}</p>
            <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
                <Stat currency={BUSINESS_CURRENCY} label={s.toApprove} cents={m.pendingCents} />
                <Stat currency={BUSINESS_CURRENCY} label={s.toPay} cents={m.approvedCents} />
                <Stat
                    currency={BUSINESS_CURRENCY}
                    label={s.paidYtd}
                    cents={m.paidYtdCents}
                    tone="success"
                />
            </div>
            <Panel
                actions={
                    <Choice<"todo" | "paid">
                        layout="segmented"
                        label={s.viewLabel}
                        options={[
                            { key: "todo", label: s.view.todo },
                            { key: "paid", label: s.view.paid },
                        ]}
                        value={m.view}
                        onChange={m.setView}
                    />
                }
            >
                {m.view === "paid" ? (
                    m.paidGroups.length === 0 ? (
                        <Empty message={s.mine.noPaid} />
                    ) : (
                        <div className="space-y-5">
                            {m.paidGroups.map((g) => (
                                <PaidRun
                                    key={g.key}
                                    group={g}
                                    zone={zone}
                                    onPrint={() => {
                                        printing.print(g, m.name);
                                    }}
                                />
                            ))}
                        </div>
                    )
                ) : m.lines.length === 0 ? (
                    <Empty message={s.mine.noEarnings} />
                ) : (
                    <EarningRows lines={m.lines} zone={zone} />
                )}
            </Panel>
            {printing.sheet}
        </div>
    );
}

function TeamPay({ staffId, owner }: { staffId: string | null; owner: boolean }) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const e = useEarningApprovals(api, { staffId, owner });
    const openLink = useOpenLink();
    const sel = e.selected;
    const printing = useStatementPrint();
    const file = useStaffPayFile(api, (csv, name) => {
        saveFile(new Blob([csv], { type: "text/csv" }), name);
    });
    const [open, setOpen] = useState(false);
    const [adjusting, setAdjusting] = useState(false);

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
    const day = (value: string | null, set: (day: string | null) => void, label: string) => (
        <DateField
            label={label}
            zone={zone}
            size="sm"
            width="auto"
            value={value ?? ""}
            onChange={(d) => {
                set(d === "" ? null : d);
            }}
        />
    );
    return (
        <div className="@container space-y-6">
            <DeskBar summary={e.summary} />
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
                                {p.owesBackCents > 0 ? (
                                    <span className="block truncate text-xs text-warn-fg">
                                        {s.owesBack(
                                            formatMoney(p.owesBackCents, BUSINESS_CURRENCY),
                                        )}
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
                        e.editable ? (
                            <>
                                <Button
                                    variant="quiet"
                                    icon="plus"
                                    onPress={() => {
                                        setAdjusting(true);
                                    }}
                                >
                                    {s.addAdjustment}
                                </Button>
                                <Button
                                    variant="outline"
                                    busy={e.busy === "pay"}
                                    disabled={!e.canPay}
                                    onPress={e.pay}
                                >
                                    {e.payLabel}
                                </Button>
                                <Button
                                    busy={e.busy === "approve"}
                                    disabled={!e.canApprove}
                                    onPress={e.approvePicked}
                                >
                                    {e.approveLabel}
                                </Button>
                            </>
                        ) : undefined
                    }
                >
                    <div className="space-y-5">
                        {e.editable ? null : <Notice tone="info">{s.readOnlySelf}</Notice>}
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
                        <div className="flex flex-wrap items-end gap-3">
                            <Choice<EarningsView>
                                layout="segmented"
                                label={s.viewLabel}
                                options={EARNINGS_VIEWS.map((key) => ({ key, label: s.view[key] }))}
                                value={e.view}
                                onChange={e.setView}
                            />
                            {e.view === "todo" ? (
                                day(e.through, e.setThrough, s.through)
                            ) : (
                                <>
                                    {day(
                                        e.range.from,
                                        (from) => {
                                            e.setRange({ ...e.range, from });
                                        },
                                        s.from,
                                    )}
                                    {day(
                                        e.range.to,
                                        (to) => {
                                            e.setRange({ ...e.range, to });
                                        },
                                        s.to,
                                    )}
                                </>
                            )}
                            {e.view === "all" ? (
                                <Checkbox
                                    label={s.showReversed}
                                    value={e.showReversed}
                                    onChange={e.setShowReversed}
                                />
                            ) : null}
                        </div>
                        {e.view === "todo" && e.editable ? (
                            <p className="text-xs text-muted">{s.throughHint}</p>
                        ) : null}
                        {e.error !== null ? <Notice tone="danger">{e.error}</Notice> : null}
                        {file.error !== null ? <Notice tone="danger">{file.error}</Notice> : null}
                        {file.done !== null ? <Notice tone="success">{file.done}</Notice> : null}
                        {e.view === "paid" ? (
                            e.paidGroups.length === 0 ? (
                                <Empty message={s.noPaid} />
                            ) : (
                                <div className="space-y-5">
                                    {e.paidGroups.map((g) => (
                                        <PaidRun
                                            key={g.key}
                                            group={g}
                                            zone={zone}
                                            busy={e.busy !== null}
                                            onPrint={() => {
                                                printing.print(g, sel.name);
                                            }}
                                            onCsv={() => {
                                                file.save(e.runCsvPath(g), runCsvFile(g));
                                            }}
                                            onUndo={e.editable ? e.undo : undefined}
                                            onUndoRun={
                                                e.editable
                                                    ? () => {
                                                          e.undoRun(g);
                                                      }
                                                    : undefined
                                            }
                                        />
                                    ))}
                                </div>
                            )
                        ) : e.lines.length === 0 ? (
                            <Empty message={e.emptyMessage} />
                        ) : (
                            <div>
                                {e.view === "todo" && e.canPick ? (
                                    <div className="border-b border-line pb-2">
                                        <Checkbox
                                            label={s.selectAll}
                                            value={e.allPicked}
                                            mixed={e.picked.length > 0 && !e.allPicked}
                                            onChange={e.pickAll}
                                        />
                                    </div>
                                ) : null}
                                <EarningRows
                                    lines={e.lines}
                                    zone={zone}
                                    picked={e.picked}
                                    onPick={e.view === "todo" ? e.togglePick : undefined}
                                    onUndo={e.undo}
                                    busy={e.busy !== null}
                                />
                            </div>
                        )}
                        <p className="text-xs text-muted">{s.paidVia}</p>
                    </div>
                </DeskPanel>
            ) : null}
            {adjusting && sel !== null ? (
                <AdjustmentSheet
                    staffId={sel.staffId}
                    name={sel.name}
                    onClose={() => {
                        setAdjusting(false);
                    }}
                />
            ) : null}
            {printing.sheet}
        </div>
    );
}

function PaidRun({
    group,
    zone,
    busy = false,
    onPrint,
    onCsv,
    onUndo,
    onUndoRun,
}: {
    group: Group;
    zone: string;
    busy?: boolean | undefined;
    onPrint: () => void;
    onCsv?: (() => void) | undefined;
    onUndo?: ((line: Line) => void) | undefined;
    onUndoRun?: (() => void) | undefined;
}) {
    return (
        <section>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                <span>
                    <span className="block text-sm font-semibold text-ink">{group.label}</span>
                    {group.through !== null ? (
                        <span className="block text-xs text-muted">{group.through}</span>
                    ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-ink">
                        {formatMoney(group.totalCents, BUSINESS_CURRENCY)}
                    </span>
                    <Button size="sm" variant="outline" icon="printer" onPress={onPrint}>
                        {s.statement}
                    </Button>
                    {onCsv !== undefined ? (
                        <Button size="sm" variant="outline" onPress={onCsv}>
                            {s.downloadCsv}
                        </Button>
                    ) : null}
                    {onUndoRun !== undefined ? (
                        <Button size="sm" variant="link" disabled={busy} onPress={onUndoRun}>
                            {s.undoRun}
                        </Button>
                    ) : null}
                </span>
            </div>
            <EarningRows lines={group.lines} zone={zone} onUndo={onUndo} busy={busy} />
        </section>
    );
}

function useStatementPrint(): { print: (group: Group, name: string) => void; sheet: ReactNode } {
    const header = useStatementHeader();
    const zone = useBusinessZone();
    const printing = usePrintSheet();
    const [printed, setPrinted] = useState<{ group: Group; name: string } | null>(null);
    return {
        print: (group, name) => {
            setPrinted({ group, name });
            printing.print(s.statementFor(name, group.day));
        },
        sheet:
            printed === null
                ? null
                : printing.sheet(
                      <div className="space-y-6 p-8">
                          <div>
                              <p className="text-sm font-semibold text-ink">{header.business}</p>
                              {header.address.map((line) => (
                                  <p key={line} className="text-sm text-muted">
                                      {line}
                                  </p>
                              ))}
                              <h1 className="font-display text-xl font-bold text-ink">
                                  {s.statementTitle}
                              </h1>
                              <p className="text-sm text-muted">
                                  {s.statementFor(printed.name, printed.group.day)}
                              </p>
                              {printed.group.through !== null ? (
                                  <p className="text-sm text-muted">{printed.group.through}</p>
                              ) : null}
                          </div>
                          <ul className="divide-y divide-line-soft border-y border-line">
                              {printed.group.lines.map((l) => (
                                  <li
                                      key={l.id}
                                      className="flex justify-between gap-4 py-2 text-sm"
                                  >
                                      <span>
                                          <span className="block text-ink">{l.title}</span>
                                          <span className="block text-xs text-muted">
                                              {formatParts([formatShortDay(l.at, zone), l.detail])}
                                          </span>
                                      </span>
                                      <span className="tabular-nums text-ink">
                                          {formatMoney(l.amountCents, BUSINESS_CURRENCY)}
                                      </span>
                                  </li>
                              ))}
                          </ul>
                          <div className="space-y-1 text-sm">
                              {printed.group.parts.map((p) => (
                                  <div key={p.label} className="flex justify-between text-ink-soft">
                                      <span>{p.label}</span>
                                      <span className="tabular-nums">
                                          {formatMoney(p.cents, BUSINESS_CURRENCY)}
                                      </span>
                                  </div>
                              ))}
                              <div className="flex justify-between font-semibold text-ink">
                                  <span>{s.total}</span>
                                  <span className="tabular-nums">
                                      {formatMoney(printed.group.totalCents, BUSINESS_CURRENCY)}
                                  </span>
                              </div>
                          </div>
                      </div>,
                  ),
    };
}

function EarningRows({
    lines,
    zone,
    picked,
    onPick,
    onUndo,
    busy = false,
}: {
    lines: readonly Line[];
    zone: string;
    picked?: readonly string[] | undefined;
    onPick?: ((id: string) => void) | undefined;
    onUndo?: ((line: Line) => void) | undefined;
    busy?: boolean | undefined;
}) {
    return (
        <ul className="divide-y divide-line-soft">
            {lines.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-3">
                    {onPick !== undefined ? (
                        <span className="w-5 shrink-0">
                            {l.pickable ? (
                                <Checkbox
                                    label={l.label}
                                    hideLabel
                                    value={picked?.includes(l.id) ?? false}
                                    onChange={() => {
                                        onPick(l.id);
                                    }}
                                />
                            ) : null}
                        </span>
                    ) : null}
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                            {l.title}
                        </span>
                        <span className="block truncate text-xs text-muted">
                            {formatParts([formatShortDay(l.at, zone), l.detail])}
                        </span>
                    </span>
                    {onUndo !== undefined && l.undo !== null ? (
                        <Button
                            size="sm"
                            variant="link"
                            disabled={busy}
                            label={
                                l.undo === "unpay"
                                    ? s.undoPaymentFor(l.label)
                                    : s.undoApprovalFor(l.label)
                            }
                            onPress={() => {
                                onUndo(l);
                            }}
                        >
                            {l.undo === "unpay" ? s.undoPayment : s.undoApproval}
                        </Button>
                    ) : null}
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
    );
}

function AdjustmentSheet({
    staffId,
    name,
    onClose,
}: {
    staffId: string;
    name: string;
    onClose: () => void;
}) {
    const a = s.adjustment;
    const form = useAdjustmentForm(api, staffId, onClose);
    return (
        <Modal onClose={onClose} size="md">
            <div className="space-y-4">
                <div>
                    <h2 className="font-display text-lg font-bold text-ink">{a.title}</h2>
                    <p className="mt-1 text-sm text-muted">{formatParts([name, a.body])}</p>
                </div>
                <Choice<"bonus" | "deduction">
                    layout="segmented"
                    label={a.kindLabel}
                    options={[
                        { key: "bonus", label: a.bonus },
                        { key: "deduction", label: a.deduction },
                    ]}
                    value={form.kind}
                    onChange={form.setKind}
                />
                <TextField
                    label={a.amount}
                    type="number"
                    {...currencyAffix(BUSINESS_CURRENCY)}
                    value={form.amount}
                    onChange={form.setAmount}
                />
                <TextField
                    label={a.reason}
                    hint={a.reasonHint}
                    maxLength={200}
                    value={form.reason}
                    onChange={form.setReason}
                    onSubmit={form.submit}
                />
                {form.error !== null ? (
                    <Notice tone="danger" banner>
                        {form.error}
                    </Notice>
                ) : null}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button busy={form.busy} onPress={form.submit}>
                        {a.save}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
