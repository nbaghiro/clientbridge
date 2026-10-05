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
import { theme } from "@clientbridge/tokens/theme";
import { type ReactNode, useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import {
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

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { publicWebUrl } from "../lib/config";

const c = theme.colors;

export function Team({ footer }: { footer?: ReactNode }) {
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
        <View style={styles.screen}>
            {payRow !== undefined ? (
                <StaffPayDetail
                    key={payRow.id}
                    row={payRow}
                    onClose={() => {
                        setEditingPay(null);
                    }}
                />
            ) : null}
            <ListPage
                summary={strings.staff.subtitle}
                head={<Text style={styles.sectionLabel}>{strings.staff.members}</Text>}
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
                    <View style={styles.member}>
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName}>
                                {staffDisplayName(s)}
                                {s.id === viewer?.staffId ? strings.staff.youSuffix : ""}
                            </Text>
                            {s.invite_email !== null ? (
                                <Text style={styles.rowSub}>{s.invite_email}</Text>
                            ) : null}
                            {manager ? <PaySummary row={pay.find((p) => p.id === s.id)} /> : null}
                        </View>
                        <Text style={styles.roleText}>{s.role}</Text>
                    </View>
                )}
                footer={
                    <View style={styles.footer}>
                        {pending.length > 0 ? (
                            <>
                                <Text style={styles.sectionLabel}>{strings.staff.pending}</Text>
                                <Panel flush>
                                    {pending.map((s, i) => (
                                        <View
                                            key={s.id}
                                            style={[styles.row, i > 0 && styles.rowBorder]}
                                        >
                                            <Text style={styles.rowName}>
                                                {s.invite_email ?? "—"}
                                            </Text>
                                            <StatusPill
                                                status={strings.staff.invitedBadge(s.role)}
                                                intent="warning"
                                            />
                                        </View>
                                    ))}
                                </Panel>
                            </>
                        ) : null}

                        {canManageStaff(role) ? (
                            <InviteForm invite={invite} />
                        ) : (
                            <Text style={styles.note}>{strings.staff.cannotInvite}</Text>
                        )}
                        {footer}
                    </View>
                }
            />
        </View>
    );
}

function InviteForm({ invite }: { invite: ReturnType<typeof useInviteForm> }) {
    return (
        <>
            <Text style={styles.sectionLabel}>{strings.staff.inviteHeading}</Text>
            <Panel>
                <TextField
                    label={strings.staff.email}
                    type="email"
                    value={invite.email}
                    onChange={invite.setEmail}
                    placeholder={strings.staff.emailPlaceholder}
                />
                <Select
                    label={strings.staff.role}
                    value={invite.role}
                    options={INVITABLE_ROLES.map((r) => ({ key: r.value, label: r.label }))}
                    onChange={invite.setRole}
                />

                {invite.error !== null ? <Notice tone="danger">{invite.error}</Notice> : null}

                <View style={styles.submitGap}>
                    <Button size="lg" full onPress={invite.submit} busy={invite.busy}>
                        {strings.staff.sendInvite}
                    </Button>
                </View>

                {invite.invite !== null ? (
                    <InviteLink invite={invite.invite} onDone={invite.reset} />
                ) : null}
            </Panel>
        </>
    );
}

function InviteLink({ invite, onDone }: { invite: Invite; onDone: () => void }) {
    const link = acceptInviteUrl(publicWebUrl, invite.invite_token);
    const share = (): void => {
        Share.share({ message: link }).catch(() => undefined);
    };
    return (
        <View style={styles.linkBox}>
            <Text style={styles.linkLabel}>{strings.staff.inviteSentMobile(invite.email)}</Text>
            <Text style={styles.link} numberOfLines={2} selectable>
                {link}
            </Text>
            <View style={styles.linkActions}>
                <Button size="sm" onPress={share}>
                    {strings.staff.shareLink}
                </Button>
                <Button variant="quiet" size="sm" onPress={onDone}>
                    {strings.common.done}
                </Button>
            </View>
        </View>
    );
}

function PaySummary({ row }: { row: StaffPayRow | undefined }) {
    if (row === undefined) return null;
    return <Text style={styles.rowSub}>{staffPaySummary(row)}</Text>;
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
                    {strings.catalog.save}
                </Button>
            }
        >
            <DetailSection>
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
            </DetailSection>
        </DetailView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    footer: { paddingTop: 16 },
    member: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    sectionLabel: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 0.4,
        marginBottom: 8,
        marginTop: 18,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 13,
        gap: 12,
    },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    rowMain: { flex: 1 },
    rowName: { color: c.ink, fontSize: 15, fontWeight: "600" },
    rowSub: { color: c.muted, fontSize: 12, marginTop: 1 },
    roleText: { color: c.inkSoft, fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
    note: { color: c.muted, fontSize: 13, marginTop: 18 },
    submitGap: { marginTop: 14 },
    linkBox: {
        marginTop: 14,
        padding: 12,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.accent,
        backgroundColor: c.accentWeak,
    },
    linkLabel: { color: c.ink, fontSize: 13, fontWeight: "600" },
    link: { color: c.inkSoft, fontSize: 12, marginTop: 6 },
    linkActions: { flexDirection: "row", gap: 8, marginTop: 10 },
});
