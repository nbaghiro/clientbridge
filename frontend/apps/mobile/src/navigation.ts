import type { InboxSegmentKey, PaymentsTabKey, SubjectKind } from "@clientbridge/app-core";
import type { NavigatorScreenParams } from "@react-navigation/native";

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

export type RootStackParamList = {
    Tabs: NavigatorScreenParams<TabParamList> | undefined;
    Payments:
        | { tab?: PaymentsTabKey; create?: number; compose?: "invoice" | "estimate"; open?: string }
        | undefined;
    Search: undefined;
    Notifications: undefined;
    Setup: undefined;
    Business: undefined;
    Services: undefined;
    Team: undefined;
    GettingPaid: undefined;
    Plans: undefined;
    GetSetUp: undefined;
    Taxes: undefined;
    ClientHistory: { clientId: string; name: string };
    ClientSubjects: { clientId: string; name: string; kind: SubjectKind };
    ClientWallet: { clientId: string; name: string };
    Classes: undefined;
    Recurrences: undefined;
    Reminders: undefined;
    Security: undefined;
    OnlineBooking: undefined;
};
