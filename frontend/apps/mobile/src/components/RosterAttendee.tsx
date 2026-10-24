import { type RosterEntry, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Avatar, Badge, Button, StatusPill } from "@clientbridge/ui";
import { StyleSheet, Text, View } from "react-native";

const c = theme.colors;
const s = strings.classes;

interface RosterActions {
    checkIn: (key: string) => void;
    undo: (key: string) => void;
    noShow: (key: string) => void;
}

/** One person on a session's roster: who they are, pickups, and check-in once the day comes. */
export function RosterAttendee({
    a,
    started,
    actions,
    first,
}: {
    a: RosterEntry;
    started: boolean;
    actions: RosterActions;
    first: boolean;
}) {
    return (
        <View style={[styles.row, !first && styles.divider]}>
            <Avatar name={a.subjectName} size="sm" />
            <View style={styles.flex}>
                <Text style={styles.subject} numberOfLines={1}>
                    {a.subjectName}
                    {a.subjectName !== a.clientName ? (
                        <Text style={styles.muted}>
                            {`${strings.common.separator}${a.clientName}`}
                        </Text>
                    ) : null}
                </Text>
                <View style={styles.badges}>
                    {a.note !== null ? <Badge label={a.note} intent="warning" /> : null}
                    {a.paid ? null : <Badge label={s.unpaid} intent="danger" />}
                </View>
                {a.pickup !== null ? (
                    <Text style={styles.muted} numberOfLines={2}>
                        {a.pickup}
                    </Text>
                ) : null}
            </View>
            {a.status === "confirmed" && started ? (
                <View style={styles.actions}>
                    <Button
                        style={{ alignSelf: "center" }}
                        size="sm"
                        variant="quiet"
                        onPress={() => {
                            actions.noShow(a.key);
                        }}
                    >
                        {s.noShow}
                    </Button>
                    <Button
                        style={{ alignSelf: "center" }}
                        size="sm"
                        onPress={() => {
                            actions.checkIn(a.key);
                        }}
                    >
                        {s.checkIn}
                    </Button>
                </View>
            ) : (
                <View style={styles.actions}>
                    <StatusPill
                        style={{ alignSelf: "center" }}
                        status={a.statusLabel}
                        intent={a.intent}
                    />
                    {a.status === "checked_in" || a.status === "no_show" ? (
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            variant="link"
                            onPress={() => {
                                actions.undo(a.key);
                            }}
                        >
                            {s.undo}
                        </Button>
                    ) : null}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    flex: { flex: 1, minWidth: 0 },
    subject: { color: c.ink, fontSize: 15, fontWeight: "600" },
    muted: { color: c.muted, fontSize: 13 },
    badges: { flexDirection: "row", gap: 6, marginTop: 4 },
    actions: { flexDirection: "row", alignItems: "center", gap: 6 },
});
