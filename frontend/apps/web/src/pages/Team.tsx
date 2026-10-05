import {
    type Invite,
    type StaffRole,
    INVITABLE_ROLES,
    RATE_TYPES,
    type StaffPayRow,
    acceptInviteUrl,
    canManageStaff,
    staffDisplayName,
    staffPaySummary,
    strings,
    useInviteForm,
    usePendingInvites,
    useStaff,
    useStaffPay,
    useStaffPayForm,
} from "@clientbridge/app-core";
import { DetailSection, DetailView, ListPage } from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

export function Team() {
    const viewer = useViewer();
    const role = viewer?.role ?? null;
    const staff = useStaff();
    const pending = usePendingInvites();
    const invite = useInviteForm(api);
    const manager = canManageStaff(role);
    const pay = useStaffPay();
    const [editingPay, setEditingPay] = useState<string | null>(null);
    const payRow = pay.find((p) => p.id === editingPay);

    return (
        <div className="max-w-2xl">
            <ListPage
                summary={strings.team.subtitle}
                head={strings.team.members}
                rows={staff}
                rowKey={(s) => s.id}
                onRowPress={
                    manager
                        ? (s) => {
                              setEditingPay(s.id);
                          }
                        : undefined
                }
                empty={strings.team.noMembers}
                renderRow={(s) => (
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-medium text-ink">
                                {staffDisplayName(s)}
                                {s.id === viewer?.staffId ? (
                                    <span className="ml-2 rounded-full bg-accent-weak px-2 py-0.5 text-xs font-semibold text-accent">
                                        {strings.team.youBadge}
                                    </span>
                                ) : null}
                            </p>
                            {s.invite_email !== null ? (
                                <p className="text-xs text-muted">{s.invite_email}</p>
                            ) : null}
                            {manager ? <PaySummary row={pay.find((p) => p.id === s.id)} /> : null}
                        </div>
                        <span className="text-xs font-medium capitalize text-ink-soft">
                            {s.role}
                        </span>
                    </div>
                )}
            />

            {payRow !== undefined ? (
                <StaffPayDetail
                    key={payRow.id}
                    row={payRow}
                    onClose={() => {
                        setEditingPay(null);
                    }}
                />
            ) : null}

            {pending.length > 0 ? (
                <section className="mt-6 rounded-lg border border-line bg-surface">
                    <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
                        {strings.team.pending}
                    </h2>
                    <ul>
                        {pending.map((s) => (
                            <li
                                key={s.id}
                                className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0"
                            >
                                <p className="text-sm text-ink">{s.invite_email ?? "—"}</p>
                                <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold capitalize text-warn-fg">
                                    {strings.team.invitedBadge(s.role)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            {canManageStaff(role) ? (
                <InviteForm invite={invite} />
            ) : (
                <p className="mt-6 text-sm text-muted">{strings.team.cannotInvite}</p>
            )}
        </div>
    );
}

function InviteForm({ invite }: { invite: ReturnType<typeof useInviteForm> }) {
    return (
        <section className="mt-6 rounded-lg border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">{strings.team.inviteHeading}</h2>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    invite.submit();
                }}
                className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
            >
                <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-ink-soft">
                    {strings.team.email}
                    <input
                        type="email"
                        value={invite.email}
                        onChange={(e) => {
                            invite.setEmail(e.target.value);
                        }}
                        placeholder={strings.team.emailPlaceholder}
                        className="w-full rounded-md border border-line bg-bg px-3 py-2 text-ink outline-hidden transition placeholder:text-muted focus:border-accent"
                    />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                    {strings.team.role}
                    <select
                        value={invite.role}
                        onChange={(e) => {
                            invite.setRole(e.target.value as StaffRole);
                        }}
                        className="rounded-md border border-line bg-bg px-3 py-2 text-ink outline-hidden transition focus:border-accent"
                    >
                        {INVITABLE_ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                                {r.label}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="submit"
                    disabled={invite.busy}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                >
                    {invite.busy ? strings.team.inviting : strings.team.sendInvite}
                </button>
            </form>

            {invite.error ? <p className="mt-2 text-sm text-danger-fg">{invite.error}</p> : null}
            {invite.invite ? <InviteLink invite={invite.invite} onDone={invite.reset} /> : null}
        </section>
    );
}

function InviteLink({ invite, onDone }: { invite: Invite; onDone: () => void }) {
    const [copied, setCopied] = useState(false);
    const link = acceptInviteUrl(window.location.origin, invite.invite_token);

    const copy = (): void => {
        navigator.clipboard
            .writeText(link)
            .then(() => {
                setCopied(true);
            })
            .catch(() => undefined);
    };

    return (
        <div className="mt-3 rounded-md border border-accent-line bg-accent-weak p-3">
            <p className="text-sm font-medium text-ink">
                {strings.team.inviteSentWeb(invite.email)}
            </p>
            <div className="mt-2 flex items-center gap-2">
                <input
                    readOnly
                    value={link}
                    className="flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-soft"
                />
                <button
                    type="button"
                    onClick={copy}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition hover:opacity-90"
                >
                    {copied ? strings.team.copied : strings.team.copy}
                </button>
                <button
                    type="button"
                    onClick={onDone}
                    className="rounded-md px-2 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-surface"
                >
                    {strings.common.done}
                </button>
            </div>
        </div>
    );
}

function PaySummary({ row }: { row: StaffPayRow | undefined }) {
    if (row === undefined) return null;
    return <p className="text-xs text-muted">{staffPaySummary(row)}</p>;
}

const payField =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-hidden placeholder:text-muted focus:border-accent";

function StaffPayDetail({ row, onClose }: { row: StaffPayRow; onClose: () => void }) {
    const form = useStaffPayForm(api, row, onClose);
    return (
        <DetailView
            open
            title={staffDisplayName(row)}
            subtitle={strings.team.payHeading}
            onClose={onClose}
            actions={
                <button
                    type="button"
                    onClick={form.submit}
                    disabled={form.busy}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                >
                    {form.busy ? strings.catalog.saving : strings.catalog.save}
                </button>
            }
        >
            <DetailSection>
                <div className="flex flex-col gap-3">
                    <label className="flex items-center gap-2 text-sm text-ink">
                        <input
                            type="checkbox"
                            checked={form.isPayee}
                            onChange={(e) => {
                                form.setIsPayee(e.target.checked);
                            }}
                            className="h-4 w-4 accent-accent"
                        />
                        {strings.team.isPayee}
                    </label>
                    {form.isPayee ? (
                        <>
                            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                                {strings.team.rateType}
                                <select
                                    value={form.rateType}
                                    onChange={(e) => {
                                        form.setRateType(e.target.value);
                                    }}
                                    className={payField}
                                >
                                    {RATE_TYPES.map((t) => (
                                        <option key={t.value} value={t.value}>
                                            {t.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                                {strings.team.rateLabel(form.rateType)}
                                <input
                                    value={form.rate}
                                    onChange={(e) => {
                                        form.setRate(e.target.value);
                                    }}
                                    inputMode="decimal"
                                    className={payField}
                                />
                            </label>
                            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                                {strings.team.retailRate}
                                <input
                                    value={form.retailPercent}
                                    onChange={(e) => {
                                        form.setRetailPercent(e.target.value);
                                    }}
                                    inputMode="decimal"
                                    className={payField}
                                />
                            </label>
                        </>
                    ) : null}
                    {form.error !== null ? (
                        <p className="text-sm text-danger-fg">{form.error}</p>
                    ) : null}
                </div>
            </DetailSection>
        </DetailView>
    );
}
