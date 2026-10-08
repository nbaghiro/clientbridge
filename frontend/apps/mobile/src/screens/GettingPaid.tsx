import {
    formatDate,
    formatMoney,
    strings,
    useAsyncAction,
    useGettingPaid,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import {
    Button,
    PaymentAccount,
    Empty,
    Icon,
    KeyValueList,
    LoadFailed,
    Notice,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { publicWebUrl } from "../lib/config";

const c = theme.colors;
const g = strings.gettingPaid;

export function GettingPaidScreen() {
    const paid = useGettingPaid(api);
    const web = useAsyncAction();
    const manageOnWeb = (): void => {
        web.run(
            () =>
                Linking.openURL(
                    `${publicWebUrl.replace(/\/$/, "")}/setup/getting-paid?manage=account`,
                ),
            { errorMessage: strings.paymentAccount.webError },
        );
    };
    const { refresh } = paid;
    useFocusEffect(
        useCallback(() => {
            refresh();
        }, [refresh]),
    );
    const warn = paid.phase !== "enabled";
    const act = paid.phase === "restricted" || paid.phase === "in_progress";
    const deadline = paid.deadline === null ? "" : formatDate(paid.deadline);

    if (paid.account.props !== null) return <PaymentAccount {...paid.account.props} />;
    if (paid.phase === "loading") {
        return (
            <View style={styles.screen}>
                <View style={styles.content}>
                    <Skeleton variant="line" count={3} label={g.loadingStatus} />
                    <Skeleton variant="row" count={3} label={g.loadingStatus} />
                </View>
            </View>
        );
    }
    if (paid.phase === "error") {
        return (
            <View style={styles.screen}>
                <View style={styles.content}>
                    <LoadFailed
                        variant="card"
                        message={g.loadError}
                        retrying={paid.refreshing}
                        onRetry={paid.refresh}
                    />
                </View>
            </View>
        );
    }
    if (paid.phase === "not_connected") {
        return (
            <View style={styles.screen}>
                <View style={styles.content}>
                    <Empty
                        variant="card"
                        icon="card"
                        message={g.connectTitle}
                        body={paid.message}
                        actions={
                            <Button disabled={!paid.account.ready} onPress={paid.finish}>
                                {g.connect}
                            </Button>
                        }
                    />
                </View>
            </View>
        );
    }
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.content}>
                <View style={[styles.hero, warn ? styles.heroWarn : styles.heroOk]}>
                    <Icon
                        name={warn ? "alert" : "checkCircle"}
                        size={22}
                        color={warn ? c.warnFg : c.okFg}
                    />
                    <Text style={styles.heroTitle}>{paid.title}</Text>
                    <Text style={styles.heroBody}>{paid.message}</Text>
                </View>
                <Button variant="outline" icon="external" busy={web.busy} onPress={manageOnWeb}>
                    {strings.paymentAccount.manageOnWeb}
                </Button>
                {web.error !== null ? <Notice tone="danger">{web.error}</Notice> : null}

                <Text style={styles.section}>{g.whatsNeeded}</Text>
                <View style={styles.card}>
                    {paid.requirements.length === 0 ? (
                        <Text style={styles.small}>{g.nothingNeeded}</Text>
                    ) : null}
                    {paid.requirements.map((r, i) => (
                        <View key={r.key} style={[styles.req, i > 0 && styles.divider]}>
                            <View style={styles.reqHead}>
                                <Text style={styles.reqTitle}>{r.label}</Text>
                                <StatusPill
                                    asWritten
                                    status={
                                        r.pastDue
                                            ? g.pastDue
                                            : deadline === ""
                                              ? g.dueSoon
                                              : g.due(deadline)
                                    }
                                    intent={r.pastDue ? "danger" : "warning"}
                                />
                            </View>
                            {r.why !== "" ? <Text style={styles.small}>{r.why}</Text> : null}
                        </View>
                    ))}
                </View>
                <View style={styles.help}>
                    <Icon name="shield" size={14} color={c.muted} />
                    <Text style={[styles.small, styles.flex]}>{g.help}</Text>
                </View>

                <Text style={styles.section}>{g.capabilities}</Text>
                <View style={styles.card}>
                    <KeyValueList
                        rows={[
                            {
                                label: g.capCards,
                                value: paid.chargesEnabled ? g.capOn : g.capOff,
                                intent: paid.chargesEnabled ? "success" : "warning",
                            },
                            {
                                label: g.capTap,
                                value: paid.chargesEnabled ? g.capOn : g.capOff,
                                intent: paid.chargesEnabled ? "success" : "warning",
                            },
                            {
                                label: g.capPayouts,
                                value: paid.payoutsEnabled ? g.capOn : g.capOff,
                                intent: paid.payoutsEnabled ? "success" : "warning",
                            },
                        ]}
                    />
                </View>

                <Text style={styles.section}>{g.balance}</Text>
                <View style={styles.card}>
                    <KeyValueList
                        rows={[
                            {
                                label: paid.payoutsEnabled ? g.available : g.held,
                                value:
                                    paid.availableCents === null
                                        ? g.balanceUnknown
                                        : formatMoney(paid.availableCents),
                            },
                        ]}
                    />
                </View>
            </ScrollView>
            <View style={styles.footer}>
                <View style={styles.flex}>
                    <Button
                        size="lg"
                        full
                        variant="outline"
                        busy={paid.refreshing}
                        onPress={paid.refresh}
                    >
                        {paid.refreshing ? g.checking : g.refresh}
                    </Button>
                </View>
                {act ? (
                    <View style={styles.flex}>
                        <Button size="lg" full disabled={!paid.account.ready} onPress={paid.finish}>
                            {g.finish}
                        </Button>
                    </View>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 24, gap: 12 },
    hero: { borderRadius: theme.radius, padding: 16, gap: 6 },
    heroWarn: { backgroundColor: c.warnBg },
    heroOk: { backgroundColor: c.okBg },
    heroTitle: { color: c.ink, fontSize: 18, fontWeight: "700", marginTop: 4 },
    heroBody: { color: c.inkSoft, fontSize: 14, lineHeight: 20 },
    section: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: 10,
    },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        paddingHorizontal: 14,
        paddingVertical: 4,
    },
    req: { paddingVertical: 12 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderSoft },
    reqHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    reqTitle: { color: c.ink, fontSize: 15, fontWeight: "600", flexShrink: 1 },
    small: { color: c.muted, fontSize: 13, lineHeight: 18, marginTop: 3 },
    flex: { flex: 1 },
    help: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
    footer: {
        flexDirection: "row",
        gap: 10,
        padding: 16,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        backgroundColor: c.surface,
    },
});
