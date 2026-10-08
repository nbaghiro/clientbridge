import type { InboxSegmentKey, PaymentsTabKey } from "@clientbridge/app-core";
import type { NavigatorScreenParams } from "@react-navigation/native";

// Param lists stay `type`s: an interface would need an index signature to satisfy ParamListBase.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type TabParamList = {
    Today: undefined;
    Schedule: { create?: number; open?: string } | undefined;
    Clients: { create?: number; open?: string } | undefined;
    Inbox:
        | {
              segment?: InboxSegmentKey;
              create?: number | undefined;
              open?: string | undefined;
              threadId?: string | undefined;
              request?: number | undefined;
          }
        | undefined;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type RootStackParamList = {
    Tabs: NavigatorScreenParams<TabParamList> | undefined;
    Payments: { tab?: PaymentsTabKey; create?: number; open?: string } | undefined;
    Search: undefined;
    Notifications: undefined;
    Setup: undefined;
    Business: undefined;
    Services: undefined;
    Team: undefined;
    GettingPaid: undefined;
    GetSetUp: undefined;
    Taxes: undefined;
    ClientHistory: { clientId: string; name: string };
    ClientPets: { clientId: string; name: string };
    ClientWallet: { clientId: string; name: string };
    Classes: undefined;
    Recurrences: undefined;
    Reminders: undefined;
    OnlineBooking: undefined;
};
