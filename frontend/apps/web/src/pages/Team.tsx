import {
    type Invite,
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
import {
    Badge,
    Button,
    DetailSection,
    DetailView,
    ListPage,
    Notice,
    Panel,
    Select,
    StatusPill,
    TextField,
    Toggle,
} from "@clientbridge/ui";
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
                summary={strings.staff.subtitle}
                head={strings.staff.members}
                rows={staff}
                rowKey={(s) => s.id}
                onRowPress={
                    manager
                        ? (s) => {
                              setEditingPay(s.id);
                          }
                        : undefined
                }
                empty={strings.staff.noMembers}
                renderRow={(s) => (
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="flex items-center gap-2 font-medium text-ink">
                                {staffDisplayName(s)}
                                {s.id === viewer?.staffId ? (
                                    <Badge label={strings.staff.youBadge} />
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
                <div className="mt-6">
                    <Panel flush title={strings.staff.pending}>
                        <ul>
                            {pending.map((s) => (
                                <li
                                    key={s.id}
                                    className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0"
                                >
                                    <p className="text-sm text-ink">{s.invite_email ?? "—"}</p>
                                    <StatusPill
                                        status={strings.staff.invitedBadge(s.role)}
                                        intent="warning"
                                    />
                                </li>
                            ))}
                        </ul>
                    </Panel>
                </div>
            ) : null}

            {canManageStaff(role) ? (
                <InviteForm invite={invite} />
            ) : (
                <p className="mt-6 text-sm text-muted">{strings.staff.cannotInvite}</p>
            )}
        </div>
    );
}

function InviteForm({ invite }: { invite: ReturnType<typeof useInviteForm> }) {
    return (
        <div className="mt-6">
            <Panel title={strings.staff.inviteHeading}>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        invite.submit();
                    }}
                    className="flex flex-col gap-3 sm:flex-row sm:items-end"
                >
                    <div className="flex-1">
                        <TextField
                            label={strings.staff.email}
                            type="email"
                            value={invite.email}
                            onChange={invite.setEmail}
                            placeholder={strings.staff.emailPlaceholder}
                        />
                    </div>
                    <Select
                        label={strings.staff.role}
                        value={invite.role}
                        options={INVITABLE_ROLES.map((r) => ({ key: r.value, label: r.label }))}
                        onChange={invite.setRole}
                    />
                    <Button submit busy={invite.busy}>
                        {invite.busy ? strings.staff.inviting : strings.staff.sendInvite}
                    </Button>
                </form>

                {invite.error ? <Notice tone="danger">{invite.error}</Notice> : null}
                {invite.invite ? <InviteLink invite={invite.invite} onDone={invite.reset} /> : null}
            </Panel>
        </div>
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
                {strings.staff.inviteSentWeb(invite.email)}
            </p>
            <div className="mt-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-soft">
                    {link}
                </span>
                <Button size="sm" onPress={copy}>
                    {copied ? strings.staff.copied : strings.staff.copy}
                </Button>
                <Button variant="quiet" size="sm" onPress={onDone}>
                    {strings.common.done}
                </Button>
            </div>
        </div>
    );
}

function PaySummary({ row }: { row: StaffPayRow | undefined }) {
    if (row === undefined) return null;
    return <p className="text-xs text-muted">{staffPaySummary(row)}</p>;
}

function StaffPayDetail({ row, onClose }: { row: StaffPayRow; onClose: () => void }) {
    const form = useStaffPayForm(api, row, onClose);
    return (
        <DetailView
            open
            title={staffDisplayName(row)}
            subtitle={strings.staff.payHeading}
            onClose={onClose}
            actions={
                <Button onPress={form.submit} busy={form.busy}>
                    {form.busy ? strings.catalog.saving : strings.catalog.save}
                </Button>
            }
        >
            <DetailSection>
                <div className="flex flex-col gap-3">
                    <Toggle
                        label={strings.staff.isPayee}
                        value={form.isPayee}
                        onChange={form.setIsPayee}
                    />
                    {form.isPayee ? (
                        <>
                            <Select
                                label={strings.staff.rateType}
                                value={form.rateType}
                                options={RATE_TYPES.map((t) => ({ key: t.value, label: t.label }))}
                                onChange={form.setRateType}
                            />
                            <TextField
                                label={strings.staff.rateLabel(form.rateType)}
                                type="number"
                                value={form.rate}
                                onChange={form.setRate}
                            />
                            <TextField
                                label={strings.staff.retailRate}
                                type="number"
                                value={form.retailPercent}
                                onChange={form.setRetailPercent}
                            />
                        </>
                    ) : null}
                    {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                </div>
            </DetailSection>
        </DetailView>
    );
}
