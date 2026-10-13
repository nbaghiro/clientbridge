import { describe, expect, it } from "vitest";

import { formatDate } from "../datetime";
import { strings } from "../strings";
import { planAccess, planNotice, trialDaysLeft, trialDetail } from "./plans";

const p = strings.plans;
const NOW = new Date("2026-10-12T12:00:00Z");
const HOUR = 3_600_000;

describe("planAccess", () => {
    it("ends the trial at its last instant", () => {
        expect(planAccess("trialing", new Date(NOW.getTime() + 1), NOW)).toBe("trial");
        expect(planAccess("trialing", NOW, NOW)).toBe("lapsed");
    });

    it("keeps full access while active or past due", () => {
        expect(planAccess("active", NOW, NOW)).toBe("active");
        expect(planAccess("past_due", NOW, NOW)).toBe("past_due");
        expect(planAccess("lapsed", new Date(NOW.getTime() + HOUR), NOW)).toBe("lapsed");
    });
});

describe("trialDaysLeft", () => {
    it("counts a part day as a whole one and never goes below zero", () => {
        expect(trialDaysLeft(new Date(NOW.getTime() + 49 * HOUR), NOW)).toBe(3);
        expect(trialDaysLeft(new Date(NOW.getTime() + HOUR), NOW)).toBe(1);
        expect(trialDaysLeft(new Date(NOW.getTime() - HOUR), NOW)).toBe(0);
    });
});

describe("planNotice", () => {
    it("shows a paused business to everyone and the way out only to the owner", () => {
        expect(planNotice({ access: "lapsed", daysLeft: 0 }, "staff")).toEqual({
            tone: "danger",
            message: p.noticeLapsed,
            action: null,
        });
        expect(planNotice({ access: "lapsed", daysLeft: 0 }, "owner")?.action).toBe(p.noticeChoose);
        expect(planNotice({ access: "past_due", daysLeft: 0 }, "owner")?.action).toBe(p.noticeFix);
    });

    it("warns only the owner in the last three days of the trial", () => {
        expect(planNotice({ access: "trial", daysLeft: 3 }, "owner")?.message).toBe(
            p.noticeTrial(3),
        );
        expect(planNotice({ access: "trial", daysLeft: 4 }, "owner")).toBeNull();
        expect(planNotice({ access: "trial", daysLeft: 1 }, "admin")).toBeNull();
        expect(planNotice({ access: "active", daysLeft: 0 }, "owner")).toBeNull();
        expect(planNotice(null, "owner")).toBeNull();
    });
});

describe("trialDetail", () => {
    const zone = "America/Vancouver";

    it("defers billing to the trial's end only while Checkout can still carry it", () => {
        const carried = new Date(NOW.getTime() + 48 * HOUR);
        expect(trialDetail(carried, NOW, zone)).toBe(p.trialBody(formatDate(carried, zone)));
        const close = new Date(NOW.getTime() + 48 * HOUR - 1);
        expect(trialDetail(close, NOW, zone)).toBe(p.trialBodyBillsNow(formatDate(close, zone)));
    });
});
