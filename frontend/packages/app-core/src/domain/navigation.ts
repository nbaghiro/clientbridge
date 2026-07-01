export type SettingsSectionKey =
    | "account"
    | "catalog"
    | "taxes"
    | "payments"
    | "team"
    | "scheduling"
    | "booking";

export type MoneyNavKey = "giftCards" | "payouts" | "reviews" | "reports";

/** The admin-only "money" destinations (all gated by `canManagePayments`), shared so the web sidebar
 *  and the mobile Home money section stay in lockstep on the set + labels + gate. Each app maps `key`
 *  to its own route + icon and renders it its own way. */
export const MONEY_NAV_ITEMS: { key: MoneyNavKey; label: string }[] = [
    { key: "giftCards", label: "Gift cards" },
    { key: "payouts", label: "Payouts" },
    { key: "reviews", label: "Reviews" },
    { key: "reports", label: "Reports" },
];

/** The Settings hub sections (label + order), shared so the two platforms can't diverge. Each app
 *  maps `key` to its own route: web → `/settings/${key}`, mobile → its stack screen name. */
export const SETTINGS_SECTIONS: { key: SettingsSectionKey; label: string }[] = [
    { key: "account", label: "Account" },
    { key: "catalog", label: "Catalog & services" },
    { key: "taxes", label: "Taxes" },
    { key: "payments", label: "Payments" },
    { key: "team", label: "Team" },
    { key: "scheduling", label: "Scheduling" },
    { key: "booking", label: "Booking & forms" },
];
