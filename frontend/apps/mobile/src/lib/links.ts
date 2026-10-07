import type { ShellTarget } from "@clientbridge/app-core";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback } from "react";

import type { RootStackParamList } from "../navigation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Opens what a shell target names: a tab, a stack screen, a record or a create form. */
export function useOpenLink(): (target: ShellTarget, refId?: string | null) => void {
    const nav = useNavigation<Nav>();
    return useCallback(
        (target, refId = null) => {
            const only = refId === null ? {} : { open: refId };
            const ref = refId === null ? { create: Date.now() } : { open: refId };
            const tab = (screen: "Today" | "Schedule" | "Clients"): void => {
                nav.navigate("Tabs", { screen, params: undefined });
            };
            switch (target) {
                case "today":
                    tab("Today");
                    return;
                case "schedule":
                    nav.navigate("Tabs", { screen: "Schedule", params: only });
                    return;
                case "booking":
                    nav.navigate("Tabs", { screen: "Schedule", params: ref });
                    return;
                case "clients":
                    tab("Clients");
                    return;
                case "client":
                    nav.navigate("Tabs", { screen: "Clients", params: ref });
                    return;
                case "sale":
                case "checkout":
                case "orders":
                    nav.navigate("Tabs", { screen: "Payments", params: { tab: "sales", ...only } });
                    return;
                case "invoices":
                case "payments":
                    nav.navigate("Tabs", { screen: "Payments", params: { tab: "invoices" } });
                    return;
                case "invoice":
                case "estimate":
                    nav.navigate("Tabs", {
                        screen: "Payments",
                        params: { tab: "invoices", ...ref },
                    });
                    return;
                case "giftCards":
                    nav.navigate("Tabs", { screen: "Payments", params: { tab: "giftCards" } });
                    return;
                case "reports":
                    nav.navigate("Tabs", { screen: "Payments", params: { tab: "reports" } });
                    return;
                case "staffPay":
                    nav.navigate("Tabs", { screen: "Payments", params: { tab: "staffPay" } });
                    return;
                case "inbox":
                    nav.navigate("Inbox", undefined);
                    return;
                case "message":
                    nav.navigate("Inbox", ref);
                    return;
                case "reviews":
                    nav.navigate("Inbox", { segment: "reviews" });
                    return;
                case "stock":
                case "catalog":
                    nav.navigate("Services");
                    return;
                case "hours":
                case "team":
                    nav.navigate("Team");
                    return;
                case "business":
                    nav.navigate("Business");
                    return;
                case "gettingPaid":
                    nav.navigate("GettingPaid");
                    return;
                case "onlineBooking":
                    nav.navigate("OnlineBooking");
                    return;
                case "search":
                    nav.navigate("Search");
                    return;
                case "notifications":
                    nav.navigate("Notifications");
                    return;
            }
        },
        [nav],
    );
}
