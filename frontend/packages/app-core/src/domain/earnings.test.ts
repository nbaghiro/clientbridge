// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { strings } from "../strings";
import {
    ALL_EARNINGS_SQL,
    statementText,
    useAdjustmentForm,
    useEarningApprovals,
    useMyEarnings,
    useOwedPay,
    useStatementHeader,
} from "./earnings";

const review = vi.hoisted(() => vi.fn());

interface Fixture {
    status?: string;
    paidAt?: string;
    workedAt?: string;
    run?: string;
    through?: string;
    basis?: string;
    of?: string;
    kind?: string;
    label?: string;
}

const earning = (id: string, staff: string, cents: number, f: Fixture = {}) => ({
    id,
    staff_id: staff,
    kind: f.kind ?? "earning",
    basis: f.basis ?? "percent",
    rate: 4000,
    base: cents * 2.5,
    amount_cents: cents,
    status: f.status ?? "pending",
    worked_at: f.workedAt ?? "2026-10-01T15:00:00Z",
    paid_at: f.paidAt ?? null,
    run: f.run ?? null,
    through: f.through ?? null,
    label: f.label ?? "Cut",
    number: null,
    client_name: "Ann",
    of_id: f.of ?? null,
});

const payee = (id: string, name: string, status = "active") => ({
    id,
    name,
    title: null,
    role: "staff",
    color: null,
    status,
    rate_type: "percent",
    rate_bps: 4000,
    rate_cents: null,
    retail_rate_bps: null,
});

const rows = vi.hoisted(() => ({ earnings: [] as unknown[], staff: [] as unknown[] }));

const baseline = () => [
    earning("e_amy_1", "st_amy", 1000, { status: "approved" }),
    earning("e_amy_2", "st_amy", 500, { status: "approved" }),
    earning("e_amy_new", "st_amy", 800, { workedAt: "2026-10-20T15:00:00Z" }),
    earning("e_bo", "st_bo", 9000, { status: "approved" }),
    // 8:30 pm on Dec 31 in Toronto is already the new year in UTC
    earning("e_amy_old", "st_amy", 700, {
        status: "paid",
        paidAt: "2026-01-01T01:30:00Z",
        run: "prun_a",
    }),
    earning("e_amy_jan", "st_amy", 300, {
        status: "paid",
        paidAt: "2027-01-01T06:00:00Z",
        run: "prun_b",
        through: "2026-12-31",
    }),
    earning("e_amy_jan2", "st_amy", 200, {
        status: "paid",
        paidAt: "2027-01-01T06:00:00Z",
        run: "prun_b",
        through: "2026-12-31",
        kind: "tip",
        basis: "tip",
    }),
    earning("e_cy", "st_cy", 200),
    earning("e_di", "st_di", 400, { status: "paid", paidAt: "2025-03-01T15:00:00Z" }),
    earning("e_ed", "st_ed", 100, { status: "approved" }),
    earning("e_ed_back", "st_ed", -300, { basis: "clawback", of: "e_ed_paid", label: "Wash" }),
    earning("e_ed_paid", "st_ed", 600, { status: "paid", paidAt: "2025-05-01T15:00:00Z" }),
];

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data:
            sql === ALL_EARNINGS_SQL
                ? rows.earnings
                : sql.includes("FROM businesses")
                  ? [
                        {
                            name: "Maple and Main",
                            unit: null,
                            street_number: "12",
                            street_name: "King St",
                            city: "Toronto",
                            province: "ON",
                            postal_code: "M5H 1A1",
                        },
                    ]
                  : sql.includes("WHERE s.id = ?")
                    ? [{ name: "Amy", title: null, role: "staff" }]
                    : rows.staff,
        isLoading: false,
        error: undefined,
    }),
}));

vi.mock("../datetime", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../datetime")>()),
    useBusinessZone: () => "America/Toronto",
}));

vi.mock("./previews", () => ({ afterReview: review }));

vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useReplicaLoad: () => ({ state: "ready" }),
}));

const post = vi.fn((): Promise<unknown> => Promise.resolve({}));
const api = { post } as unknown as ApiLike;
const owner = { staffId: "st_owner", owner: true };

const confirm = async (): Promise<void> => {
    const [, go] = review.mock.calls.at(-1) as [unknown, () => void];
    await act(async () => {
        go();
        await Promise.resolve();
    });
};

beforeEach(() => {
    review.mockReset();
    post.mockClear();
    rows.earnings = baseline();
    rows.staff = [
        payee("st_amy", "Amy"),
        payee("st_bo", "Bo"),
        payee("st_cy", "Cy", "removed"),
        payee("st_di", "Di", "removed"),
        payee("st_ed", "Ed"),
    ];
});

describe("useEarningApprovals", () => {
    it("asks to pay only the selected member's approved total, naming them", () => {
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_amy");
        });
        expect(result.current.payLabel).toContain("$15.00");
        act(() => {
            result.current.pay();
        });
        const [request] = review.mock.calls[0] as [{ title: string }];
        expect(request.title).toBe(strings.earnings.review.payTitle("$15.00", "Amy"));
    });

    it("pays exactly the rows picked, approving a pending one on the way", async () => {
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_amy");
        });
        act(() => {
            result.current.togglePick("e_amy_2");
            result.current.togglePick("e_amy_new");
        });
        expect(result.current.payLabel).toContain("$13.00");
        expect(result.current.approveLabel).toBe(strings.earnings.approveSelected(1));
        act(() => {
            result.current.pay();
        });
        await confirm();
        expect(post).toHaveBeenCalledWith(
            "/v1/earnings/pay",
            { ids: ["e_amy_2", "e_amy_new"] },
            expect.anything(),
        );
    });

    it("pays everything done through a day, approved or not, and keeps later work", async () => {
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_amy");
            result.current.setThrough("2026-10-10");
        });
        expect(result.current.lines.map((l) => l.id)).toEqual(["e_amy_1", "e_amy_2"]);
        act(() => {
            result.current.setThrough("2026-10-25");
        });
        expect(result.current.payLabel).toContain("$23.00");
        act(() => {
            result.current.pay();
        });
        await confirm();
        expect(post).toHaveBeenCalledWith(
            "/v1/earnings/pay",
            { ids: ["e_amy_1", "e_amy_2", "e_amy_new"], through: "2026-10-25" },
            expect.anything(),
        );
    });

    it("says nothing was earned by the day when the through day hides everything", () => {
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_amy");
            result.current.setThrough("2026-09-01");
        });
        expect(result.current.lines).toEqual([]);
        expect(result.current.emptyMessage).toBe(strings.earnings.noneThrough);
        expect(result.current.canPay).toBe(false);
    });

    it("drops the through day when leaving To do, so it can't drive a hidden total", () => {
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_amy");
            result.current.setThrough("2026-10-10");
        });
        act(() => {
            result.current.setView("paid");
        });
        expect(result.current.through).toBeNull();
        expect(result.current.payLabel).toContain("$15.00");
    });

    it("settles a clawback of a paid earning with the next pay", () => {
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_ed");
        });
        expect(result.current.payees.find((p) => p.staffId === "st_ed")?.owesBackCents).toBe(200);
        expect(result.current.payLabel).toContain("-$2.00");
        expect(result.current.canPay).toBe(false);
        const back = result.current.lines.find((l) => l.id === "e_ed_back");
        expect(back?.title).toBe(strings.earnings.refundOf("Wash"));
    });

    it("settles refunded work that nets to nothing, after asking", async () => {
        rows.earnings = [
            ...baseline(),
            earning("e_cy_done", "st_cy", 500, { status: "approved" }),
            earning("e_cy_done_back", "st_cy", -500, { basis: "clawback", of: "e_cy_done" }),
        ];
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_cy");
            result.current.togglePick("e_cy_done");
        });
        expect(result.current.payLabel).toBe(strings.earnings.settle);
        expect(result.current.canPay).toBe(true);
        act(() => {
            result.current.pay();
        });
        expect(review).toHaveBeenLastCalledWith(
            expect.objectContaining({ title: strings.earnings.review.settleTitle("Cy") }),
            expect.anything(),
        );
        await confirm();
        expect(post).toHaveBeenLastCalledWith(
            "/v1/earnings/pay",
            { ids: ["e_cy_done"] },
            expect.anything(),
        );
    });

    it("names a run that settled at nothing a settlement when undoing it", () => {
        rows.earnings = [
            ...baseline(),
            earning("e_cy_s", "st_cy", 500, {
                status: "paid",
                paidAt: "2026-10-02T15:00:00Z",
                run: "prun_s",
            }),
            earning("e_cy_s_back", "st_cy", -500, {
                basis: "clawback",
                of: "e_cy_s",
                status: "paid",
                paidAt: "2026-10-02T15:00:00Z",
                run: "prun_s",
            }),
        ];
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_cy");
            result.current.setView("paid");
        });
        const run = result.current.paidGroups.find((g) => g.key === "prun_s");
        expect(run?.totalCents).toBe(0);
        act(() => {
            if (run !== undefined) result.current.undoRun(run);
        });
        expect(review).toHaveBeenLastCalledWith(
            expect.objectContaining({ title: strings.earnings.review.undoSettleTitle("Cy") }),
            expect.anything(),
        );
    });

    it("holds a returned tip back until the tip it returns is paid", () => {
        rows.earnings = [
            ...baseline(),
            earning("e_cy_ok", "st_cy", 500, { status: "approved" }),
            earning("t_cy", "st_cy", 300, { kind: "tip", basis: "tip" }),
            earning("t_cy_back", "st_cy", -300, { kind: "tip", basis: "tip", of: "t_cy" }),
        ];
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_cy");
        });
        expect(result.current.payLabel).toContain("$5.00");
        expect(result.current.canPay).toBe(true);
    });

    it("groups paid rows by pay run, with the work they covered and their parts", () => {
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_amy");
            result.current.setView("paid");
        });
        const groups = result.current.paidGroups;
        expect(groups.map((g) => [g.key, g.totalCents])).toEqual([
            ["prun_b", 500],
            ["prun_a", 700],
        ]);
        const [latest] = groups;
        expect(latest?.label).toBe(strings.earnings.paidOn(latest?.day ?? ""));
        expect(latest?.through).toContain("Dec");
        expect(latest?.parts.map((p) => [p.label, p.cents])).toEqual([
            [strings.earnings.part.work, 300],
            [strings.earnings.part.tips, 200],
        ]);
        expect(latest === undefined ? "" : result.current.runCsvPath(latest)).toBe(
            "/v1/reports/staff-pay.csv?start=2027-01-01&end=2027-01-01&run=prun_b",
        );
    });

    it("undoes one payment or a whole run, only after asking", async () => {
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_amy");
            result.current.setView("paid");
        });
        const run = result.current.paidGroups[0];
        const paid = run?.lines[0];
        expect(paid?.undo).toBe("unpay");
        act(() => {
            if (paid !== undefined) result.current.undo(paid);
        });
        expect(post).not.toHaveBeenCalled();
        await confirm();
        expect(post).toHaveBeenCalledWith(
            "/v1/earnings/unpay",
            { ids: ["e_amy_jan"] },
            expect.anything(),
        );
        act(() => {
            if (run !== undefined) result.current.undoRun(run);
        });
        await confirm();
        expect(post).toHaveBeenLastCalledWith(
            "/v1/earnings/unpay",
            { ids: ["e_amy_jan", "e_amy_jan2"] },
            expect.anything(),
        );
    });

    it("filters paid runs and all rows by a range of days", () => {
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_amy");
            result.current.setView("paid");
        });
        act(() => {
            result.current.setRange({ from: "2026-06-01", to: null });
        });
        expect(result.current.paidGroups.map((g) => g.key)).toEqual(["prun_b"]);
    });

    it("hides reversed rows from All until asked", () => {
        rows.earnings = [...baseline(), earning("e_amy_rev", "st_amy", 50, { status: "reversed" })];
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_amy");
            result.current.setView("all");
        });
        expect(result.current.lines.some((l) => l.id === "e_amy_rev")).toBe(false);
        act(() => {
            result.current.setShowReversed(true);
        });
        expect(result.current.lines.some((l) => l.id === "e_amy_rev")).toBe(true);
    });

    it("keeps a removed member listed while owed or paid this year", () => {
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        const ids = result.current.payees.map((p) => p.staffId);
        expect(ids).toEqual(["st_amy", "st_bo", "st_cy", "st_ed"]);
        expect(result.current.payees[2]?.title).toBe(strings.earnings.removedMember);
        expect(renderHook(() => useOwedPay("st_cy")).result.current).toContain("$2.00");
        expect(renderHook(() => useOwedPay("st_di")).result.current).toBeNull();
        expect(renderHook(() => useOwedPay("st_ed")).result.current).toBe(
            strings.earnings.owesBackOnRemove("$2.00"),
        );
    });

    it("closes the panel when the selected member drops off the list", () => {
        const { result, rerender } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_cy");
        });
        expect(result.current.selected?.staffId).toBe("st_cy");
        rows.earnings = baseline().filter((r) => r.staff_id !== "st_cy");
        rerender();
        expect(result.current.selected).toBeNull();
    });

    it("lets an admin see their own pay but not move it", () => {
        const { result } = renderHook(() =>
            useEarningApprovals(api, { staffId: "st_amy", owner: false }),
        );
        act(() => {
            result.current.select("st_amy");
        });
        expect(result.current.editable).toBe(false);
        expect(result.current.canPay).toBe(false);
        expect(result.current.canPick).toBe(false);
        expect(result.current.lines.every((l) => !l.pickable && l.undo === null)).toBe(true);
    });

    it("counts pay in the year it was made in the business time zone", () => {
        const paidYtd = (now: string): number | undefined => {
            vi.useFakeTimers({ now: new Date(now), toFake: ["Date"] });
            const { result } = renderHook(() => useEarningApprovals(api, owner));
            vi.useRealTimers();
            return result.current.payees.find((p) => p.staffId === "st_amy")?.paidYtdCents;
        };
        expect(paidYtd("2027-01-01T03:00:00Z")).toBe(0);
        expect(paidYtd("2027-01-02T12:00:00Z")).toBe(500);
    });

    it("shows the server's reason when a move is refused", async () => {
        post.mockImplementationOnce(() =>
            Promise.reject(Object.assign(new Error("refused"), { code: "pay_negative" })),
        );
        const { result } = renderHook(() => useEarningApprovals(api, owner));
        act(() => {
            result.current.select("st_amy");
        });
        act(() => {
            result.current.pay();
        });
        await confirm();
        expect(result.current.error).toBe(strings.api.payNegative);
    });
});

describe("useMyEarnings", () => {
    it("shows a member only their own pay, with nothing to pick or undo", () => {
        const { result } = renderHook(() => useMyEarnings("st_amy"));
        expect(result.current.name).toBe("Amy");
        expect(result.current.pendingCents).toBe(800);
        expect(result.current.approvedCents).toBe(1500);
        expect(result.current.lines.map((l) => l.id)).toEqual(["e_amy_1", "e_amy_2", "e_amy_new"]);
        expect(result.current.lines.every((l) => !l.pickable && l.undo === null)).toBe(true);
        expect(result.current.paidGroups.flatMap((g) => g.ids)).toEqual([
            "e_amy_jan",
            "e_amy_jan2",
            "e_amy_old",
        ]);
    });
});

describe("useStatementHeader", () => {
    it("heads a statement with the business and its address as invoices print it", () => {
        const { result } = renderHook(() => useStatementHeader());
        expect(result.current.business).toBe("Maple and Main");
        expect(result.current.address).toHaveLength(2);
        expect(result.current.address.join(" ")).toContain("King St");
    });
});

describe("statementText", () => {
    it("lists each row, the parts and the total for sharing", () => {
        const { result } = renderHook(() => useMyEarnings("st_amy"));
        const [run] = result.current.paidGroups;
        if (run === undefined) throw new Error("no run");
        const header = { business: "Maple and Main", address: ["12 King St", "Toronto, ON"] };
        const text = statementText(header, "Amy", run);
        expect(text.split("\n").slice(0, 5)).toEqual([
            "Maple and Main",
            "12 King St",
            "Toronto, ON",
            strings.earnings.statementTitle,
            strings.earnings.statementFor("Amy", run.day),
        ]);
        expect(text).toContain("$5.00");
    });
});

describe("useAdjustmentForm", () => {
    it("asks for an amount and a reason, then posts a deduction as negative", async () => {
        const done = vi.fn();
        const { result } = renderHook(() => useAdjustmentForm(api, "st_amy", done));
        act(() => {
            result.current.submit();
        });
        expect(result.current.error).toBe(strings.earnings.adjustment.amountInvalid);
        act(() => {
            result.current.setAmount("25");
        });
        act(() => {
            result.current.submit();
        });
        expect(result.current.error).toBe(strings.earnings.adjustment.reasonMissing);
        act(() => {
            result.current.setKind("deduction");
            result.current.setReason(" Chair rent ");
        });
        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });
        expect(post).toHaveBeenCalledWith(
            "/v1/earnings/adjustments",
            { staff_id: "st_amy", amount_cents: -2500, reason: "Chair rent" },
            expect.anything(),
        );
        expect(done).toHaveBeenCalled();
    });

    it("explains a refusal from the server's error code", async () => {
        post.mockImplementationOnce(() =>
            Promise.reject(Object.assign(new Error("refused"), { code: "own_pay" })),
        );
        const { result } = renderHook(() => useAdjustmentForm(api, "st_amy", vi.fn()));
        act(() => {
            result.current.setAmount("10");
            result.current.setReason("Bonus");
        });
        await act(async () => {
            result.current.submit();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(result.current.error).toBe(strings.api.ownPay);
    });
});
