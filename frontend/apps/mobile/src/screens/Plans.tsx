import { strings, usePlan } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { KeyValueList, LoadFailed, Panel, Skeleton, StatusPill } from "@clientbridge/ui";

import { api } from "../lib/api";

const c = theme.colors;
const p = strings.plans;

// Read-only: plans are not sold in the app (App Store guideline 3.1.3(f)).
export function PlansScreen() {
    const plan = usePlan(api);
    const { refresh } = plan;
    useFocusEffect(
        useCallback(() => {
            refresh();
        }, [refresh]),
    );
    if (plan.phase === "loading") {
        return (
            <View style={styles.screen}>
                <View style={styles.content}>
                    <Skeleton variant="line" count={3} label={p.loading} />
                </View>
            </View>
        );
    }
    if (plan.phase === "error") {
        return (
            <View style={styles.screen}>
                <View style={styles.content}>
                    <LoadFailed
                        variant="card"
                        message={p.loadError}
                        retrying={plan.refreshing}
                        onRetry={plan.refresh}
                    />
                </View>
            </View>
        );
    }
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.content}>
                <Panel style={styles.card}>
                    <StatusPill status={plan.status} intent={plan.intent} />
                    <Text style={styles.title}>{plan.title}</Text>
                </Panel>
                <KeyValueList rows={plan.facts} />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 24, gap: 12 },
    card: { gap: 8, alignItems: "flex-start" },
    title: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.section,
        fontWeight: "700",
    },
});
