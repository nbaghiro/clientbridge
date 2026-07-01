import { strings } from "../strings";

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
    { key: "giftCards", label: strings.nav.giftCards },
    { key: "payouts", label: strings.nav.payouts },
    { key: "reviews", label: strings.nav.reviews },
    { key: "reports", label: strings.nav.reports },
];

/** The Settings hub sections (label + order), shared so the two platforms can't diverge. Each app
 *  maps `key` to its own route: web → `/settings/${key}`, mobile → its stack screen name. */
export const SETTINGS_SECTIONS: { key: SettingsSectionKey; label: string }[] = [
    { key: "account", label: strings.nav.account },
    { key: "catalog", label: strings.nav.catalog },
    { key: "taxes", label: strings.nav.taxes },
    { key: "payments", label: strings.nav.payments },
    { key: "team", label: strings.nav.team },
    { key: "scheduling", label: strings.nav.scheduling },
    { key: "booking", label: strings.nav.booking },
];
