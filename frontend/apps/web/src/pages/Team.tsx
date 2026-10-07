import {
    INVITE_ROLES,
    RATE_TYPES,
    type InviteTeammatesForm,
    type MemberRole,
    type StaffPayRow,
    type TeamInvite,
    type TeamMember,
    type TeamView,
    acceptInviteUrl,
    memberRoleIntent,
    roleLabel,
    staffPaySummary,
    strings,
    useInviteTeammatesForm,
    useStaffPay,
    useStaffPayForm,
    useTeam,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    confirm,
    CopyField,
    DetailSection,
    DetailView,
    Empty,
    Icon,
    KeyValueList,
    ListPage,
    LoadFailed,
    Modal,
    Notice,
    Panel,
    Select,
    Skeleton,
    StatusPill,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const t = strings.staff.team;
const grid =
    "grid grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_16px] items-center gap-4";

function roleOptions() {
    return INVITE_ROLES.map((r) => ({ key: r, label: roleLabel(r), hint: t.roleAccess[r] }));
}

function InviteDialog({ form, onClose }: { form: InviteTeammatesForm; onClose: () => void }) {
    const first = form.sent[0];
    return (
        <Modal onClose={onClose} size="lg">
            {first !== undefined ? (
                <div className="space-y-4">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ok-bg text-ok-fg">
                        <Icon name="check" size={20} />
                    </span>
                    <div>
                        <h2 className="font-display text-xl font-bold text-ink">
                            {t.sentTitle(form.sent.length)}
                        </h2>
                        <p className="mt-1 text-sm text-muted">{t.sentBody}</p>
                    </div>
                    <ul className="space-y-1 text-sm text-ink-soft">
                        {form.sent.map((inv) => (
                            <li key={inv.id} className="flex items-center gap-2">
                                <Icon name="mail" size={14} />
                                {inv.email}
                                <Badge
                                    label={roleLabel(inv.role)}
                                    intent={memberRoleIntent(inv.role)}
                                />
                            </li>
                        ))}
                    </ul>
                    {form.sent.length === 1 ? (
                        <CopyField
                            label={t.copyLink}
                            value={acceptInviteUrl(window.location.origin, first.invite_token)}
                            copyLabel={t.copyLink}
                        />
                    ) : null}
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onPress={form.reset}>
                            {t.inviteAnother}
                        </Button>
                        <Button
                            onPress={() => {
                                form.reset();
                                onClose();
                            }}
                        >
                            {strings.common.done}
                        </Button>
                    </div>
                </div>
            ) : (
                <form
                    noValidate
                    onSubmit={(e) => {
                        e.preventDefault();
                        form.submit();
                    }}
                    className="space-y-4"
                >
                    <h2 className="font-display text-xl font-bold text-ink">{t.inviteMember}</h2>
                    <TextField
                        label={t.emails}
                        hint={t.emailsHint}
                        value={form.emails}
                        onChange={form.setEmails}
                        placeholder={t.emailPlaceholder}
                        autoFocus
                    />
                    <div className="flex flex-col gap-2">
                        <span className="text-sm font-medium text-ink-soft">{t.role}</span>
                        <Choice<MemberRole>
                            layout="cards"
                            label={t.role}
                            value={form.role}
                            onChange={form.setRole}
                            options={roleOptions()}
                        />
                    </div>
                    {form.error !== null ? (
                        <Notice tone="danger" banner>
                            {form.error}
                        </Notice>
                    ) : null}
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onPress={onClose}>
                            {strings.common.cancel}
                        </Button>
                        <Button submit busy={form.busy}>
                            {form.busy ? t.sending : t.send}
                        </Button>
                    </div>
                </form>
            )}
        </Modal>
    );
}

function PaySection({ row }: { row: StaffPayRow }) {
    const form = useStaffPayForm(api, row, () => undefined);
    return (
        <DetailSection title={strings.staff.payHeading}>
            <div className="flex flex-col gap-3">
                <p className="text-xs text-muted">{staffPaySummary(row)}</p>
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
                            options={RATE_TYPES.map((r) => ({ key: r.value, label: r.label }))}
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
                <div>
                    <Button variant="outline" size="sm" onPress={form.submit} busy={form.busy}>
                        {form.busy ? strings.common.saving : strings.common.save}
                    </Button>
                </div>
            </div>
        </DetailSection>
    );
}

function MemberDetail({
    member,
    team,
    pay,
    onClose,
}: {
    member: TeamMember;
    team: TeamView;
    pay: StaffPayRow | undefined;
    onClose: () => void;
}) {
    const [role, setRole] = useState<MemberRole>(member.role);
    const owner = member.role === "owner";
    const editable = team.canManage && !owner && !member.isYou;
    const busy = team.busyId === member.id;
    const remove = (): void => {
        confirm({
            title: t.removeTitle(member.name),
            message: t.removeBody,
            confirmLabel: t.removeConfirm,
            destructive: true,
        })
            .then((ok) => {
                if (ok) {
                    team.remove(member.id);
                    onClose();
                }
            })
            .catch(() => undefined);
    };
    return (
        <DetailView
            open
            title={member.name}
            subtitle={member.title ?? roleLabel(member.role)}
            leading={<Avatar name={member.name} size="lg" color={member.color} />}
            onClose={onClose}
            actions={
                editable ? (
                    <Button
                        onPress={() => {
                            team.changeRole(member.id, role);
                        }}
                        busy={busy}
                        disabled={role === member.role}
                    >
                        {busy ? t.saving : t.saveRole}
                    </Button>
                ) : undefined
            }
        >
            {team.canManage ? (
                <DetailSection>
                    <KeyValueList
                        rows={[
                            { label: t.email, value: member.email ?? strings.clients.dash },
                            { label: t.lastActive, value: member.activeLabel },
                        ]}
                    />
                </DetailSection>
            ) : null}
            <DetailSection title={t.changeRole}>
                {owner ? (
                    <p className="text-sm text-muted">{t.ownerNote}</p>
                ) : editable ? (
                    <Choice<MemberRole>
                        layout="cards"
                        label={t.changeRole}
                        value={role}
                        onChange={setRole}
                        options={roleOptions()}
                    />
                ) : (
                    <p className="text-sm text-ink-soft">
                        {roleLabel(member.role)}. {t.roleAccess[member.role]}
                        {member.isYou && team.canManage ? ` ${t.selfNote}` : ""}
                    </p>
                )}
            </DetailSection>
            {team.canManage && pay !== undefined ? <PaySection row={pay} /> : null}
            {editable ? (
                <DetailSection>
                    <Button variant="danger" onPress={remove} icon="trash">
                        {t.remove}
                    </Button>
                </DetailSection>
            ) : null}
            {team.error !== null ? <Notice tone="danger">{team.error}</Notice> : null}
        </DetailView>
    );
}

function InviteRow({ invite, team }: { invite: TeamInvite; team: TeamView }) {
    const busy = team.busyId === invite.id;
    const revoke = (): void => {
        confirm({
            title: t.revokeTitle(invite.email),
            message: t.revokeBody,
            confirmLabel: t.revoke,
            destructive: true,
        })
            .then((ok) => {
                if (ok) team.revoke(invite.id);
            })
            .catch(() => undefined);
    };
    return (
        <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-avatar border border-dashed border-line text-muted">
                <Icon name="mail" size={16} />
            </span>
            <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
                    <span className="truncate">{invite.email}</span>
                    <span className="shrink-0">
                        <Badge
                            label={roleLabel(invite.role)}
                            intent={memberRoleIntent(invite.role)}
                        />
                    </span>
                </p>
                <p className="truncate text-xs text-muted">{invite.sentLine}</p>
            </div>
            <span className="shrink-0">
                {invite.expired ? (
                    <StatusPill status={t.expired} intent="danger" asWritten />
                ) : (
                    <span className="text-xs text-muted">{t.expiresIn(invite.daysLeft)}</span>
                )}
            </span>
            <div className="flex gap-1">
                <Button
                    size="sm"
                    variant={invite.expired ? "outline" : "quiet"}
                    onPress={() => {
                        team.resend(invite.id);
                    }}
                    busy={busy}
                >
                    {team.resentIds.includes(invite.id) ? t.resent : t.resend}
                </Button>
                <Button size="sm" variant="quiet" onPress={revoke}>
                    {t.revoke}
                </Button>
            </div>
        </div>
    );
}

function RoleAccess({ team }: { team: TeamView }) {
    const role = team.viewerRole ?? "staff";
    const can = t.roleCan[role] ?? [];
    const cant = t.roleCant[role] ?? [];
    return (
        <Panel title={t.yourRole(roleLabel(role))} subtitle={t.roleAccess[role]}>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {t.canDo}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-sm text-ink-soft">
                        {can.map((x) => (
                            <li key={x} className="flex items-center gap-2">
                                <Icon name="check" size={14} />
                                {x}
                            </li>
                        ))}
                    </ul>
                </div>
                {cant.length > 0 ? (
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                            {t.cantDo}
                        </p>
                        <ul className="mt-2 space-y-1.5 text-sm text-muted">
                            {cant.map((x) => (
                                <li key={x} className="flex items-center gap-2">
                                    <Icon name="x" size={14} />
                                    {x}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </div>
        </Panel>
    );
}

export function Team() {
    const viewer = useViewer();
    const team = useTeam(api, viewer);
    const pay = useStaffPay();
    const invite = useInviteTeammatesForm(
        api,
        team.members.map((m) => m.email ?? ""),
    );
    const [inviting, setInviting] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const open = team.members.find((m) => m.id === openId);

    return (
        <div>
            <div className="flex items-start justify-between gap-4">
                <p className="mt-1 text-sm text-muted">{t.subtitle}</p>
                {team.canManage && team.load.hasData ? (
                    <Button
                        icon="plus"
                        onPress={() => {
                            setInviting(true);
                        }}
                    >
                        {t.inviteMember}
                    </Button>
                ) : null}
            </div>
            {!team.canManage && team.load.hasData ? (
                <div className="mt-4 space-y-4">
                    <Notice tone="info" banner>
                        {team.ownerName === null ? t.readOnlyNoName : t.readOnly(team.ownerName)}
                    </Notice>
                    <RoleAccess team={team} />
                </div>
            ) : null}
            {team.load.state === "loading" ? (
                <div className="mt-6">
                    <Panel flush>
                        <Skeleton variant="row" count={4} label={t.loading} />
                    </Panel>
                </div>
            ) : team.load.state === "error" ? (
                <div className="mt-6">
                    <Panel flush>
                        <LoadFailed
                            message={t.loadError}
                            onRetry={team.load.retry}
                            retrying={team.load.retrying}
                        />
                    </Panel>
                </div>
            ) : (
                <>
                    <div className="mt-6">
                        <ListPage
                            head={
                                <div className={grid}>
                                    <span>{t.colPerson}</span>
                                    <span>{t.colRole}</span>
                                    <span>{team.canManage ? t.colActive : ""}</span>
                                    <span />
                                </div>
                            }
                            rows={team.members}
                            rowKey={(m) => m.id}
                            onRowPress={(m) => {
                                setOpenId(m.id);
                            }}
                            empty={strings.staff.noMembers}
                            renderRow={(m) => (
                                <div className={grid}>
                                    <div className="flex min-w-0 items-center gap-3">
                                        <Avatar name={m.name} color={m.color} />
                                        <div className="min-w-0">
                                            <p className="flex min-w-0 items-center gap-2 font-medium text-ink">
                                                <span className="truncate">{m.name}</span>
                                                {m.isYou ? (
                                                    <span className="shrink-0">
                                                        <Badge label={t.you} intent="neutral" />
                                                    </span>
                                                ) : null}
                                            </p>
                                            <p className="truncate text-xs text-muted">
                                                {m.email ?? m.title ?? ""}
                                            </p>
                                        </div>
                                    </div>
                                    <span>
                                        <Badge
                                            label={roleLabel(m.role)}
                                            intent={memberRoleIntent(m.role)}
                                        />
                                    </span>
                                    <span
                                        className={`truncate text-sm ${m.activeNow ? "font-medium text-ok-fg" : "text-ink-soft"}`}
                                    >
                                        {m.activeLabel}
                                    </span>
                                    <span className="text-muted">
                                        <Icon name="chevron" size={16} />
                                    </span>
                                </div>
                            )}
                        />
                    </div>
                    {team.canManage ? (
                        <div className="mt-6">
                            <Panel flush title={strings.staff.pending}>
                                {team.invites.length === 0 ? (
                                    <p className="px-4 py-6 text-center text-sm text-muted">
                                        {t.noInvites}
                                    </p>
                                ) : (
                                    <div className="divide-y divide-line-soft">
                                        {team.invites.map((i) => (
                                            <InviteRow key={i.id} invite={i} team={team} />
                                        ))}
                                    </div>
                                )}
                            </Panel>
                        </div>
                    ) : null}
                    {team.error !== null && open === undefined ? (
                        <div className="mt-4">
                            <Notice tone="danger">{team.error}</Notice>
                        </div>
                    ) : null}
                    {team.alone && team.canManage ? (
                        <div className="mt-6">
                            <Empty
                                variant="card"
                                icon="users"
                                message={t.aloneTitle}
                                body={t.aloneBody}
                                actions={
                                    <Button
                                        size="sm"
                                        icon="plus"
                                        onPress={() => {
                                            setInviting(true);
                                        }}
                                    >
                                        {t.inviteMember}
                                    </Button>
                                }
                            />
                        </div>
                    ) : null}
                </>
            )}
            {open !== undefined ? (
                <MemberDetail
                    key={open.id}
                    member={open}
                    team={team}
                    pay={pay.find((p) => p.id === open.id)}
                    onClose={() => {
                        setOpenId(null);
                    }}
                />
            ) : null}
            {inviting ? (
                <InviteDialog
                    form={invite}
                    onClose={() => {
                        setInviting(false);
                        invite.reset();
                    }}
                />
            ) : null}
        </div>
    );
}
