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
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    confirm,
    DetailSection,
    DetailView,
    Empty,
    Icon,
    KeyValueList,
    ListRow,
    LoadFailed,
    Modal,
    Notice,
    Select,
    Skeleton,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { type ReactNode, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { publicWebUrl } from "../lib/config";

const c = theme.colors;
const t = strings.staff.team;

function roleOptions() {
    return INVITE_ROLES.map((r) => ({ key: r, label: roleLabel(r), hint: t.roleAccess[r] }));
}

function InviteSheet({ form, onClose }: { form: InviteTeammatesForm; onClose: () => void }) {
    const first = form.sent[0];
    return (
        <Modal open onClose={onClose} size="xl">
            {first !== undefined ? (
                <View>
                    <View style={styles.okIcon}>
                        <Icon name="check" size={22} color={c.okFg} />
                    </View>
                    <Text style={styles.sheetTitle}>{t.sentTitle(form.sent.length)}</Text>
                    <Text style={styles.small}>{t.sentBody}</Text>
                    {form.sent.map((inv) => (
                        <View key={inv.id} style={styles.sentRow}>
                            <Icon name="mail" size={14} color={c.muted} />
                            <Text style={styles.sentText}>{inv.email}</Text>
                            <Badge
                                label={roleLabel(inv.role)}
                                intent={memberRoleIntent(inv.role)}
                            />
                        </View>
                    ))}
                    {form.sent.length === 1 ? (
                        <View style={styles.gap}>
                            <Button
                                size="lg"
                                full
                                icon="link"
                                onPress={() => {
                                    Share.share({
                                        message: acceptInviteUrl(publicWebUrl, first.invite_token),
                                    }).catch(() => undefined);
                                }}
                            >
                                {strings.staff.shareLink}
                            </Button>
                        </View>
                    ) : null}
                    <View style={styles.gapSm}>
                        <Button
                            size="lg"
                            full
                            variant="outline"
                            onPress={() => {
                                form.reset();
                                onClose();
                            }}
                        >
                            {strings.common.done}
                        </Button>
                    </View>
                </View>
            ) : (
                <View>
                    <Text style={styles.sheetTitle}>{t.inviteMember}</Text>
                    <TextField
                        label={t.emails}
                        hint={t.emailsHint}
                        type="email"
                        value={form.emails}
                        onChange={form.setEmails}
                        placeholder={t.emailPlaceholder}
                        surface="surface"
                    />
                    <Text style={styles.label}>{t.role}</Text>
                    <Choice<MemberRole>
                        layout="cards"
                        label={t.role}
                        value={form.role}
                        onChange={form.setRole}
                        options={roleOptions()}
                    />
                    {form.error !== null ? (
                        <View style={styles.gapSm}>
                            <Notice tone="danger" banner>
                                {form.error}
                            </Notice>
                        </View>
                    ) : null}
                    <View style={styles.gap}>
                        <Button size="lg" full busy={form.busy} onPress={form.submit}>
                            {t.send}
                        </Button>
                    </View>
                </View>
            )}
        </Modal>
    );
}

function PaySection({ row }: { row: StaffPayRow }) {
    const form = useStaffPayForm(api, row, () => undefined);
    return (
        <DetailSection title={strings.staff.payHeading}>
            <Text style={styles.small}>{staffPaySummary(row)}</Text>
            <Toggle label={strings.staff.isPayee} value={form.isPayee} onChange={form.setIsPayee} />
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
            <View style={styles.gapSm}>
                <Button variant="outline" onPress={form.submit} busy={form.busy}>
                    {strings.common.save}
                </Button>
            </View>
        </DetailSection>
    );
}

function MemberSheet({
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
                        grow
                        onPress={() => {
                            team.changeRole(member.id, role);
                        }}
                        busy={team.busyId === member.id}
                        disabled={role === member.role}
                    >
                        {t.saveRole}
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
                    <Text style={styles.small}>{t.ownerNote}</Text>
                ) : editable ? (
                    <Choice<MemberRole>
                        layout="cards"
                        label={t.changeRole}
                        value={role}
                        onChange={setRole}
                        options={roleOptions()}
                    />
                ) : (
                    <Text style={styles.small}>{t.roleAccess[member.role]}</Text>
                )}
            </DetailSection>
            {team.canManage && pay !== undefined ? <PaySection row={pay} /> : null}
            {editable ? (
                <DetailSection>
                    <Button variant="danger" full onPress={remove}>
                        {t.remove}
                    </Button>
                </DetailSection>
            ) : null}
            {team.error !== null ? <Notice tone="danger">{team.error}</Notice> : null}
        </DetailView>
    );
}

function InviteLine({ invite, team }: { invite: TeamInvite; team: TeamView }) {
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
        <ListRow
            icon="mail"
            title={invite.email}
            detail={`${roleLabel(invite.role)} · ${invite.expired ? t.expired : t.expiresIn(invite.daysLeft)}`}
            intent={invite.expired ? "danger" : "neutral"}
            trailing={
                <View style={styles.inviteActions}>
                    <Button
                        size="sm"
                        variant="outline"
                        busy={team.busyId === invite.id}
                        onPress={() => {
                            team.resend(invite.id);
                        }}
                    >
                        {team.resentIds.includes(invite.id) ? t.resent : t.resend}
                    </Button>
                    <Button size="sm" variant="quiet" onPress={revoke}>
                        {t.revoke}
                    </Button>
                </View>
            }
        />
    );
}

export function Team({ footer }: { footer?: ReactNode }) {
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
    const role = team.viewerRole ?? "staff";

    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.sub}>{t.subtitle}</Text>
                {team.canManage && team.load.hasData ? (
                    <View style={styles.gapSm}>
                        <Button
                            icon="plus"
                            onPress={() => {
                                setInviting(true);
                            }}
                        >
                            {t.inviteMember}
                        </Button>
                    </View>
                ) : null}
                {!team.canManage && team.load.hasData ? (
                    <View style={styles.gapSm}>
                        <Notice tone="info" banner>
                            {team.ownerName === null
                                ? t.readOnlyNoName
                                : t.readOnly(team.ownerName)}
                        </Notice>
                        <View style={[styles.card, styles.access]}>
                            <Text style={styles.accessTitle}>{t.yourRole(roleLabel(role))}</Text>
                            <Text style={styles.small}>{t.roleAccess[role]}</Text>
                            {(t.roleCan[role] ?? []).map((x) => (
                                <View key={x} style={styles.accessRow}>
                                    <Icon name="check" size={14} color={c.okFg} />
                                    <Text style={styles.accessText}>{x}</Text>
                                </View>
                            ))}
                            {(t.roleCant[role] ?? []).map((x) => (
                                <View key={x} style={styles.accessRow}>
                                    <Icon name="x" size={14} color={c.muted} />
                                    <Text style={styles.small}>{x}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                ) : null}
                {team.load.state === "loading" ? (
                    <View style={styles.gap}>
                        <Skeleton variant="row" count={4} label={t.loading} />
                    </View>
                ) : null}
                {team.load.state === "error" ? (
                    <View style={styles.gap}>
                        <LoadFailed
                            variant="card"
                            message={t.loadError}
                            onRetry={team.load.retry}
                            retrying={team.load.retrying}
                        />
                    </View>
                ) : null}
                {team.load.hasData ? (
                    <>
                        <Text style={styles.section}>{strings.staff.members}</Text>
                        <View style={styles.card}>
                            {team.members.map((m) => (
                                <ListRow
                                    key={m.id}
                                    leading={<Avatar name={m.name} color={m.color} />}
                                    title={m.isYou ? `${m.name}${strings.staff.youSuffix}` : m.name}
                                    detail={m.activeLabel || (m.title ?? "")}
                                    meta={
                                        <Badge
                                            label={roleLabel(m.role)}
                                            intent={memberRoleIntent(m.role)}
                                        />
                                    }
                                    label={`${m.name}, ${roleLabel(m.role)}`}
                                    onPress={() => {
                                        setOpenId(m.id);
                                    }}
                                />
                            ))}
                        </View>
                        {team.canManage ? (
                            <>
                                <Text style={styles.section}>{strings.staff.pending}</Text>
                                <View style={styles.card}>
                                    {team.invites.length === 0 ? (
                                        <Text style={styles.empty}>{t.noInvites}</Text>
                                    ) : null}
                                    {team.invites.map((inv) => (
                                        <InviteLine key={inv.id} invite={inv} team={team} />
                                    ))}
                                </View>
                            </>
                        ) : null}
                        {team.error !== null && open === undefined ? (
                            <Notice tone="danger">{team.error}</Notice>
                        ) : null}
                        {team.alone && team.canManage ? (
                            <View style={styles.gap}>
                                <Empty
                                    variant="card"
                                    icon="users"
                                    message={t.aloneTitle}
                                    body={t.aloneBody}
                                />
                            </View>
                        ) : null}
                    </>
                ) : null}
                {footer}
            </ScrollView>
            {open !== undefined ? (
                <MemberSheet
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
                <InviteSheet
                    form={invite}
                    onClose={() => {
                        setInviting(false);
                        invite.reset();
                    }}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 32 },
    sub: { color: c.muted, fontSize: 14, lineHeight: 20 },
    section: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: 22,
        marginBottom: 8,
    },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
    },
    access: { padding: 14, marginTop: 10, gap: 6 },
    accessTitle: { color: c.ink, fontSize: 15, fontWeight: "700" },
    accessRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    accessText: { color: c.inkSoft, fontSize: 14 },
    empty: { color: c.muted, fontSize: 14, paddingVertical: 16, textAlign: "center" },
    sheetTitle: { color: c.ink, fontSize: 20, fontWeight: "700", marginTop: 6 },
    small: { color: c.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
    label: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 16, marginBottom: 8 },
    gap: { marginTop: 18 },
    gapSm: { marginTop: 10 },
    okIcon: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: c.okBg,
        alignItems: "center",
        justifyContent: "center",
    },
    sentRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
    sentText: { flex: 1, color: c.inkSoft, fontSize: 14 },
    inviteActions: { flexDirection: "row", alignItems: "center", gap: 2 },
});
