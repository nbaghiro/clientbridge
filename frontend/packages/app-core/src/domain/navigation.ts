export type SettingsSectionKey =
    | "account"
    | "catalog"
    | "taxes"
    | "payments"
    | "team"
    | "scheduling"
    | "booking";

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
