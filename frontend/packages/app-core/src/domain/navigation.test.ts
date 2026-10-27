// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import {
    clearTasks,
    closeTask,
    openTask,
    replaceTask,
    setupSectionsFor,
    taskFor,
    useTask,
    visibleInboxSegments,
    visiblePaymentsTabs,
} from "./navigation";

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

    it("leaves staff the team and account sections of setup, on web and mobile alike", () => {
        const all = [
            "start",
            "business",
            "services",
            "resources",
            "team",
            "gettingPaid",
            "taxes",
            "onlineBooking",
            "reminders",
            "security",
        ];
        expect(setupSectionsFor("web", "owner").map((s) => s.key)).toEqual(all);
        expect(setupSectionsFor("mobile", "owner").map((s) => s.key)).toEqual(all);
        expect(setupSectionsFor("mobile", "admin").map((s) => s.key)).toEqual(all);
        expect(setupSectionsFor("web", "staff")).toEqual([
            { key: "team", label: n.setupSections.team, webOnly: false, managersOnly: false },
            {
                key: "security",
                label: n.setupSections.security,
                webOnly: false,
                managersOnly: false,
            },
        ]);
        expect(setupSectionsFor("mobile", null).map((s) => s.key)).toEqual(["team", "security"]);
    });
});

describe("tasks", () => {
    it("starts work in place and leaves pages to navigation", () => {
        expect(taskFor("checkout", "bk_1")).toEqual({ kind: "checkout", bookingId: "bk_1" });
        expect(taskFor("sale", null)).toEqual({ kind: "checkout", bookingId: null });
        expect(taskFor("booking", null)).toEqual({ kind: "booking" });
        expect(taskFor("booking", "bk_1")).toEqual({ kind: "bookingRecord", bookingId: "bk_1" });
        expect(taskFor("invoice", null)).toEqual({ kind: "doc", doc: "invoice" });
        expect(taskFor("estimate", null)).toEqual({ kind: "doc", doc: "estimate" });
        expect(taskFor("invoice", "inv_1")).toBeNull();
        expect(taskFor("message", "cl_1")).toBeNull();
        expect(taskFor("refunds", "pay_1")).toEqual({ kind: "refund", paymentId: "pay_1" });
        expect(taskFor("refunds", null)).toBeNull();
        expect(taskFor("client", null)).toEqual({ kind: "clientEditor" });
        expect(taskFor("client", "cl_1")).toEqual({ kind: "clientRecord", clientId: "cl_1" });
        expect(taskFor("schedule", null)).toBeNull();
        expect(taskFor("invoices", null)).toBeNull();
    });

    it("stacks tasks so closing one shows the one it was opened from", () => {
        const { result } = renderHook(() => useTask());
        act(() => {
            openTask({ kind: "clientRecord", clientId: "cl_1" });
            openTask({ kind: "booking", clientId: "cl_1" });
        });
        expect(result.current).toEqual({ kind: "booking", clientId: "cl_1" });
        act(() => {
            replaceTask({ kind: "bookingRecord", bookingId: "bk_1" });
        });
        expect(result.current).toEqual({ kind: "bookingRecord", bookingId: "bk_1" });
        act(() => {
            closeTask();
        });
        expect(result.current).toEqual({ kind: "clientRecord", clientId: "cl_1" });
        act(() => {
            clearTasks();
        });
        expect(result.current).toBeNull();
    });
});
