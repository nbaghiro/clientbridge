import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { addDays, combineDayAndTime, formatMoney, strings } from "@clientbridge/app-core/public";
import {
    type APIRequestContext,
    type Browser,
    expect,
    type Locator,
    test,
    type Page,
} from "@playwright/test";
import { freshPhone, newAccount, textsSince } from "../support/auth";
import { bookingApi, cancelOwnedBooking } from "../support/bookings";
import { createClient } from "../support/clients";
import { makePayee } from "../support/earnings";
import { acceptInvite, joinHoursStaff } from "../support/hours";
import { navigate, signIn } from "../support/session";
import { lapsedNotice, ownBusiness, planView, standInPlan } from "../support/plans";
import { apiCall, visitEvidence } from "../support/visit";

const t = strings.staff.team;
const p = strings.plans;

async function teamMembers(page: Page) {
    const response = await page.request.get(`${bookingApi()}/v1/staff/team`);
    expect(response.status(), await response.text()).toBe(200);
    return (
        (await response.json()) as {
            members: { id: string; email: string; role: string; status: string }[];
        }
    ).members;
}

async function openMember(page: Page, staffId: string) {
    await navigate(page, "/setup/team");
    await page.locator(`[data-row-key="${staffId}"]`).click({ timeout: 60_000 });
}

test("FLOW-08-A an invited teammate holds a seat, joins, gains admin, and on removal hands their visit back and frees the seat", async ({
    page,
    browser,
    request,
    baseURL,
}, testInfo) => {
    test.setTimeout(300_000);
    const business = await ownBusiness(page, request, `${demoPerson(randomUUID())} Studio`);
    const owner = (await teamMembers(page)).find((m) => m.role === "owner");
    if (owner === undefined) throw new Error("The new business has no owner");
    expect(await planView(page)).toMatchObject({ access: "trial", seats: 0, seat_cap: 50 });

    const account = { ...newAccount("team-member"), name: demoPerson(randomUUID()) };
    await navigate(page, "/setup/team");
    // a team of one shows the invite button in the page header and in its empty state
    const offers = page.getByRole("button", { name: t.inviteMember, exact: true });
    await expect(offers).toHaveCount(2);
    await offers.first().click();
    const invite = page.getByRole("dialog");
    await invite.getByRole("textbox", { name: t.emails, exact: true }).fill(account.email);
    const inviting = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/staff/invites" &&
            response.request().method() === "POST",
    );
    await invite.getByRole("button", { name: t.send, exact: true }).click();
    const invited = await inviting;
    expect(invited.status(), await invited.text()).toBe(201);
    const sent = (await invited.json()) as { id: string; invite_token: string; role: string };
    expect(sent.role).toBe("staff");
    await expect(invite.getByText(t.sentTitle(1), { exact: true })).toBeVisible();
    await invite.getByRole("button", { name: strings.common.done, exact: true }).click();
    // the invite holds its seat before it is accepted
    expect(await planView(page)).toMatchObject({ seats: 1 });
    await navigate(page, "/setup/security");
    await expect(page.getByText(p.seats(1), { exact: true })).toBeVisible({ timeout: 60_000 });

    const memberContext = await browser.newContext({ baseURL: baseURL ?? "" });
    try {
        const member = await memberContext.newPage();
        const staffId = await acceptInvite(member, request, sent.invite_token, account);
        expect(staffId).toBe(sent.id);
        expect(await planView(page)).toMatchObject({ seats: 1 });
        await expect(member.getByText(strings.staff.roleStaff, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        const forbidden = await member.request.get(`${bookingApi()}/v1/plan`);
        expect(forbidden.status()).toBe(403);

        const service = await apiCall<{ id: string }>(
            page,
            "POST",
            "/v1/items",
            {
                kind: "service",
                name: "Colour consultation",
                duration_min: 30,
                price_cents: 4000,
                deposit_type: "none",
                online_bookable: false,
            },
            201,
        );
        const client = await createClient(page);
        const starts = combineDayAndTime(
            addDays(new Date(), 3, business.timezone),
            "10:00",
            business.timezone,
        );
        const visit = await apiCall<{ id: string; staff_id: string }>(
            page,
            "POST",
            "/v1/bookings",
            {
                client_id: client.id,
                item_id: service.id,
                staff_id: staffId,
                starts_at: starts.toISOString(),
                notify: false,
            },
            201,
        );

        await openMember(page, staffId);
        const role = page.getByRole("group", { name: t.changeRole, exact: true });
        await role.locator('button[data-value="admin"]').click();
        const changing = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/staff/${staffId}` &&
                response.request().method() === "PATCH",
        );
        await page.getByRole("button", { name: t.saveRole, exact: true }).click();
        expect((await changing).status()).toBe(204);
        await member.reload();
        await expect(member.getByText(strings.staff.roleAdmin, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        expect((await teamMembers(member)).map((m) => m.id).sort()).toEqual(
            [owner.id, staffId].sort(),
        );
        // plan management stays with the owner whatever the member's role
        expect((await member.request.get(`${bookingApi()}/v1/plan`)).status()).toBe(403);

        await page.getByRole("button", { name: t.remove, exact: true }).click();
        const removal = page.getByRole("dialog", {
            name: t.removeTitle(account.name),
            exact: true,
        });
        // the dialog lists the visit from this device's replica, which the API booking reaches by sync
        await expect(
            removal.getByRole("list", { name: t.removeFuture }).getByRole("listitem"),
        ).toHaveCount(1, { timeout: 60_000 });
        await removal.locator('button[data-value="reassign"]').click();
        const removing = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/staff/${staffId}/remove` &&
                response.request().method() === "POST",
        );
        await removal.getByRole("button", { name: t.removeConfirm, exact: true }).click();
        const removed = await removing;
        expect(removed.status(), await removed.text()).toBe(200);
        const outcome = (await removed.json()) as { moved: string[]; canceled: string[] };
        expect(outcome).toMatchObject({ moved: [visit.id], canceled: [] });
        const summary = page.getByRole("dialog", {
            name: t.removedTitle(account.name),
            exact: true,
        });
        await expect(summary.getByText(t.removedMoved(1))).toBeVisible();
        await summary.getByRole("button", { name: strings.common.done, exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.getByRole("main").getByText(account.name, { exact: true })).toHaveCount(
            0,
            { timeout: 60_000 },
        );
        const moved = await visitEvidence([client.id]);
        expect(moved.bookings).toEqual([
            expect.objectContaining({ id: visit.id, staff_id: owner.id, status: "confirmed" }),
        ]);

        expect(await planView(page)).toMatchObject({ seats: 0 });
        await navigate(page, "/setup/security");
        await page.reload();
        await expect(page.getByText(p.seats(0), { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await expect(
            member.getByRole("heading", { name: strings.business.onboarding.title, exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        const refused = await member.request.post(`${bookingApi()}/v1/clients`, {
            headers: {
                Origin: new URL(member.url()).origin,
                "Idempotency-Key": randomUUID(),
                "X-Business-Id": business.id,
            },
            data: { name: demoPerson(randomUUID()) },
        });
        expect(refused.status(), await refused.text()).toBe(403);
        expect((await teamMembers(page)).map((m) => m.id)).toEqual([owner.id]);
        await testInfo.attach("team-lifecycle", {
            body: JSON.stringify({ business: business.id, staffId, outcome }),
            contentType: "application/json",
        });
    } finally {
        await memberContext.close();
    }
});

test("FLOW-08-B a lapsed plan keeps records readable, refuses new work on the server and the public page, still lets the owner stop activity, and recovers", async ({
    page,
    browser,
    request,
}, testInfo) => {
    test.setTimeout(300_000);
    const business = await ownBusiness(page, request, `${demoPerson(randomUUID())} Salon`);
    const origin = new URL(page.url()).origin;
    const owner = (await teamMembers(page)).find((m) => m.role === "owner");
    if (owner === undefined) throw new Error("The new business has no owner");
    const address = await page.request.patch(`${bookingApi()}/v1/business`, {
        headers: { Origin: origin },
        data: {
            street_number: "1208",
            street_name: "Government Street",
            city: "Victoria",
            province: "BC",
            postal_code: "V8W 1Y8",
            billing_email: business.account.email,
        },
    });
    expect(address.status(), await address.text()).toBe(200);
    const service = await apiCall<{ id: string }>(
        page,
        "POST",
        "/v1/items",
        {
            kind: "service",
            name: "Wash and blow-dry",
            duration_min: 45,
            price_cents: 5500,
            deposit_type: "none",
            online_bookable: true,
        },
        201,
    );
    // a new owner has no working hours, and online booking only offers times inside them
    await apiCall(
        page,
        "POST",
        `/v1/hours/${owner.id}/week`,
        {
            request: {
                version: 2,
                business_id: business.id,
                device_id: randomUUID(),
                operation_id: randomUUID(),
                created_at: new Date().toISOString(),
            },
            expected_revision: 0,
            days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
                weekday,
                available: true,
                start_time: "09:00",
                end_time: "17:00",
            })),
        },
        200,
    );
    const client = await createClient(page);
    const later = combineDayAndTime(
        addDays(new Date(), 5, business.timezone),
        "12:00",
        business.timezone,
    );
    const broadcast = await apiCall<{ id: string; status: string }>(
        page,
        "POST",
        "/v1/broadcasts",
        {
            name: "Winter hours",
            body: "We open at ten on weekdays through the winter.",
            audience: { all: true },
            scheduled_at: later.toISOString(),
        },
        200,
    );
    expect(broadcast.status).toBe("scheduled");
    const pending = await apiCall<{ id: string }>(
        page,
        "POST",
        "/v1/staff/invites",
        { email: newAccount("team-pending").email, role: "staff" },
        201,
    );

    const anonymous = await browser.newContext({
        extraHTTPHeaders: {
            "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":")}::1`,
        },
    });
    const book = async (day: number) => {
        const booker = {
            name: demoPerson(randomUUID()),
            phone: freshPhone(),
        };
        const response = await anonymous.request.post(`${bookingApi()}/book/${business.slug}`, {
            headers: { "Idempotency-Key": randomUUID() },
            data: {
                item_id: service.id,
                staff_id: owner.id,
                // a 45-minute service is offered every 45 minutes from 09:00
                starts_at: combineDayAndTime(
                    addDays(new Date(), day, business.timezone),
                    "10:30",
                    business.timezone,
                ).toISOString(),
                client: booker,
            },
        });
        return { booker, response };
    };
    const write = (path: string, data: Record<string, unknown>, method = "POST") =>
        page.request.fetch(`${bookingApi()}${path}`, {
            method,
            data,
            headers: { Origin: origin, "Idempotency-Key": randomUUID() },
        });

    try {
        expect(await standInPlan(business.id, "canceled")).toEqual({
            plan_status: "lapsed",
            plan: null,
            changed: true,
        });
        expect(await planView(page)).toMatchObject({ access: "lapsed", plan_status: "lapsed" });
        await page.reload();
        await expect(lapsedNotice(page)).toBeVisible({ timeout: 60_000 });
        await expect(
            lapsedNotice(page).getByRole("button", { name: p.noticeChoose, exact: true }),
        ).toBeVisible();
        await navigate(page, `/clients?open=${client.id}`);
        await expect(
            page.getByRole("complementary", { name: client.name, exact: true }),
        ).toBeVisible({ timeout: 60_000 });

        for (const [path, data] of [
            ["/v1/clients", { name: demoPerson(randomUUID()) }],
            ["/v1/staff/invites", { email: newAccount("team-lapsed").email, role: "staff" }],
            ["/v1/items", { kind: "service", name: "Trim", duration_min: 15, price_cents: 2000 }],
        ] as const) {
            const refused = await write(path, data);
            expect(refused.status(), `${path}: ${await refused.text()}`).toBe(402);
            expect(((await refused.json()) as { error: string }).error).toBe("plan_required");
        }
        const closed = await book(6);
        expect(closed.response.status(), await closed.response.text()).toBe(409);
        expect(((await closed.response.json()) as { error: string }).error).toBe(
            "business_unavailable",
        );
        expect((await visitEvidence([closed.booker.phone])).bookings).toEqual([]);

        const canceled = await write(`/v1/broadcasts/${broadcast.id}/cancel`, {});
        expect(canceled.status(), await canceled.text()).toBe(200);
        expect(((await canceled.json()) as { status: string }).status).toBe("canceled");
        const revoked = await write(`/v1/staff/invites/${pending.id}/revoke`, {});
        expect(revoked.status(), await revoked.text()).toBe(204);
        // the stack runs without Google, so its configuration check answers rather than the plan gate
        const google = await write("/v1/reviews/google/disconnect", { generation: 1 });
        expect(google.status(), await google.text()).toBe(503);
        expect(await google.json()).toMatchObject({ error: "google_not_configured" });
        expect(await planView(page)).toMatchObject({ seats: 0 });

        expect(await standInPlan(business.id, "active")).toEqual({
            plan_status: "active",
            plan: "team",
            changed: true,
        });
        expect(await planView(page)).toMatchObject({ access: "active", plan: "team" });
        await page.reload();
        await expect(lapsedNotice(page)).toHaveCount(0, { timeout: 60_000 });
        expect((await write("/v1/clients", { name: demoPerson(randomUUID()) })).status()).toBe(201);
        const reopened = await book(6);
        expect(reopened.response.status(), await reopened.response.text()).toBe(200);
        // a new business doesn't ask to approve first-time clients, so the booking confirms
        expect((await visitEvidence([reopened.booker.phone])).bookings).toEqual([
            expect.objectContaining({ status: "confirmed", source: "online", staff_id: owner.id }),
        ]);
        await testInfo.attach("plan-lapse", {
            body: JSON.stringify({ business: business.id, broadcast: broadcast.id }),
            contentType: "application/json",
        });
    } finally {
        await anonymous.close();
    }
});

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const BIRCHBARK_ZONE = "America/Vancouver";

async function joinMember(browser: Browser, page: Page, request: APIRequestContext) {
    const joining = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        return await joinHoursStaff(await joining.newPage(), request);
    } finally {
        await joining.close();
    }
}

// whoever is still on the team leaves with their visits canceled, as later tests expect the seed
async function letGo(page: Page, staffId: string) {
    const left = await page.request.post(`${bookingApi()}/v1/staff/${staffId}/remove`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { future: "cancel" },
    });
    expect([200, 404], await left.text()).toContain(left.status());
}

async function bookVisit(page: Page, client: string, item: string, staff: string, starts: Date) {
    return (
        await apiCall<{ id: string }>(
            page,
            "POST",
            "/v1/bookings",
            {
                client_id: client,
                item_id: item,
                staff_id: staff,
                starts_at: starts.toISOString(),
                notify: false,
            },
            201,
        )
    ).id;
}

async function openRemoval(page: Page, staffId: string, name: string, visits: number) {
    await openMember(page, staffId);
    await page.getByRole("button", { name: t.remove, exact: true }).click();
    const removal = page.getByRole("dialog", { name: t.removeTitle(name), exact: true });
    // the list reads this device's replica, which the API's bookings reach by sync
    await expect(
        removal.getByRole("list", { name: t.removeFuture }).getByRole("listitem"),
    ).toHaveCount(visits, { timeout: 60_000 });
    return removal;
}

async function chooseTaker(page: Page, removal: Locator, name: string) {
    await removal.getByRole("combobox", { name: t.removeTaker, exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
}

async function submitRemoval(page: Page, removal: Locator, staffId: string, status: number) {
    const removing = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/v1/staff/${staffId}/remove` &&
            response.request().method() === "POST",
    );
    await removal.getByRole("button", { name: t.removeConfirm, exact: true }).click();
    const answer = await removing;
    expect(answer.status(), await answer.text()).toBe(status);
    return answer;
}

test("TEAM-E2E-06 a removal is refused for a class only the member teaches and a visit nobody can take, then moves every visit, series and class to a member who offers them and sums it up", async ({
    page,
    browser,
    request,
}, testInfo) => {
    test.setTimeout(420_000);
    await signIn(page);
    const leaving = await joinMember(browser, page, request);
    const taking = await joinMember(browser, page, request);
    let removed = false;
    try {
        const day = (ahead: number, time: string) =>
            combineDayAndTime(addDays(new Date(), ahead, BIRCHBARK_ZONE), time, BIRCHBARK_ZONE);
        const service = await apiCall<{ id: string }>(
            page,
            "POST",
            "/v1/items",
            {
                kind: "service",
                name: `Removal groom ${randomUUID().slice(0, 6)}`,
                duration_min: 60,
                price_cents: 5000,
                deposit_type: "none",
                online_bookable: false,
                staff_ids: [leaving.id, taking.id],
            },
            201,
        );
        const lesson = await apiCall<{ id: string; name: string }>(
            page,
            "POST",
            "/v1/items",
            {
                kind: "class",
                name: `Removal class ${randomUUID().slice(0, 6)}`,
                duration_min: 60,
                capacity: 4,
                price_cents: 2000,
                deposit_type: "none",
                online_bookable: false,
                staff_ids: [leaving.id],
            },
            201,
        );
        const first = day(35, "07:00");
        const classes = await apiCall<{ id: string }>(
            page,
            "POST",
            "/v1/programs",
            {
                item_id: lesson.id,
                staff_id: leaving.id,
                starts_at: first.toISOString(),
                byday: [WEEKDAYS[first.getUTCDay()]],
                count: 2,
            },
            201,
        );
        const client = await createClient(page);
        const other = await createClient(page);
        const seat = await bookVisit(page, client.id, lesson.id, leaving.id, first);
        const series = await apiCall<{ id: string }>(
            page,
            "POST",
            "/v1/recurrences",
            {
                client_id: client.id,
                item_id: service.id,
                staff_id: leaving.id,
                starts_at: day(30, "18:00").toISOString(),
                frequency: "week",
                interval: 1,
                count: 2,
                confirmation: "none",
            },
            201,
        );
        const clashing = day(33, "19:00");
        const stuck = await bookVisit(page, client.id, service.id, leaving.id, clashing);
        const blocking = await bookVisit(page, other.id, service.id, taking.id, clashing);

        const removal = await openRemoval(page, leaving.id, leaving.name, 4);
        await removal.locator('button[data-value="reassign"]').click();
        await chooseTaker(page, removal, taking.name);
        await submitRemoval(page, removal, leaving.id, 409);
        await expect(removal.getByText(t.removeScheduleNotTaught(lesson.name))).toBeVisible();
        await chooseTaker(page, removal, t.removeAnyone);
        await submitRemoval(page, removal, leaving.id, 409);
        await expect(removal.getByText(t.removeScheduleNoTeacher(lesson.name))).toBeVisible();

        await apiCall(
            page,
            "PATCH",
            `/v1/items/${lesson.id}`,
            {
                staff_ids: [leaving.id, taking.id],
            },
            200,
        );
        await chooseTaker(page, removal, taking.name);
        const unplaced = await submitRemoval(page, removal, leaving.id, 409);
        expect(await unplaced.json()).toMatchObject({
            error: "visits_unplaced",
            detail: { visits: [{ booking_id: stuck, problem: "overlap" }] },
        });
        await expect(removal.getByText(t.removeUnplaced(1))).toBeVisible();
        const top = removal
            .getByRole("list", { name: t.removeFuture })
            .getByRole("listitem")
            .first();
        await expect(top).toContainText(t.removeUnplacedState);
        await expect(top).toContainText(t.removeTakerBusy);
        expect((await visitEvidence([client.id])).bookings.map((b) => b.staff_id)).toEqual(
            Array<string>(4).fill(leaving.id),
        );

        await cancelOwnedBooking(page, blocking);
        const since = Date.now();
        const done = await submitRemoval(page, removal, leaving.id, 200);
        removed = true;
        const outcome = (await done.json()) as { moved: string[]; series_moved: unknown[] };
        expect(outcome.moved.sort()).toEqual(
            (await visitEvidence([client.id])).bookings.map((b) => b.id).sort(),
        );
        expect(outcome.series_moved).toEqual(
            expect.arrayContaining([
                { recurrence_id: series.id, staff_id: taking.id },
                { recurrence_id: classes.id, staff_id: taking.id },
            ]),
        );
        const summary = page.getByRole("dialog", {
            name: t.removedTitle(leaving.name),
            exact: true,
        });
        await expect(
            summary.getByText(
                strings.common.twoSentences(t.removedMoved(4), t.removedSeriesMoved(2)),
                { exact: true },
            ),
        ).toBeVisible();
        await expect(summary.getByText(t.removedSeriesNowWith(taking.name))).toHaveCount(2);
        await summary.getByRole("button", { name: strings.common.done, exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.getByRole("main").getByText(leaving.name, { exact: true })).toHaveCount(
            0,
            { timeout: 60_000 },
        );
        const moved = await visitEvidence([client.id]);
        expect(moved.bookings.map((b) => [b.status, b.staff_id])).toEqual(
            Array<[string, string]>(4).fill(["confirmed", taking.id]),
        );
        expect(moved.bookings.map((b) => b.id)).toEqual(expect.arrayContaining([seat, stuck]));
        await expect
            .poll(async () => (await textsSince(page.request, client.phone, since)).length, {
                timeout: 60_000,
            })
            .toBeGreaterThan(0);
        expect(
            (await textsSince(page.request, client.phone, since)).some((text) =>
                text.Snippet.includes(taking.name),
            ),
        ).toBe(true);
        await testInfo.attach("removal", {
            body: JSON.stringify({ leaving: leaving.id, taking: taking.id, outcome }),
            contentType: "application/json",
        });
    } finally {
        if (!removed) await letGo(page, leaving.id);
        await letGo(page, taking.id);
    }
});

test("TEAM-E2E-07 removing a member who is owed pay cancels their visits, tells the client, and keeps them in Staff pay", async ({
    page,
    browser,
    request,
}) => {
    test.setTimeout(300_000);
    await signIn(page);
    const leaving = await joinMember(browser, page, request);
    let removed = false;
    try {
        await makePayee(page, leaving.id);
        const client = await createClient(page);
        // a sale credited to the member, with no visit of theirs, leaves them owed
        const sale = await apiCall<{ id: string }>(
            page,
            "POST",
            "/v1/orders",
            {
                client_id: client.id,
                lines: [
                    {
                        description: "Removal coat care",
                        unit_amount_cents: 10000,
                        quantity: 1,
                        tax_class: "exempt",
                        staff_id: leaving.id,
                    },
                ],
            },
            201,
        );
        await apiCall(page, "POST", `/v1/orders/${sale.id}/cash`, { tendered_cents: 10000 }, 200);
        const service = await apiCall<{ id: string }>(
            page,
            "POST",
            "/v1/items",
            {
                kind: "service",
                name: `Removal trim ${randomUUID().slice(0, 6)}`,
                duration_min: 45,
                price_cents: 4000,
                deposit_type: "none",
                online_bookable: false,
            },
            201,
        );
        const visit = await bookVisit(
            page,
            client.id,
            service.id,
            leaving.id,
            combineDayAndTime(addDays(new Date(), 31, BIRCHBARK_ZONE), "18:30", BIRCHBARK_ZONE),
        );

        const removal = await openRemoval(page, leaving.id, leaving.name, 1);
        await expect(
            removal.getByText(strings.earnings.owedOnRemove(formatMoney(6000, "CAD"))),
        ).toBeVisible();
        await removal.locator('button[data-value="cancel"]').click();
        await expect(removal.getByText(t.removeStateCancel, { exact: true })).toBeVisible();
        const since = Date.now();
        await submitRemoval(page, removal, leaving.id, 200);
        removed = true;
        const summary = page.getByRole("dialog", {
            name: t.removedTitle(leaving.name),
            exact: true,
        });
        await expect(summary.getByText(t.removedCanceled(1))).toBeVisible();
        await summary.getByRole("button", { name: strings.common.done, exact: true }).click();
        expect((await visitEvidence([client.id])).bookings).toEqual([
            expect.objectContaining({ id: visit, status: "canceled" }),
        ]);
        // the client was booked without a text, so the only one since the removal is its notice
        await expect
            .poll(async () => (await textsSince(page.request, client.phone, since)).length, {
                timeout: 60_000,
            })
            .toBeGreaterThan(0);

        await navigate(page, "/payments/staff-pay");
        const payee = page
            .getByRole("button")
            .filter({ has: page.getByText(leaving.name, { exact: true }) });
        await expect(payee).toContainText(strings.earnings.removedMember, { timeout: 60_000 });
        await expect(payee).toContainText(formatMoney(6000, "CAD"));
    } finally {
        if (!removed) await letGo(page, leaving.id);
    }
});
