import { type PaymentsTabKey, strings, visiblePaymentsTabs } from "@clientbridge/app-core";
import type { ReactElement } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { PageHeader, Tabs } from "@clientbridge/ui";

import { useRole } from "../lib/auth";
import { GiftCards } from "./GiftCards";
import { Invoices } from "./Invoices";
import { Earnings } from "./Earnings";
import { POS } from "./POS";
import { Reports } from "./Reports";

const PAYMENTS_SLUGS: Record<PaymentsTabKey, string> = {
    invoices: "invoices",
    sales: "sales",
    giftCards: "gift-cards",
    staffPay: "staff-pay",
    reports: "reports",
};

function tabBody(key: PaymentsTabKey): ReactElement {
    switch (key) {
        case "invoices":
            return <Invoices />;
        case "sales":
            return <POS />;
        case "giftCards":
            return <GiftCards />;
        case "staffPay":
            return <Earnings />;
        case "reports":
            return <Reports />;
    }
}

export function Payments() {
    const { tab } = useParams();
    const navigate = useNavigate();
    const role = useRole();
    const tabs = visiblePaymentsTabs(role);
    const current = tabs.find((t) => PAYMENTS_SLUGS[t.key] === tab);
    const first = tabs[0];
    if (role === null) return null; // the role syncs in; don't redirect a deep link before it lands
    if (current === undefined) {
        return first === undefined ? null : (
            <Navigate to={`/payments/${PAYMENTS_SLUGS[first.key]}`} replace />
        );
    }

    return (
        <div className="mx-auto max-w-6xl px-8 py-8">
            <PageHeader title={strings.navigation.payments}>
                <div className="border-b border-line">
                    <Tabs
                        items={tabs}
                        active={current.key}
                        onSelect={(key) => {
                            const navigated = navigate(`/payments/${PAYMENTS_SLUGS[key]}`);
                            if (navigated) navigated.catch(() => undefined);
                        }}
                    />
                </div>
            </PageHeader>
            <div className="mt-6">{tabBody(current.key)}</div>
        </div>
    );
}
