import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { setupSectionsFor, visibleInboxSegments, visiblePaymentsTabs } from "./navigation";

const n = strings.navigation;

describe("what each role sees", () => {
    it("shows managers every payments tab and staff only sales", () => {
        const all = [
            "invoices",
            "sales",
            "giftCards",
            "refunds",
            "staffPay",
            "taxReturns",
            "payouts",
            "reports",
        ];
        expect(visiblePaymentsTabs("owner").map((t) => t.key)).toEqual(all);
        expect(visiblePaymentsTabs("admin").map((t) => t.key)).toEqual(all);
        expect(visiblePaymentsTabs("staff")).toEqual([
            { key: "sales", label: n.paymentsTabs.sales, managersOnly: false },
        ]);
        expect(visiblePaymentsTabs(null).map((t) => t.key)).toEqual(["sales"]);
    });

    it("shows staff only messages in the inbox", () => {
        expect(visibleInboxSegments("owner").map((s) => s.label)).toEqual([
            n.inboxSegments.messages,
            n.inboxSegments.reviews,
            n.inboxSegments.broadcasts,
            n.inboxSegments.forms,
            n.inboxSegments.contracts,
        ]);
        expect(visibleInboxSegments("contractor").map((s) => s.key)).toEqual(["messages"]);
        expect(visibleInboxSegments(null).map((s) => s.key)).toEqual(["messages"]);
    });

    it("leaves staff only the team section of setup, on web and mobile alike", () => {
        const all = [
            "start",
            "business",
            "services",
            "team",
            "gettingPaid",
            "taxes",
            "onlineBooking",
            "reminders",
        ];
        expect(setupSectionsFor("web", "owner").map((s) => s.key)).toEqual(all);
        expect(setupSectionsFor("mobile", "admin").map((s) => s.key)).toEqual(all);
        expect(setupSectionsFor("web", "staff")).toEqual([
            { key: "team", label: n.setupSections.team, webOnly: false, managersOnly: false },
        ]);
        expect(setupSectionsFor("mobile", null).map((s) => s.key)).toEqual(["team"]);
    });
});
