import { type PaymentsTabKey, strings, visiblePaymentsTabs } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { type RouteProp, useRoute } from "@react-navigation/native";
import { type ReactElement, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Segmented } from "../components/Segmented";
import { useRole } from "../lib/auth";
import type { TabParamList } from "../navigation";
import { GiftCardsScreen } from "./GiftCards";
import { InvoicesScreen } from "./Invoices";
import { PayoutsScreen } from "./Payouts";
import { POSScreen } from "./POS";
import { ReportsScreen } from "./Reports";

export function PaymentsScreen() {
    const insets = useSafeAreaInsets();
    const params = useRoute<RouteProp<TabParamList, "Payments">>().params;
    const tabs = visiblePaymentsTabs(useRole());
    const [tab, setTab] = useState<PaymentsTabKey>(params?.tab ?? "invoices");
    useEffect(() => {
        if (params?.tab !== undefined) setTab(params.tab);
    }, [params?.tab, params?.create]);
    const current = tabs.find((t) => t.key === tab) ?? tabs[0];

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <Text style={styles.title}>{strings.nav.payments}</Text>
            {current === undefined ? null : (
                <>
                    <Segmented items={tabs} active={current.key} onSelect={setTab} />
                    <View style={styles.body}>
                        {tabBody(current.key, tab === "invoices" ? params?.create : undefined)}
                    </View>
                </>
            )}
        </View>
    );
}

function tabBody(key: PaymentsTabKey, createToken: number | undefined): ReactElement {
    switch (key) {
        case "invoices":
            return <InvoicesScreen createToken={createToken} />;
        case "sales":
            return <POSScreen />;
        case "giftCards":
            return <GiftCardsScreen />;
        case "staffPay":
            return <PayoutsScreen />;
        case "reports":
            return <ReportsScreen />;
    }
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    title: {
        color: theme.colors.ink,
        fontSize: 26,
        fontWeight: "700",
        letterSpacing: -0.4,
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 6,
    },
    body: { flex: 1, paddingTop: 8 },
});
