import { type ShellTarget, clearTasks, openTask, taskFor } from "@clientbridge/app-core";
import { StackActions, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback } from "react";

import type { RootStackParamList } from "../navigation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Starts a task in place, or opens the tab or stack screen a shell target names. */
export function useOpenLink(): (target: ShellTarget, refId?: string | null) => void {
    const nav = useNavigation<Nav>();
    return useCallback(
        (target, refId = null) => {
            const task = taskFor(target, refId);
            if (task !== null) {
                openTask(task);
                return;
            }
            clearTasks();
            const openTabs = (params: RootStackParamList["Tabs"]): void => {
                nav.dispatch(StackActions.popTo("Tabs", params));
            };
            const only = refId === null ? {} : { open: refId };
            const tab = (screen: "Today" | "Schedule" | "Clients"): void => {
                openTabs({ screen, params: undefined });
            };
            switch (target) {
                case "today":
                    tab("Today");
                    return;
                case "schedule":
                case "booking":
                    openTabs({ screen: "Schedule", params: only });
                    return;
                case "clients":
                case "client":
                    tab("Clients");
                    return;
                case "sale":
                case "checkout":
                case "orders":
                    nav.navigate("Payments", { tab: "sales" });
                    return;
                case "invoices":
                case "payments":
                    nav.navigate("Payments", { tab: "invoices" });
                    return;
                case "invoice":
                case "estimate":
                    nav.navigate("Payments", { tab: "invoices", ...only });
                    return;
                case "giftCards":
                    nav.navigate("Payments", { tab: "giftCards" });
                    return;
                case "refunds":
                    nav.navigate("Payments", { tab: "refunds" });
                    return;
                case "reports":
                    nav.navigate("Payments", { tab: "reports" });
                    return;
                case "staffPay":
                    nav.navigate("Payments", { tab: "staffPay" });
                    return;
                case "taxReturns":
                    nav.navigate("Payments", { tab: "taxReturns" });
                    return;
                case "payouts":
                    nav.navigate("Payments", { tab: "payouts" });
                    return;
                case "inbox":
                    openTabs({
                        screen: "Inbox",
                        params:
                            refId === null
                                ? undefined
                                : {
                                      segment: "messages",
                                      create: undefined,
                                      open: undefined,
                                      threadId: refId,
                                      request: Date.now(),
                                  },
                    });
                    return;
                case "message":
                    openTabs({
                        screen: "Inbox",
                        params: {
                            segment: "messages",
                            create: undefined,
                            open: undefined,
                            threadId: undefined,
                            ...(refId === null ? { create: Date.now() } : { open: refId }),
                            request: Date.now(),
                        },
                    });
                    return;
                case "reviews":
                    openTabs({
                        screen: "Inbox",
                        params: { segment: "reviews", request: Date.now() },
                    });
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
                case "setup":
                    nav.navigate("GetSetUp");
                    return;
                case "taxes":
                    nav.navigate("Taxes");
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
