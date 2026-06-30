import {
    type Invite,
    INVITABLE_ROLES,
    acceptInviteUrl,
    canManageStaff,
    decodeJwtSub,
    staffDisplayName,
    useCurrentRole,
    useInviteForm,
    usePendingInvites,
    useStaff,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { getTokens } from "../lib/auth";
import { publicWebUrl } from "../lib/config";

const c = theme.colors;

export function TeamScreen() {
    const [accessToken, setAccessToken] = useState<string | null>(null);
    useEffect(() => {
        void getTokens().then((t) => {
            setAccessToken(t?.access_token ?? null);
        });
    }, []);

    const role = useCurrentRole(accessToken);
    const myUserId = decodeJwtSub(accessToken);
    const staff = useStaff();
    const pending = usePendingInvites();
    const invite = useInviteForm(api);

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Text style={styles.sectionLabel}>Members</Text>
            <View style={styles.group}>
                {staff.map((s, i) => (
                    <View key={s.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName}>
                                {staffDisplayName(s)}
                                {s.user_id !== null && s.user_id === myUserId ? " (You)" : ""}
                            </Text>
                            {s.invite_email !== null ? (
                                <Text style={styles.rowSub}>{s.invite_email}</Text>
                            ) : null}
                        </View>
                        <Text style={styles.roleText}>{s.role}</Text>
                    </View>
                ))}
            </View>

            {pending.length > 0 ? (
                <>
                    <Text style={styles.sectionLabel}>Pending invites</Text>
                    <View style={styles.group}>
                        {pending.map((s, i) => (
                            <View key={s.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                                <Text style={styles.rowName}>{s.invite_email ?? "—"}</Text>
                                <StatusBadge status={`${s.role} · invited`} intent="warning" />
                            </View>
                        ))}
                    </View>
                </>
            ) : null}

            {canManageStaff(role) ? (
                <InviteForm invite={invite} />
            ) : (
                <Text style={styles.note}>Only owners and admins can invite teammates.</Text>
            )}
        </ScrollView>
    );
}

function InviteForm({ invite }: { invite: ReturnType<typeof useInviteForm> }) {
    return (
        <>
            <Text style={styles.sectionLabel}>Invite a teammate</Text>
            <View style={styles.panel}>
                <Text style={styles.fieldLabel}>Email</Text>
                <TextInput
                    style={styles.input}
                    value={invite.email}
                    onChangeText={invite.setEmail}
                    placeholder="teammate@example.com"
                    placeholderTextColor={c.muted}
                    autoCapitalize="none"
                    keyboardType="email-address"
                />

                <Text style={styles.fieldLabel}>Role</Text>
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
                        <Text style={styles.submitText}>Send invite</Text>
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
        void Share.share({ message: link });
    };
    return (
        <View style={styles.linkBox}>
            <Text style={styles.linkLabel}>Invite sent to {invite.email}. Share this link:</Text>
            <Text style={styles.link} numberOfLines={2} selectable>
                {link}
            </Text>
            <View style={styles.linkActions}>
                <Pressable style={styles.shareBtn} onPress={share}>
                    <Text style={styles.shareText}>Share link</Text>
                </Pressable>
                <Pressable style={styles.doneBtn} onPress={onDone}>
                    <Text style={styles.doneText}>Done</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16 },
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
