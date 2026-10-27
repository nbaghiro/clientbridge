import { strings, usePlan } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { KeyValueList, LoadFailed, Panel, Skeleton, StatusPill } from "@clientbridge/ui";

import { api } from "../lib/api";

const c = theme.colors;
const p = strings.plans;

// Read-only: plans are not sold in the app (App Store guideline 3.1.3(f)). Shown in Account & plan.
export function Plans() {
    const plan = usePlan(api);
    const { refresh } = plan;
    useFocusEffect(
        useCallback(() => {
            refresh();
        }, [refresh]),
    );
    if (plan.phase === "loading") {
        return <Skeleton variant="line" count={3} label={p.loading} />;
    }
    if (plan.phase === "error") {
        return (
            <LoadFailed
                variant="card"
                message={p.loadError}
                retrying={plan.refreshing}
                onRetry={plan.refresh}
            />
        );
    }
    return (
        <View style={styles.content}>
            <Text style={styles.heading} accessibilityRole="header">
                {strings.navigation.setupSections.plan}
            </Text>
            <Panel style={styles.card}>
                <StatusPill status={plan.status} intent={plan.intent} />
                <Text style={styles.title}>{plan.title}</Text>
            </Panel>
            <KeyValueList rows={plan.facts} />
        </View>
    );
}

const styles = StyleSheet.create({
    content: { gap: 12, marginTop: 10 },
    heading: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.section,
        fontWeight: "700",
    },
    card: { gap: 8, alignItems: "flex-start" },
    title: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.section,
        fontWeight: "700",
    },
});
