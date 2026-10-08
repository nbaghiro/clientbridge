import { type PaymentsTabKey, visiblePaymentsTabs } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { type RouteProp, useRoute } from "@react-navigation/native";
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
    useEffect(() => {
        if (params?.tab !== undefined) setTab(params.tab);
    }, [params?.tab, params?.create]);
    const current = tabs.find((t) => t.key === tab) ?? tabs[0];

    return (
        <SafeAreaView style={styles.screen} edges={["bottom"]}>
            {current === undefined ? null : (
                <>
                    <Tabs items={tabs} active={current.key} onSelect={setTab} />
                    <View style={styles.body}>
                        {tabBody(
                            current.key,
                            tab === "invoices" ? params?.create : undefined,
                            tab === "invoices" || tab === "refunds" ? params?.open : undefined,
                        )}
                    </View>
                </>
            )}
        </SafeAreaView>
    );
}

function tabBody(
    key: PaymentsTabKey,
    createToken: number | undefined,
    openId: string | undefined,
): ReactElement {
    switch (key) {
        case "invoices":
            return <Invoices createToken={createToken} openId={openId} />;
        case "sales":
            return <POS />;
        case "giftCards":
            return <GiftCards />;
        case "refunds":
            return <Refunds openId={openId} />;
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
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    body: { flex: 1, paddingTop: 8 },
});
