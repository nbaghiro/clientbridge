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
import {
    ActivityIndicator,
    Pressable,
    Share,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";

import { DetailSection, DetailView } from "../ui/DetailView";
import { ListPage } from "../ui/ListPage";
import { ui } from "../ui/styles";
import { StatusPill } from "../ui/StatusPill";
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
                summary={strings.team.subtitle}
                head={<Text style={styles.sectionLabel}>{strings.team.members}</Text>}
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
                    <View style={styles.member}>
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName}>
                                {staffDisplayName(s)}
                                {s.id === viewer?.staffId ? strings.team.youSuffix : ""}
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
                                <Text style={styles.sectionLabel}>{strings.team.pending}</Text>
                                <View style={styles.group}>
                                    {pending.map((s, i) => (
                                        <View
                                            key={s.id}
                                            style={[styles.row, i > 0 && styles.rowBorder]}
                                        >
                                            <Text style={styles.rowName}>
                                                {s.invite_email ?? "—"}
                                            </Text>
                                            <StatusPill
                                                status={strings.team.invitedBadge(s.role)}
                                                intent="warning"
                                            />
                                        </View>
                                    ))}
                                </View>
                            </>
                        ) : null}

                        {canManageStaff(role) ? (
                            <InviteForm invite={invite} />
                        ) : (
                            <Text style={styles.note}>{strings.team.cannotInvite}</Text>
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
            <Text style={styles.sectionLabel}>{strings.team.inviteHeading}</Text>
            <View style={styles.panel}>
                <Text style={styles.fieldLabel}>{strings.team.email}</Text>
                <TextInput
                    style={styles.input}
                    value={invite.email}
                    onChangeText={invite.setEmail}
                    placeholder={strings.team.emailPlaceholder}
                    placeholderTextColor={c.muted}
                    autoCapitalize="none"
                    keyboardType="email-address"
                />

                <Text style={styles.fieldLabel}>{strings.team.role}</Text>
                <View style={styles.chipRow}>
                    {INVITABLE_ROLES.map((r) => {
                        const on = invite.role === r.value;
                        return (
                            <Pressable
                                key={r.value}
                                style={[styles.chip, on && styles.chipOn]}
                                onPress={() => {
                                    invite.setRole(r.value);
                                }}
                            >
                                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                    {r.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>

                {invite.error !== null ? <Text style={styles.error}>{invite.error}</Text> : null}

                <Pressable
                    style={[styles.submit, invite.busy && styles.dim]}
                    onPress={invite.submit}
                    disabled={invite.busy}
                >
                    {invite.busy ? (
                        <ActivityIndicator color={c.accentInk} />
                    ) : (
                        <Text style={styles.submitText}>{strings.team.sendInvite}</Text>
                    )}
                </Pressable>

                {invite.invite !== null ? (
                    <InviteLink invite={invite.invite} onDone={invite.reset} />
                ) : null}
            </View>
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
            <Text style={styles.linkLabel}>{strings.team.inviteSentMobile(invite.email)}</Text>
            <Text style={styles.link} numberOfLines={2} selectable>
                {link}
            </Text>
            <View style={styles.linkActions}>
                <Pressable style={styles.shareBtn} onPress={share}>
                    <Text style={styles.shareText}>{strings.team.shareLink}</Text>
                </Pressable>
                <Pressable style={styles.doneBtn} onPress={onDone}>
                    <Text style={styles.doneText}>{strings.common.done}</Text>
                </Pressable>
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
            subtitle={strings.team.payHeading}
            onClose={onClose}
            actions={
                <Pressable style={ui.primary} onPress={form.submit} disabled={form.busy}>
                    {form.busy ? (
                        <ActivityIndicator color={c.accentInk} />
                    ) : (
                        <Text style={ui.primaryText}>{strings.catalog.save}</Text>
                    )}
                </Pressable>
            }
        >
            <DetailSection>
                <View style={styles.payToggle}>
                    <Text style={styles.payToggleLabel}>{strings.team.isPayee}</Text>
                    <Switch value={form.isPayee} onValueChange={form.setIsPayee} />
                </View>
                {form.isPayee ? (
                    <>
                        <Text style={ui.label}>{strings.team.rateType}</Text>
                        <View style={ui.chipWrap}>
                            {RATE_TYPES.map((t) => (
                                <Pressable
                                    key={t.value}
                                    style={[ui.chip, form.rateType === t.value ? ui.chipOn : null]}
                                    onPress={() => {
                                        form.setRateType(t.value);
                                    }}
                                >
                                    <Text
                                        style={[
                                            ui.chipText,
                                            form.rateType === t.value ? ui.chipTextOn : null,
                                        ]}
                                    >
                                        {t.label}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                        <Text style={ui.label}>{strings.team.rateLabel(form.rateType)}</Text>
                        <TextInput
                            style={styles.input}
                            value={form.rate}
                            onChangeText={form.setRate}
                            keyboardType="decimal-pad"
                        />
                        <Text style={ui.label}>{strings.team.retailRate}</Text>
                        <TextInput
                            style={styles.input}
                            value={form.retailPercent}
                            onChangeText={form.setRetailPercent}
                            keyboardType="decimal-pad"
                        />
                    </>
                ) : null}
                {form.error !== null ? <Text style={ui.error}>{form.error}</Text> : null}
            </DetailSection>
        </DetailView>
    );
}

const styles = StyleSheet.create({
    payToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    payToggleLabel: { color: c.ink, fontSize: 14, flex: 1, marginRight: 12 },
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
    group: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
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
    panel: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 14,
    },
    fieldLabel: {
        color: c.inkSoft,
        fontSize: 13,
        fontWeight: "600",
        marginBottom: 6,
        marginTop: 10,
    },
    input: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 11,
        color: c.ink,
        fontSize: 15,
        backgroundColor: c.bg,
    },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 14,
        paddingVertical: 8,
        backgroundColor: c.bg,
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
    chipTextOn: { color: c.accentInk },
    error: { color: c.danFg, fontSize: 13, marginTop: 10 },
    submit: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingVertical: 13,
        alignItems: "center",
        marginTop: 14,
    },
    dim: { opacity: 0.7 },
    submitText: { color: c.accentInk, fontSize: 15, fontWeight: "700" },
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
    shareBtn: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 14,
        paddingVertical: 9,
    },
    shareText: { color: c.accentInk, fontSize: 13, fontWeight: "700" },
    doneBtn: { paddingHorizontal: 12, paddingVertical: 9 },
    doneText: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
});
