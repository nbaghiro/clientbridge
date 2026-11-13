// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { strings } from "../strings";
import type { OccurrenceRow } from "../ui";
import { BRAND_COLOURS } from "./staff";
import { formatShortDay } from "../datetime";
import {
    removalFailure,
    removalOutcome,
    useAcceptInvite,
    useInviteTeammatesForm,
    useStaffPayForm,
    useStaffProfileForm,
} from "./staff";
import { holdJoinedBusiness, useJoinedBusiness } from "./sync";

const t = strings.staff.team;

const SERIES = [
    { id: "rec_a", item_name: "Full Groom", client_name: "Amelie Roy" },
    { id: "rec_b", item_name: "Nail Trim", client_name: null },
];
const MEMBERS = [
    { id: "st_tam", name: "Taking Tam" },
    { id: "st_lee", name: "Leaving Lee" },
];
const LEFT: OccurrenceRow = {
    key: "bk_1",
    index: 1,
    date: "Tue, Mar 2",
    time: "11:00 a.m.",
    intent: "warning",
    state: t.removeLeftState,
    note: null,
};

describe("removalFailure", () => {
    const ZONE = "America/Vancouver";
    const camp = [{ id: "sch_camp", item_name: "Spring Camp" }];
    const refused = (detail: Record<string, unknown>): Error =>
        Object.assign(new Error("POST → 409"), { status: 409, code: "schedule_clash", detail });

    it("names the class and the first day its taker isn't free", () => {
        const day = "2027-03-03T18:00:00Z";
        expect(
            removalFailure(refused({ recurrence_id: "sch_camp", starts_at: day }), camp, ZONE),
        ).toBe(t.removeScheduleClash("Spring Camp", formatShortDay(new Date(day), ZONE)));
    });

    it("says when the taker doesn't teach the class, or no day is named", () => {
        const notTaught = refused({ recurrence_id: "sch_camp", problem: "not_offered" });
        expect(removalFailure(notTaught, camp, ZONE)).toBe(
            t.removeScheduleNotTaught("Spring Camp"),
        );
        expect(removalFailure(refused({ recurrence_id: "sch_other" }), camp, ZONE)).toBe(
            t.removeScheduleBusy(t.removeSchedules),
        );
    });

    it("reads any other refusal the usual way", () => {
        const other = Object.assign(new Error("x"), { status: 409, code: "conflict" });
        expect(removalFailure(other, camp, ZONE)).toBe(t.actionError);
    });
});

describe("removalOutcome", () => {
    it("is null when nothing was left, moved or ended", () => {
        expect(removalOutcome({ series_moved: [], series_ended: [] }, SERIES, MEMBERS, [])).toBe(
            null,
        );
    });

    it("names each moved series with its new member and each ended one", () => {
        const outcome = removalOutcome(
            {
                series_moved: [{ recurrence_id: "rec_a", staff_id: "st_tam" }],
                series_ended: ["rec_b"],
            },
            SERIES,
            MEMBERS,
            [],
        );
        expect(outcome?.body).toBe(
            strings.common.twoSentences(t.removedSeriesMoved(1), t.removedSeriesEnded(1)),
        );
        expect(outcome?.series).toEqual([
            {
                key: "rec_a",
                icon: "repeat",
                title: `Full Groom${strings.common.separator}Amelie Roy`,
                detail: t.removedSeriesNowWith("Taking Tam"),
            },
            { key: "rec_b", icon: "repeat", title: "Nail Trim", detail: t.removedSeriesEndedState },
        ]);
        expect(outcome?.left).toEqual([]);
    });

    it("counts several series in one plural line per outcome", () => {
        const outcome = removalOutcome(
            { series_moved: [], series_ended: ["rec_a", "rec_b"] },
            SERIES,
            MEMBERS,
            [],
        );
        expect(outcome?.body).toBe(t.removedSeriesEnded(2));
        expect(outcome?.series.map((f) => f.detail)).toEqual([
            t.removedSeriesEndedState,
            t.removedSeriesEndedState,
        ]);
    });

    it("keeps visits left in place alongside the series", () => {
        const outcome = removalOutcome(
            { series_moved: [], series_ended: ["rec_a"] },
            SERIES,
            MEMBERS,
            [LEFT],
        );
        expect(outcome?.body).toBe(
            strings.common.twoSentences(t.removeLeftBody(1), t.removedSeriesEnded(1)),
        );
        expect(outcome?.left).toEqual([LEFT]);
    });

    it("falls back to generic labels for a series or member it cannot name", () => {
        const outcome = removalOutcome(
            { series_moved: [{ recurrence_id: "rec_x", staff_id: "st_gone" }], series_ended: [] },
            SERIES,
            MEMBERS,
            [],
        );
        expect(outcome?.series).toEqual([
            {
                key: "rec_x",
                icon: "repeat",
                title: t.removedSeries,
                detail: t.removedSeriesMovedState,
            },
        ]);
    });
});

function recordingApi(fail = false): ApiLike & { patched: [string, unknown][] } {
    const patched: [string, unknown][] = [];
    return {
        patched,
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>() => Promise.resolve({} as T),
        patch: <T>(path: string, body: unknown) => {
            patched.push([path, body]);
            return fail ? Promise.reject(new Error("boom")) : Promise.resolve({} as T);
        },
        delete: <T>() => Promise.resolve({} as T),
    };
}

const diego = { id: "st_diego", title: "Senior Groomer", color: "#2E7A5A" };

describe("useStaffProfileForm", () => {
    it("starts from the member and offers the brand palette", () => {
        const { result } = renderHook(() => useStaffProfileForm(recordingApi(), diego, vi.fn()));
        expect(result.current.title).toBe("Senior Groomer");
        expect(result.current.colour).toBe("#2E7A5A");
        expect(result.current.colours).toBe(BRAND_COLOURS);
        expect(result.current.dirty).toBe(false);
    });

    it("sends the trimmed title and the picked colour, then reports done", async () => {
        const api = recordingApi();
        const done = vi.fn();
        const { result } = renderHook(() => useStaffProfileForm(api, diego, done));
        act(() => {
            result.current.setTitle("  Lead Groomer ");
            result.current.setColour("#7D5A82");
        });
        expect(result.current.dirty).toBe(true);
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(done).toHaveBeenCalledOnce();
        });
        expect(api.patched).toEqual([
            ["/v1/staff/st_diego", { title: "Lead Groomer", color: "#7D5A82" }],
        ]);
    });

    it("clears a title and keeps an unset colour unset", async () => {
        const api = recordingApi();
        const member = { id: "st_new", title: "Bather", color: null };
        const { result } = renderHook(() => useStaffProfileForm(api, member, vi.fn()));
        act(() => {
            result.current.setTitle("   ");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(api.patched).toEqual([["/v1/staff/st_new", { title: "", color: "" }]]);
        });
    });

    it("shows the catalog error when the save fails", async () => {
        const done = vi.fn();
        const { result } = renderHook(() => useStaffProfileForm(recordingApi(true), diego, done));
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.staff.team.profileError);
        });
        expect(done).not.toHaveBeenCalled();
    });
});

describe("useStaffPayForm", () => {
    it("explains what a fixed rate pays for only while fixed is chosen", () => {
        const row = {
            id: "st_1",
            title: null,
            role: "staff",
            invite_email: null,
            payee: 1,
            rate_type: "percent",
            rate_bps: 4000,
            rate_cents: null,
            retail_rate_bps: null,
        };
        const { result } = renderHook(() => useStaffPayForm(recordingApi(), row, vi.fn()));
        expect(result.current.rateHint).toBeUndefined();
        act(() => {
            result.current.setRateType("fixed");
        });
        expect(result.current.rateHint).toBe(strings.staff.rateFixedHint);
    });
});

function refused(code: string): Error {
    return Object.assign(new Error("POST → 409"), { status: 409, code });
}

function invitingApi(refuse: Record<string, string> = {}): ApiLike & { invited: unknown[] } {
    const invited: unknown[] = [];
    return {
        invited,
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>(_path: string, body: unknown) => {
            const email = (body as { email: string }).email;
            const code = refuse[email];
            if (code !== undefined) return Promise.reject(refused(code));
            invited.push(body);
            return Promise.resolve({ id: `st_${email}`, email, invite_token: "tok" } as T);
        },
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
}

const TEAM = {
    members: [{ email: "diego@birchbark.example" }, { email: null }],
    invites: [{ email: "Sam@Example.com" }],
} as unknown as Parameters<typeof useInviteTeammatesForm>[1];

describe("useInviteTeammatesForm", () => {
    async function submit(api: ApiLike, emails: string) {
        const hook = renderHook(() => useInviteTeammatesForm(api, TEAM));
        act(() => {
            hook.result.current.setEmails(emails);
        });
        act(() => {
            hook.result.current.submit();
        });
        await waitFor(() => {
            expect(hook.result.current.busy).toBe(false);
        });
        return hook.result;
    }

    it("skips a member or an address with an open invite, sends the rest and names it", async () => {
        const api = invitingApi();
        const member = await submit(api, "DIEGO@birchbark.example");
        expect(member.current.error).toBe(t.alreadyMember("diego@birchbark.example"));
        expect(member.current.done).toBe(false);
        expect(api.invited).toEqual([]);
        const mixed = await submit(api, "new@test.ca, sam@example.com");
        expect(mixed.current.done).toBe(true);
        expect(mixed.current.error).toBe(t.alreadyInvited("sam@example.com"));
        expect(api.invited).toEqual([{ email: "new@test.ca", role: "staff" }]);
    });

    it("names a refusal from an attempt that then failed once the retry goes through", async () => {
        const refuse: Record<string, string> = {
            "b@test.ca": "already_member",
            "c@test.ca": "boom",
        };
        const hook = renderHook(() => useInviteTeammatesForm(invitingApi(refuse), TEAM));
        act(() => {
            hook.result.current.setEmails("a@test.ca b@test.ca c@test.ca");
        });
        act(() => {
            hook.result.current.submit();
        });
        await waitFor(() => {
            expect(hook.result.current.error).toBe(t.inviteError);
        });
        expect(hook.result.current.emails).toBe("c@test.ca");
        delete refuse["c@test.ca"];
        act(() => {
            hook.result.current.submit();
        });
        await waitFor(() => {
            expect(hook.result.current.done).toBe(true);
        });
        expect(hook.result.current.error).toBe(t.alreadyMember("b@test.ca"));
        expect(hook.result.current.sent.map((i) => i.email)).toEqual(["a@test.ca", "c@test.ca"]);
    });

    it("skips an address whose lost response left an invite, and still sends the rest", async () => {
        const refuse: Record<string, string> = { "b@test.ca": "boom" };
        const api = invitingApi(refuse);
        const { result, rerender } = renderHook(
            ({ team }: { team: Parameters<typeof useInviteTeammatesForm>[1] }) =>
                useInviteTeammatesForm(api, team),
            { initialProps: { team: TEAM } },
        );
        act(() => {
            result.current.setEmails("a@test.ca b@test.ca c@test.ca");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(t.inviteError);
        });
        rerender({
            team: { ...TEAM, invites: [...TEAM.invites, { email: "b@test.ca" }] } as typeof TEAM,
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.done).toBe(true);
        });
        expect(result.current.error).toBe(t.alreadyInvited("b@test.ca"));
        expect(result.current.sent.map((i) => i.email)).toEqual(["a@test.ca", "c@test.ca"]);
    });

    it("sends the rest past an address the server refused, and names it with what went out", async () => {
        const api = invitingApi({ "b@test.ca": "already_invited" });
        const result = await submit(api, "a@test.ca, b@test.ca, c@test.ca");
        expect(result.current.done).toBe(true);
        expect(result.current.error).toBe(t.alreadyInvited("b@test.ca"));
        expect(result.current.sent.map((i) => i.email)).toEqual(["a@test.ca", "c@test.ca"]);
        expect(result.current.emails).toBe("");
        expect(result.current.sentSoFar).toBeNull();
        expect(api.invited).toEqual([
            { email: "a@test.ca", role: "staff" },
            { email: "c@test.ca", role: "staff" },
        ]);
    });

    it("keeps the failed address and the rest to retry, and says which went out", async () => {
        const refuse: Record<string, string> = { "b@test.ca": "boom" };
        const api = invitingApi(refuse);
        const hook = renderHook(() => useInviteTeammatesForm(api, TEAM));
        act(() => {
            hook.result.current.setEmails("a@test.ca, b@test.ca, c@test.ca");
        });
        act(() => {
            hook.result.current.submit();
        });
        await waitFor(() => {
            expect(hook.result.current.error).toBe(t.inviteError);
        });
        expect(hook.result.current.done).toBe(false);
        expect(hook.result.current.emails).toBe("b@test.ca c@test.ca");
        expect(hook.result.current.sentSoFar).toBe(t.sentSoFar(1, "a@test.ca"));

        delete refuse["b@test.ca"];
        act(() => {
            hook.result.current.submit();
        });
        await waitFor(() => {
            expect(hook.result.current.done).toBe(true);
        });
        expect(hook.result.current.error).toBeNull();
        expect(hook.result.current.sent.map((i) => i.email)).toEqual([
            "a@test.ca",
            "b@test.ca",
            "c@test.ca",
        ]);
        expect(hook.result.current.sentSoFar).toBeNull();
    });

    it("reads a member refusal and any other failure", async () => {
        const member = await submit(invitingApi({ "x@test.ca": "already_member" }), "x@test.ca");
        expect(member.current.error).toBe(t.alreadyMember("x@test.ca"));
        expect(member.current.sent).toEqual([]);
        const other = await submit(invitingApi({ "x@test.ca": "boom" }), "x@test.ca");
        expect(other.current.error).toBe(t.inviteError);
        expect(other.current.emails).toBe("x@test.ca");
    });

    it("starts each opening empty and as staff, after an admin invite or a cancel", async () => {
        const { result } = renderHook(() => useInviteTeammatesForm(invitingApi(), TEAM));
        act(() => {
            result.current.setRole("admin");
            result.current.setEmails("boss@test.ca");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.sent).toHaveLength(1);
        });
        act(() => {
            result.current.reset();
        });
        expect([result.current.role, result.current.done, result.current.sent]).toEqual([
            "staff",
            false,
            [],
        ]);
        act(() => {
            result.current.setEmails("half-typed@test.ca");
            result.current.setRole("contractor");
        });
        act(() => {
            result.current.reset();
        });
        expect([result.current.emails, result.current.role]).toEqual(["", "staff"]);
    });
});

describe("useAcceptInvite", () => {
    const api: ApiLike = {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>(path: string) =>
            Promise.resolve(
                (path.endsWith("/accept")
                    ? { business_id: "bz_joined", staff_id: "st_new" }
                    : { business_name: "Joined", email: "a@test.ca", role: "staff" }) as T,
            ),
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };

    it("leaves the invite at once and holds the joined team for the business picker", async () => {
        const joined = vi.fn();
        const { result } = renderHook(() => ({
            invite: useAcceptInvite(api, "tok", joined),
            held: useJoinedBusiness(),
        }));
        await waitFor(() => {
            expect(result.current.invite.preview).not.toBeNull();
        });
        expect(result.current.held).toBeNull();
        act(() => {
            result.current.invite.accept();
        });
        await waitFor(() => {
            expect(joined).toHaveBeenCalledOnce();
        });
        expect(result.current.held).toBe("bz_joined");
        act(() => {
            holdJoinedBusiness(null);
        });
        expect(result.current.held).toBeNull();
    });
});
