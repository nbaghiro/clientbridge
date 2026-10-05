import type { PaymentsTabKey } from "@clientbridge/app-core";
import type { NavigatorScreenParams } from "@react-navigation/native";

// Param lists stay `type`s: an interface would need an index signature to satisfy ParamListBase.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type TabParamList = {
    Today: undefined;
    Schedule: undefined;
    Clients: { create?: number } | undefined;
    Payments: { tab?: PaymentsTabKey; create?: number } | undefined;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type RootStackParamList = {
    Tabs: NavigatorScreenParams<TabParamList> | undefined;
    Inbox: undefined;
    Setup: undefined;
    Business: undefined;
    Services: undefined;
    Team: undefined;
    GettingPaid: undefined;
};
