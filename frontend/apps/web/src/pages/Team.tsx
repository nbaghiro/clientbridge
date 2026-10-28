import {
    INVITE_ROLES,
    RATE_TYPES,
    type InviteTeammatesForm,
    type MemberRole,
    type RemovalChoice,
    STAFF_TITLE_MAX,
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
    usePeoplePhotos,
    useStaffPay,
    useRemoveMember,
    useOwedPay,
    useStaffPayForm,
    useStaffProfileForm,
    useSeatCost,
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
    Empty,
    FactList,
    Field,
    Icon,
    KeyValueList,
    ListPage,
    Modal,
    Notice,
    OccurrenceList,
    PageHeader,
    Panel,
    Select,
    StatusPill,
    SwatchPicker,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { DeskPanel } from "../components/Desk";
import { Loaded } from "../components/Loaded";
import { PersonPhoto } from "../components/PersonPhoto";

const t = strings.staff.team;
const grid =
    "grid grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_16px] items-center gap-4";

function roleOptions() {
    return INVITE_ROLES.map((r) => ({ key: r, label: roleLabel(r), hint: t.roleAccess[r] }));
}

function InviteDialog({
    form,
    seatCost,
    onClose,
}: {
    form: InviteTeammatesForm;
    seatCost: string;
    onClose: () => void;
}) {
    const first = form.sent[0];
    return (
        <Modal onClose={onClose} size="lg">
            {first !== undefined ? (
                <div className="space-y-4">
                    <Icon name="check" size={32} className="block text-ink-soft" />
                    <div>
                        <h2 className="font-display text-lg font-bold text-ink">
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
                    <h2 className="font-display text-lg font-bold text-ink">{t.inviteMember}</h2>
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
                    {seatCost !== "" ? <Notice tone="info">{seatCost}</Notice> : null}
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

// Role, profile and pay are separate commands with their own checks, so each section saves itself.
function SectionSave({
    label,
    busy,
    disabled = false,
    onPress,
}: {
    label: string;
    busy: boolean;
    disabled?: boolean;
    onPress: () => void;
}) {
    return (
        <div className="flex justify-end">
            <Button variant="outline" size="sm" onPress={onPress} busy={busy} disabled={disabled}>
                {label}
            </Button>
        </div>
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
                <SectionSave
                    busy={form.busy}
                    label={form.busy ? strings.common.saving : t.savePay}
                    onPress={form.submit}
                />
            </div>
        </DetailSection>
    );
}

function ProfileSection({ member }: { member: TeamMember }) {
    const form = useStaffProfileForm(api, member, () => undefined);
    return (
        <DetailSection title={t.profile}>
            <div className="flex flex-col gap-3">
                <TextField
                    label={t.title}
                    hint={t.titleHint}
                    value={form.title}
                    onChange={form.setTitle}
                    placeholder={t.titlePlaceholder}
                    maxLength={STAFF_TITLE_MAX}
                    optional
                />
                <Field label={t.colour}>
                    <SwatchPicker
                        label={t.colour}
                        colours={form.colours}
                        value={form.colour}
                        onChange={form.setColour}
                    />
                </Field>
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                <SectionSave
                    busy={form.busy}
                    disabled={!form.dirty}
                    label={form.busy ? strings.common.saving : t.saveProfile}
                    onPress={form.submit}
                />
            </div>
        </DetailSection>
    );
}

function RemoveDialog({
    member,
    team,
    onClose,
    onRemoved,
}: {
    member: TeamMember;
    team: TeamView;
    onClose: () => void;
    onRemoved: () => void;
}) {
    const finish = () => {
        team.refresh();
        onRemoved();
    };
    const removal = useRemoveMember(api, member, team.members, finish);
    const owed = useOwedPay(member.id);
    const outcome = removal.outcome;
    if (outcome !== null) {
        return (
            <Modal onClose={finish} size="lg">
                <div className="space-y-4">
                    <div>
                        <h2 className="font-display text-lg font-bold text-ink">
                            {t.removedTitle(member.name)}
                        </h2>
                        <p className="mt-1 text-sm text-muted">{outcome.body}</p>
                    </div>
                    {outcome.series.length > 0 ? (
                        <FactList facts={outcome.series} label={t.removedSeries} />
                    ) : null}
                    {outcome.left.length > 0 ? (
                        <OccurrenceList rows={outcome.left} label={t.removeFuture} />
                    ) : null}
                    <div className="flex justify-end">
                        <Button onPress={finish}>{strings.common.done}</Button>
                    </div>
                </div>
            </Modal>
        );
    }
    return (
        <Modal onClose={onClose} size="lg">
            <div className="space-y-4">
                <div>
                    <h2 className="font-display text-lg font-bold text-ink">
                        {t.removeTitle(member.name)}
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                        {strings.common.twoSentences(t.removeBody, removal.summary)}
                    </p>
                </div>
                {removal.hasWork ? (
                    <>
                        <Choice<RemovalChoice>
                            layout="cards"
                            label={t.removeFuture}
                            value={removal.choice}
                            onChange={removal.setChoice}
                            options={[
                                {
                                    key: "reassign",
                                    label: t.removeReassign,
                                    hint: t.removeReassignHint,
                                },
                                { key: "cancel", label: t.removeCancel, hint: t.removeCancelHint },
                            ]}
                        />
                        {removal.choice === "reassign" ? (
                            <Select
                                label={t.removeTaker}
                                value={removal.taker}
                                options={removal.takers}
                                onChange={removal.setTaker}
                            />
                        ) : null}
                        {removal.scheduleNote !== null ? (
                            <p className="text-sm text-muted">{removal.scheduleNote}</p>
                        ) : null}
                        {removal.schedules.length > 0 ? (
                            <FactList facts={removal.schedules} label={t.removeSchedules} />
                        ) : null}
                        {removal.visits.length > 0 ? (
                            <OccurrenceList rows={removal.visits} label={t.removeFuture} />
                        ) : null}
                    </>
                ) : null}
                {owed !== null ? (
                    <Notice tone="info" banner>
                        {owed}
                    </Notice>
                ) : null}
                {removal.error !== null ? (
                    <Notice tone="danger" banner>
                        {removal.error}
                    </Notice>
                ) : null}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button variant="danger" onPress={removal.submit} busy={removal.busy}>
                        {t.removeConfirm}
                    </Button>
                </div>
            </div>
        </Modal>
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
    const photos = usePeoplePhotos();
    const [role, setRole] = useState<MemberRole>(member.role);
    const [removing, setRemoving] = useState(false);
    const owner = member.role === "owner";
    const editable = team.canManage && !owner && !member.isYou;
    const busy = team.busyId === member.id;
    const access = strings.common.titleAndBody(roleLabel(member.role), t.roleAccess[member.role]);
    return (
        <>
            <DeskPanel
                title={member.name}
                subtitle={member.title ?? roleLabel(member.role)}
                leading={
                    <Avatar
                        name={member.name}
                        src={photos.staff(member.id)}
                        size="lg"
                        color={member.color}
                    />
                }
                onClose={onClose}
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
                {member.userId !== null ? (
                    <PersonPhoto
                        owner={{ kind: "user", id: member.userId }}
                        name={member.name}
                        color={member.color}
                    />
                ) : null}
                <DetailSection title={t.changeRole}>
                    {owner ? (
                        <p className="text-sm text-muted">{t.ownerNote}</p>
                    ) : editable ? (
                        <div className="flex flex-col gap-3">
                            <Choice<MemberRole>
                                layout="cards"
                                label={t.changeRole}
                                value={role}
                                onChange={setRole}
                                options={roleOptions()}
                            />
                            <SectionSave
                                busy={busy}
                                disabled={role === member.role}
                                label={busy ? t.saving : t.saveRole}
                                onPress={() => {
                                    team.changeRole(member.id, role);
                                }}
                            />
                        </div>
                    ) : (
                        <p className="text-sm text-ink-soft">
                            {member.isYou && team.canManage
                                ? strings.common.twoSentences(access, t.selfNote)
                                : access}
                        </p>
                    )}
                </DetailSection>
                {team.canManage ? <ProfileSection member={member} /> : null}
                {team.canManage && pay !== undefined ? <PaySection row={pay} /> : null}
                {editable ? (
                    <DetailSection>
                        <Button
                            variant="danger"
                            onPress={() => {
                                setRemoving(true);
                            }}
                            icon="trash"
                        >
                            {t.remove}
                        </Button>
                    </DetailSection>
                ) : null}
                {team.error !== null ? <Notice tone="danger">{team.error}</Notice> : null}
            </DeskPanel>
            {removing ? (
                <RemoveDialog
                    member={member}
                    team={team}
                    onClose={() => {
                        setRemoving(false);
                    }}
                    onRemoved={onClose}
                />
            ) : null}
        </>
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
                    <StatusPill status={t.expired} intent="danger" />
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
    const can = t.roleCan[role];
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
    const photos = usePeoplePhotos();
    const viewer = useViewer();
    const team = useTeam(api, viewer);
    const pay = useStaffPay();
    const invite = useInviteTeammatesForm(
        api,
        team.members.map((m) => m.email ?? ""),
    );
    const seatCost = useSeatCost(api, viewer?.role ?? null);
    const [inviting, setInviting] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const open = team.members.find((m) => m.id === openId);

    return (
        <div className="space-y-6">
            <PageHeader
                title={strings.navigation.setupSections.team}
                subtitle={t.subtitle}
                actions={
                    team.canManage && team.load.hasData ? (
                        <Button
                            icon="plus"
                            onPress={() => {
                                setInviting(true);
                            }}
                        >
                            {t.inviteMember}
                        </Button>
                    ) : undefined
                }
            />
            {!team.canManage && team.load.hasData ? (
                <div className="space-y-4">
                    <Notice tone="info" banner>
                        {team.ownerName === null ? t.readOnlyNoName : t.readOnly(team.ownerName)}
                    </Notice>
                    <RoleAccess team={team} />
                </div>
            ) : null}
            <Loaded load={team.load} loading={t.loading} failed={t.loadError}>
                <div className="space-y-6">
                    <div>
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
                                        <Avatar
                                            name={m.name}
                                            src={photos.staff(m.id)}
                                            color={m.color}
                                        />
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
                    {team.canManage && team.invites.length > 0 ? (
                        <div>
                            <Panel flush title={strings.staff.pending}>
                                <div className="divide-y divide-line-soft">
                                    {team.invites.map((i) => (
                                        <InviteRow key={i.id} invite={i} team={team} />
                                    ))}
                                </div>
                            </Panel>
                        </div>
                    ) : null}
                    {team.error !== null && open === undefined ? (
                        <Notice tone="danger">{team.error}</Notice>
                    ) : null}
                    {team.alone && team.canManage ? (
                        <div>
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
                </div>
            </Loaded>
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
                    seatCost={seatCost}
                    onClose={() => {
                        setInviting(false);
                        invite.reset();
                    }}
                />
            ) : null}
        </div>
    );
}
