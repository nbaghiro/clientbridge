import { canManagePayments, strings } from "@clientbridge/app-core";
import { PageHeader, Tabs } from "@clientbridge/ui";
import { useState } from "react";

import {
    AddonOffers,
    BookingPageSettings,
    BookingPolicySettings,
} from "../components/OnlineBookingSettings";
import { useRole } from "../lib/auth";

type OnlineTab = "page" | "addons" | "policy";

export function OnlineBooking() {
    const role = useRole();
    const [tab, setTab] = useState<OnlineTab>("page");
    const o = strings.onlineBooking;

    if (!canManagePayments(role)) {
        return (
            <PageHeader
                title={strings.navigation.setupSections.onlineBooking}
                subtitle={o.ownerAdminOnly}
            />
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader title={strings.navigation.setupSections.onlineBooking}>
                <Tabs
                    label={o.title}
                    items={[
                        { key: "page", label: o.tabPage },
                        { key: "addons", label: o.tabAddons },
                        { key: "policy", label: o.tabPolicy },
                    ]}
                    active={tab}
                    onSelect={setTab}
                />
            </PageHeader>
            {tab === "page" ? <BookingPageSettings /> : null}
            {tab === "addons" ? <AddonOffers /> : null}
            {tab === "policy" ? <BookingPolicySettings /> : null}
        </div>
    );
}
