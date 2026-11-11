import { type PaymentsTabKey, type SalesView, visiblePaymentsTabs } from "@clientbridge/app-core";
import { type RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { type ReactElement, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Tabs } from "@clientbridge/ui";

import { useRole } from "../lib/auth";
import type { RootStackParamList } from "../navigation";
import { GiftCards } from "./GiftCards";
import { Invoices } from "./Invoices";
import { Earnings } from "./Earnings";
import { POS } from "./POS";
import { Payouts } from "./Payouts";
import { Refunds } from "./Refunds";
import { Remittances } from "./Remittances";
import { Reports } from "./Reports";

export function PaymentsScreen() {
    const params = useRoute<RouteProp<RootStackParamList, "Payments">>().params;
    const tabs = visiblePaymentsTabs(useRole());
    const [tab, setTab] = useState<PaymentsTabKey>(params?.tab ?? "invoices");
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList, "Payments">>();
    useEffect(() => {
        if (params?.tab !== undefined) setTab(params.tab);
    }, [params?.tab]);
    // Sales has taken the view by now, so the next link to the same view switches again
    useEffect(() => {
        if (params?.view !== undefined) nav.setParams({ view: undefined });
    }, [nav, params?.view]);
    const current = tabs.find((t) => t.key === tab) ?? tabs[0];

    return (
        <SafeAreaView style={styles.screen} edges={["bottom"]}>
            {current === undefined ? null : (
                <>
                    <Tabs items={tabs} active={current.key} onSelect={setTab} />
                    <View style={styles.body}>{tabBody(current.key, params?.view)}</View>
                </>
            )}
        </SafeAreaView>
    );
}

function tabBody(key: PaymentsTabKey, view: SalesView | undefined): ReactElement {
    switch (key) {
        case "invoices":
            return <Invoices />;
        case "sales":
            return <POS view={view} />;
        case "giftCards":
            return <GiftCards />;
        case "refunds":
            return <Refunds />;
        case "staffPay":
            return <Earnings />;
        case "taxReturns":
            return <Remittances />;
        case "payouts":
            return <Payouts />;
        case "reports":
            return <Reports />;
    }
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    body: { flex: 1, paddingTop: 8 },
});
