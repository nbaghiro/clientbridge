import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { addDays, combineDayAndTime, strings } from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";
import { freshPhone, newAccount } from "../support/auth";
import { bookingApi } from "../support/bookings";
import { createClient } from "../support/clients";
import { acceptInvite } from "../support/hours";
import { navigate } from "../support/session";
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
        const outcome = (await removed.json()) as {
            moved: string[];
            canceled: string[];
            left: unknown[];
        };
        expect(outcome).toMatchObject({ moved: [visit.id], canceled: [], left: [] });
        // every visit moved and nothing was left over, so the record closes with no summary
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(
            page.getByRole("heading", { name: t.removedTitle(account.name), exact: true }),
        ).toHaveCount(0);
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
