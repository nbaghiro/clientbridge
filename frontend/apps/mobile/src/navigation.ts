import type { PaymentsTabKey } from "@clientbridge/app-core";
import type { NavigatorScreenParams } from "@react-navigation/native";

// A React Navigation param list must stay a `type` (object-literal types satisfy ParamListBase;
// an interface would need a typing-weakening index signature).
// `create` is a one-shot token: a fresh value asks the screen to open its new-item form.
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
