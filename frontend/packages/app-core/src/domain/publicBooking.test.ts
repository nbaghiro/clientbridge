// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    dateKey,
    deviceZone,
    formatTime,
    formatWeekday,
    formatZoneName,
    setDeviceZone,
    zonedDate,
} from "../datetime";
import { strings } from "../strings";
import {
    usePublicBookingFlow,
    addsLabel,
    extraMinutes,
    useManageBooking,
    bookingFailure,
    detailErrors,
    draftDay,
    groupSlots,
    horizonDay,
    icsFor,
    mapsUrl,
    toStrip,
    visitAddress,
    visitWeekFrom,
    whenLabel,
    whenTitle,
    zoneNote,
} from "./publicBooking";

const ZONE = "America/Vancouver";

const s = strings.publicBooking;

const at = (day: number, h: number, m = 0): Date => zonedDate(2026, 10, day, h, m, ZONE);
const slot = (d: Date, staff: string | null = null, waitlist = false) => ({
    starts_at: d.toISOString(),
    ends_at: new Date(d.getTime() + 3_600_000).toISOString(),
    staff_id: staff,
    waitlist,
});

describe("open times", () => {
    it("groups times into morning, afternoon and evening, dropping empty parts", () => {
        const groups = groupSlots(
            [slot(at(7, 9)), slot(at(7, 11, 59)), slot(at(7, 17)), slot(at(7, 20, 30))],
            ZONE,
            (id) => `Staff ${id}`,
        );
        expect(groups.map((g) => [g.label, g.slots.length])).toEqual([
            [s.morning, 2],
            [s.evening, 2],
        ]);
        expect(groups[0]?.slots[0]).toEqual({
            key: at(7, 9).toISOString(),
            label: formatTime(at(7, 9), ZONE),
        });
        expect(groups.map((g) => g.label)).not.toContain(s.afternoon);
        expect(groupSlots([], ZONE, undefined)).toEqual([]);
    });

    it("hints who a time is with when the page names staff", () => {
        const [afternoon] = groupSlots(
            [slot(at(7, 12), "st_amy"), slot(at(7, 16, 59))],
            ZONE,
            (id) => (id === "st_amy" ? "Amy" : ""),
        );
        expect(afternoon?.label).toBe(s.afternoon);
        expect(afternoon?.slots.map((x) => x.hint)).toEqual(["Amy", undefined]);
    });

    it("marks a full class time as a waitlist to join, in place of who it's with", () => {
        const [morning] = groupSlots(
            [slot(at(7, 9), "st_amy"), slot(at(7, 10), "st_amy", true)],
            ZONE,
            () => "Amy",
        );
        expect(morning?.slots.map((x) => x.hint)).toEqual(["Amy", s.waitlistHint]);
    });

    it("builds a week strip with busy levels, closures and days before today disabled", () => {
        const strip = toStrip(
            [
                { date: "2026-10-05", count: 5, waitlist: 0, closed: false, reason: null },
                { date: "2026-10-06", count: 0, waitlist: 0, closed: false, reason: null },
                { date: "2026-10-07", count: 3, waitlist: 0, closed: false, reason: null },
                { date: "2026-10-08", count: 0, waitlist: 1, closed: false, reason: null },
                { date: "2026-10-09", count: 10, waitlist: 0, closed: false, reason: null },
                { date: "2026-10-10", count: 0, waitlist: 0, closed: true, reason: "Holiday" },
            ],
            "2026-10-05",
            "2026-10-06",
            ZONE,
        );
        expect(strip.map((d) => [d.key, d.busy, d.closed, d.disabled, d.isToday])).toEqual([
            ["2026-10-05", 2, false, true, false],
            ["2026-10-06", 0, false, true, true],
            ["2026-10-07", 1, false, false, false],
            ["2026-10-08", 0, false, false, false],
            ["2026-10-09", 3, false, false, false],
            ["2026-10-10", 0, true, false, false],
            ["2026-10-11", 0, false, false, false],
        ]);
        expect(strip[2]).toMatchObject({ weekday: formatWeekday(at(7, 0), ZONE), day: "7" });
        expect(toStrip(null, "2026-12-29", "2026-12-01", ZONE).map((d) => d.key)).toEqual([
            "2026-12-29",
            "2026-12-30",
            "2026-12-31",
            "2027-01-01",
            "2027-01-02",
            "2027-01-03",
            "2027-01-04",
        ]);
    });

    it("says when a visit is, naming today and tomorrow", () => {
        const today = dateKey(at(7, 0), ZONE);
        expect(whenLabel(at(7, 14).toISOString(), today, ZONE)).toBe(
            s.at(s.today, formatTime(at(7, 14), ZONE)),
        );
        expect(whenLabel(at(8, 9).toISOString(), today, ZONE)).toBe(
            s.at(s.tomorrow, formatTime(at(8, 9), ZONE)),
        );
        const later = whenLabel(at(12, 9).toISOString(), today, ZONE);
        expect(later).toContain("October 12");
        expect(later.endsWith(formatTime(at(12, 9), ZONE))).toBe(true);
    });
});

describe("icsFor", () => {
    it("writes one escaped UTC event with CRLF line endings", () => {
        const ics = icsFor({
            uid: "bk_01J.birch-studio",
            title: "Groom, wash; trim\\",
            starts_at: "2026-10-07 17:00:00+00",
            ends_at: "2026-10-07T18:30:00Z",
            location: "Birch Studio, Victoria",
        });
        const lines = ics.split("\r\n");
        expect(lines).toHaveLength(12);
        expect(lines.slice(0, 4)).toEqual([
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Clientbridge//Booking//EN",
            "BEGIN:VEVENT",
        ]);
        expect(lines[4]).toBe("UID:bk_01J.birch-studio@clientbridge.ca");
        expect(lines[5]).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
        expect(lines.slice(6)).toEqual([
            "DTSTART:20261007T170000Z",
            "DTEND:20261007T183000Z",
            "SUMMARY:Groom\\, wash\\; trim\\\\",
            "LOCATION:Birch Studio\\, Victoria",
            "END:VEVENT",
            "END:VCALENDAR",
        ]);
    });

    it("escapes line breaks so a multi-line field stays on one content line", () => {
        const ics = icsFor({
            uid: "bk_1.birch",
            title: "Groom",
            starts_at: "2026-10-07T17:00:00Z",
            ends_at: "2026-10-07T18:00:00Z",
            location: "12 Main St\r\nUnit 4\nVictoria, BC",
        });
        expect(ics.split("\r\n")).toContain("LOCATION:12 Main St\\nUnit 4\\nVictoria\\, BC");
    });

    it("gives each visit its own UID, even two of the same service at the same time", () => {
        const visit = {
            title: "Groom",
            starts_at: "2026-10-07T17:00:00Z",
            ends_at: "2026-10-07T18:00:00Z",
            location: "Birch",
        };
        const uid = (ics: string): string | undefined =>
            ics.split("\r\n").find((l) => l.startsWith("UID:"));
        const a = uid(icsFor({ ...visit, uid: "bk_1.birch" }));
        const b = uid(icsFor({ ...visit, uid: "bk_2.birch" }));
        const c = uid(icsFor({ ...visit, uid: "bk_1.fjord" }));
        expect(new Set([a, b, c]).size).toBe(3);
    });
});

describe("the business zone on public pages", () => {
    it("names the zone only for a visitor whose clock reads another one", () => {
        const machine = deviceZone();
        try {
            setDeviceZone(ZONE);
            expect(zoneNote(ZONE)).toBeNull();
            expect(zoneNote("Asia/Tokyo")).toBe(s.timesIn(formatZoneName("Asia/Tokyo")));
            setDeviceZone("Asia/Tokyo");
            expect(zoneNote(ZONE)).toBe(s.timesIn(formatZoneName(ZONE)));
        } finally {
            setDeviceZone(machine);
        }
    });

    it("starts a line with a capitalised day", () => {
        const today = dateKey(at(7, 9), ZONE);
        expect(whenTitle(at(7, 14).toISOString(), today, ZONE)).toBe(
            s.at(strings.common.today, formatTime(at(7, 14), ZONE)),
        );
        expect(whenLabel(at(8, 9).toISOString(), today, ZONE)).toBe(
            s.at(s.tomorrow, formatTime(at(8, 9), ZONE)),
        );
    });
});

describe("booking a time", () => {
    it("restores a saved time on its day in the business zone", () => {
        expect(draftDay("2026-10-08T02:30:00.000Z", ZONE)).toBe("2026-10-07");
        expect(draftDay("2026-10-08T02:30:00Z", "Asia/Tokyo")).toBe("2026-10-08");
        expect(draftDay("not a time", ZONE)).toBeNull();
    });

    it("stops the week strip at the booking horizon, and opens a move on the visit's week", () => {
        expect(horizonDay("2026-10-07", 30, ZONE)).toBe("2026-11-06");
        expect(horizonDay("2026-10-07", undefined, ZONE)).toBeNull();
        expect(visitWeekFrom(at(21, 10), "2026-10-07", ZONE)).toBe("2026-10-19");
        expect(visitWeekFrom(at(8, 10), "2026-10-07", ZONE)).toBe("2026-10-07");
    });

    it("tells a lost connection from a time someone else just took", () => {
        expect(bookingFailure(new TypeError("Failed to fetch"), s.bookError)).toBe(
            s.connectionError,
        );
        const refused = Object.assign(new Error("409"), { status: 409, code: "slot_unavailable" });
        expect(bookingFailure(refused, s.bookError)).toBe(s.slotTaken);
        const other = Object.assign(new Error("422"), { status: 422, code: "unprocessable" });
        expect(bookingFailure(other, s.bookError)).toBe(s.bookError);
        const reused = Object.assign(new Error("422"), {
            status: 422,
            code: "idempotency_key_reused",
        });
        expect(bookingFailure(reused, s.bookError)).toBe(strings.api.idempotencyKeyReused);
    });
});

afterEach(cleanup);

it("shows a failed availability load and retries without presenting it as an empty week", async () => {
    const client: Parameters<typeof usePublicBookingFlow>[0] = {
        getServices: vi.fn().mockResolvedValue({
            business_name: "Demo",
            brand: { logo_url: null, primary: null, tagline: null },
            services: [
                {
                    id: "service",
                    name: "Visit",
                    description: null,
                    duration_min: 60,
                    price_cents: 1000,
                    currency: "CAD",
                    deposit_required: false,
                    deposit_amount_cents: 0,
                    image_url: null,
                    kind: "service",
                    category: null,
                    color: null,
                    staff_ids: [],
                },
            ],
            staff: [],
            addons: [],
            stripe_account_id: null,
            slug: "demo",
            now: "2026-10-13T17:00:00Z",
            timezone: ZONE,
            policy: null,
            subject: null,
        }),
        getDays: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]),
        getSlots: vi.fn().mockResolvedValue([]),
        book: vi.fn(),
        joinWaitlist: vi.fn(),
        getPrograms: vi.fn().mockResolvedValue([]),
    };
    const { result } = renderHook(() =>
        usePublicBookingFlow(client, "demo", { itemId: "service" }),
    );
    await waitFor(() => {
        expect(result.current.slotsError).toBe(true);
    });
    act(() => {
        result.current.retrySlots();
    });
    await waitFor(() => {
        expect(client.getDays).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
        expect(result.current.slotsError).toBe(false);
    });
});

it("asks for extras before the time and looks for times long enough for them", async () => {
    const mount = {
        id: "mount",
        name: "Second mount",
        price_cents: 5000,
        currency: "CAD",
        image_url: null,
        description: null,
        in_stock: true,
        addon_for: [],
        duration_min: 30,
    };
    const client: Parameters<typeof usePublicBookingFlow>[0] = {
        getServices: vi.fn().mockResolvedValue({
            business_name: "Demo",
            brand: { logo_url: null, primary: null, tagline: null },
            services: [
                {
                    id: "service",
                    name: "Install",
                    description: null,
                    duration_min: 120,
                    price_cents: 10000,
                    currency: "CAD",
                    deposit_required: false,
                    deposit_amount_cents: 0,
                    image_url: null,
                    kind: "service",
                    category: null,
                    color: null,
                    staff_ids: [],
                },
            ],
            staff: [],
            addons: [mount],
            stripe_account_id: null,
            slug: "demo",
            now: "2026-10-13T17:00:00Z",
            timezone: ZONE,
            policy: null,
            subject: null,
        }),
        getDays: vi.fn().mockResolvedValue([]),
        getSlots: vi.fn().mockResolvedValue([]),
        book: vi.fn(),
        joinWaitlist: vi.fn(),
        getPrograms: vi.fn().mockResolvedValue([]),
    };
    const { result } = renderHook(() => usePublicBookingFlow(client, "demo"));
    await waitFor(() => {
        expect(result.current.page).not.toBeNull();
    });
    act(() => {
        result.current.setService("service");
    });
    expect(result.current.step).toBe("extras");
    expect(result.current.steps.map((x) => x.key)).toEqual([
        "service",
        "extras",
        "time",
        "details",
    ]);
    act(() => {
        result.current.toggleAddon("mount");
    });
    await waitFor(() => {
        expect(client.getDays).toHaveBeenLastCalledWith(
            "demo",
            expect.objectContaining({ extraMin: 30 }),
        );
    });
    expect(addsLabel(mount)).toBe(s.addsTime(s.minutes(30)));
    expect(extraMinutes([mount], { mount: 2 }, "service")).toBe(60);
    expect(extraMinutes([mount], { mount: 2 }, "class")).toBe(0);
});

const managed = (extra: Record<string, unknown> = {}) => ({
    booking_id: "booking",
    business_name: "Demo",
    brand: { logo_url: null, primary: null, tagline: null },
    slug: "demo",
    client_name: "Pat",
    subject: null,
    subject_name: null,
    service: {
        id: "service",
        name: "Visit",
        description: null,
        duration_min: 60,
        price_cents: 1000,
        currency: "CAD",
        deposit_required: false,
        deposit_amount_cents: 0,
        image_url: null,
        kind: "service",
        category: null,
        color: null,
        staff_ids: [],
    },
    staff: { id: "staff", name: "Pat", title: null, color: null },
    starts_at: "2026-10-15T17:00:00Z",
    ends_at: "2026-10-15T18:00:00Z",
    status: "confirmed",
    deposit_cents: 0,
    deposit_status: "none",
    addons: [],
    reschedules_used: 0,
    policy: {
        self_service: true,
        cancel_cutoff_hours: 24,
        reschedule_cutoff_hours: 24,
        max_reschedules: 3,
    },
    now: "2026-10-13T17:00:00Z",
    timezone: ZONE,
    can_move: true,
    can_cancel: true,
    blocked: null,
    blocked_hours: null,
    waitlist_position: null,
    deposit_due: false,
    accepts_card: true,
    ...extra,
});

function manageClient(extra: Record<string, unknown> = {}): Parameters<typeof useManageBooking>[0] {
    return {
        getBooking: vi.fn().mockResolvedValue(managed(extra)),
        getDays: vi.fn().mockResolvedValue([]),
        getSlots: vi.fn().mockResolvedValue([]),
        message: vi.fn(),
        reschedule: vi.fn(),
        cancel: vi.fn(),
        payDeposit: vi.fn(),
    };
}

it.each(["days", "slots"])("shows and retries a failed manage %s request", async (failed) => {
    const client = manageClient();
    const request = failed === "days" ? client.getDays : client.getSlots;
    vi.mocked(request).mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useManageBooking(client, "token"));
    await waitFor(() => {
        expect(result.current.booking).not.toBeNull();
    });
    act(() => {
        result.current.setMode("move");
    });
    await waitFor(() => {
        expect(result.current.slotsError).toBe(true);
    });
    act(() => {
        result.current.retrySlots();
    });
    await waitFor(() => {
        expect(request).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
        expect(result.current.slotsError).toBe(false);
    });
});

describe("a deposit due on the manage link", () => {
    const m = strings.publicManage;
    const due = { deposit_cents: 2000, deposit_status: "pending", deposit_due: true };

    it("opens the card payment and shows the deposit paid once it goes through", async () => {
        const client = manageClient(due);
        const intent = { client_secret: "pi_1_secret", stripe_account_id: "acct_1" };
        vi.mocked(client.payDeposit).mockResolvedValue(intent);
        const { result } = renderHook(() => useManageBooking(client, "token"));
        await waitFor(() => {
            expect(result.current.booking).not.toBeNull();
        });
        expect(result.current.canPayDeposit).toBe(true);
        expect(result.current.depositLine).toBe(m.depositDueBody(result.current.deposit));
        act(() => {
            result.current.payDeposit(true);
        });
        await waitFor(() => {
            expect(result.current.depositCard).toEqual(intent);
        });
        act(() => {
            result.current.depositPaid();
        });
        expect(result.current.depositCard).toBeNull();
        expect(result.current.hasDeposit).toBe(true);
        expect(result.current.canPayDeposit).toBe(false);
        expect(result.current.depositThanks).toBe(m.depositThanks(result.current.deposit));
    });

    it("offers nothing to pay when the business takes no cards online", async () => {
        const client = manageClient({ ...due, accepts_card: false });
        const { result } = renderHook(() => useManageBooking(client, "token"));
        await waitFor(() => {
            expect(result.current.booking).not.toBeNull();
        });
        expect(result.current.depositDue).toBe(true);
        expect(result.current.canPayDeposit).toBe(false);
        expect(result.current.depositLine).toBe(m.depositOffline(result.current.deposit, "Demo"));
    });

    it("offers nothing to pay on a cancelled visit", async () => {
        const client = manageClient({ ...due, status: "canceled" });
        const { result } = renderHook(() => useManageBooking(client, "token"));
        await waitFor(() => {
            expect(result.current.booking).not.toBeNull();
        });
        expect(result.current.depositDue).toBe(false);
        expect(result.current.canPayDeposit).toBe(false);
    });

    it("words a refusal from its code and reloads the visit", async () => {
        const client = manageClient(due);
        vi.mocked(client.payDeposit).mockRejectedValue(
            Object.assign(new Error("refused"), { status: 409, code: "deposit_not_due" }),
        );
        const { result } = renderHook(() => useManageBooking(client, "token"));
        await waitFor(() => {
            expect(result.current.booking).not.toBeNull();
        });
        vi.mocked(client.getBooking).mockResolvedValue(
            managed({ deposit_cents: 2000, deposit_status: "collected" }),
        );
        act(() => {
            result.current.payDeposit(true);
        });
        await waitFor(() => {
            expect(result.current.depositError).toBe(strings.api.depositNotDue);
        });
        await waitFor(() => {
            expect(result.current.hasDeposit).toBe(true);
        });
        expect(result.current.depositCard).toBeNull();
    });

    it("explains a page without a card key instead of opening a payment", async () => {
        const client = manageClient(due);
        const { result } = renderHook(() => useManageBooking(client, "token"));
        await waitFor(() => {
            expect(result.current.booking).not.toBeNull();
        });
        act(() => {
            result.current.payDeposit(false);
        });
        expect(result.current.depositError).toBe(strings.publicPay.cardNotConfigured);
        expect(client.payDeposit).not.toHaveBeenCalled();
    });
});

describe("detailErrors", () => {
    const filled = {
        name: "Robin",
        phone: "",
        email: "robin@example.com",
        subjectName: "",
        subjectAddress: "",
    };

    it("asks for the subject only when the business books one", () => {
        expect(detailErrors(filled, null, false).subject).toBeNull();
        expect(detailErrors(filled, "pet", false).subject).toBe(s.subjectRequired("pet"));
        expect(detailErrors({ ...filled, subjectName: "Pepper" }, "pet", false).subject).toBeNull();
    });

    it("asks a property business for a new property's address", () => {
        const named = { ...filled, subjectName: "Cottage" };
        expect(detailErrors(named, "property", false).address).toBe(s.addressRequired("property"));
        expect(detailErrors(named, "site", false).address).toBe(s.addressRequired("site"));
        expect(detailErrors(named, "vehicle", false).address).toBe(s.addressRequired("vehicle"));
        expect(detailErrors(named, "property", true).address).toBeNull();
        expect(detailErrors(named, "student", false).address).toBeNull();
        expect(
            detailErrors({ ...named, subjectAddress: "4 Elm Rd" }, "property", false).address,
        ).toBeNull();
    });
});

describe("visitAddress", () => {
    it("goes to a property's or site's own address, else the business's", () => {
        expect(visitAddress("site", { address: " 880 Douglas St " }, "1 Main St")).toBe(
            "880 Douglas St",
        );
        expect(visitAddress("property", { address: "" }, "1 Main St")).toBe("1 Main St");
        expect(visitAddress("pet", { address: "880 Douglas St" }, "1 Main St")).toBe("1 Main St");
        expect(visitAddress("site", null, null)).toBeNull();
        expect(visitAddress("vehicle", { address: "1200 Fort St" }, "1 Main St")).toBe(
            "1200 Fort St",
        );
        expect(mapsUrl("880 Douglas St, Victoria")).toBe(
            "https://www.google.com/maps/search/?api=1&query=880%20Douglas%20St%2C%20Victoria",
        );
    });
});
