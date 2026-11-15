import { strings } from "@clientbridge/app-core/public";
import { type Browser, type Page, expect, test } from "@playwright/test";
import { demoId, demoSlug, runEmail } from "@clientbridge/config/e2e/run";

import { newAccount } from "./support/auth";
import { createBookingFixture } from "./support/bookings";
import { joinHoursStaff } from "./support/hours";
import { patchBusiness, signUp, storedBrand } from "./support/business";
import { apiBase, headers } from "./support/messaging";
import { customerContext, navigate, signIn } from "./support/session";
import {
    type SentInvite,
    ageInvites,
    clientName,
    expectOnlyClientsOf,
    inviteDialog,
    inviteFromDialog,
    inviteRow,
    invitesTo,
    membershipsOf,
    openTeam,
} from "./support/staff";
import { openConnectService } from "./support/visit";

const s = strings.staff;
const t = s.team;
const n = strings.navigation;
const WEEK = 7 * 86_400;
// one teal pixel, enough for the photo pipeline to store and serve
const PIXEL = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQSysAAAHKAQVhmI48AAAAAElFTkSuQmCC",
    "base64",
);

async function signedOut(browser: Browser, page: Page): Promise<Page> {
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
    return context.newPage();
}

/** Removes a joined member, or revokes the invite, so later cases see only the seeded team. */
async function dropInvite(page: Page, id: string): Promise<void> {
    const revoked = await page.request.post(`${apiBase()}/v1/staff/invites/${id}/revoke`, {
        headers: headers(page),
    });
    if (revoked.ok()) return;
    const removed = await page.request.post(`${apiBase()}/v1/staff/${id}/remove`, {
        data: {},
        headers: headers(page),
    });
    expect(removed.status(), await removed.text()).toBe(200);
}

async function joinFromLink(
    page: Page,
    invite: SentInvite,
    account: ReturnType<typeof newAccount>,
) {
    await page.goto(`/accept-invite?token=${invite.invite_token}`);
    await page.getByRole("button", { name: s.inviteSignUp, exact: true }).click();
    await signUp(page, page.request, account);
    await expect(page).toHaveURL(/\/accept-invite$/);
    await page.getByRole("button", { name: s.inviteJoin, exact: true }).click();
    await expect(
        page.locator("aside").getByRole("link", { name: n.businessMenu, exact: true }),
    ).toBeVisible({ timeout: 60_000 });
}

test("TEAM-E2E-01 an address holds one invite, a resend retires the old link, two accepts join once, and revoked or lapsed links say so", async ({
    page,
    browser,
}) => {
    test.setTimeout(240_000);
    await signIn(page);
    await openTeam(page);
    const joiner = newAccount("team-join");
    const gone = newAccount("team-revoked");
    const lapsed = newAccount("team-lapsed");
    const sent: SentInvite[] = [];
    try {
        const first = await inviteFromDialog(page, joiner.email, "admin");
        sent.push(first);

        await test.step("the next invite starts from staff and an invited address is refused", async () => {
            await page.getByRole("button", { name: t.inviteMember, exact: true }).first().click();
            const dialog = inviteDialog(page);
            await expect(dialog.locator('button[data-value="staff"]')).toHaveAttribute(
                "aria-pressed",
                "true",
            );
            await dialog.getByRole("textbox", { name: t.emails }).fill(joiner.email.toUpperCase());
            await dialog.getByRole("button", { name: t.send, exact: true }).click();
            await expect(dialog.getByText(t.alreadyInvited(joiner.email))).toBeVisible();
            await dialog.getByRole("button", { name: strings.common.cancel, exact: true }).click();
            const again = await page.request.post(`${apiBase()}/v1/staff/invites`, {
                data: { email: ` ${joiner.email.toUpperCase()}`, role: "staff" },
                headers: headers(page),
            });
            expect(again.status()).toBe(409);
            expect(await again.json()).toMatchObject({ error: "already_invited" });
            expect(await invitesTo(joiner.email)).toMatchObject([
                { id: first.id, role: "admin", status: "invited" },
            ]);
        });

        let fresh = first;
        await test.step("a resend mails a new link and the old one stops working", async () => {
            const resent = page.waitForResponse((r) =>
                r.url().endsWith(`/v1/staff/invites/${first.id}/resend`),
            );
            await inviteRow(page, joiner.email)
                .getByRole("button", { name: t.resend, exact: true })
                .click();
            await page
                .getByRole("dialog")
                .filter({ hasText: s.review.resendTitle(joiner.email) })
                .getByRole("button", { name: strings.previews.send, exact: true })
                .click();
            fresh = (await (await resent).json()) as SentInvite;
            await expect(
                inviteRow(page, joiner.email).getByRole("button", { name: t.resent }),
            ).toBeVisible();
            const stale = await signedOut(browser, page);
            await stale.goto(`/accept-invite?token=${first.invite_token}`);
            await expect(stale.getByText(s.inviteProblem.invalid, { exact: true })).toBeVisible();
            await stale.context().close();
        });

        await test.step("two accepts of the new link at once join the team once", async () => {
            const invitee = await signedOut(browser, page);
            try {
                await invitee.goto(`/accept-invite?token=${fresh.invite_token}`);
                await invitee.getByRole("button", { name: s.inviteSignUp, exact: true }).click();
                await signUp(invitee, invitee.request, joiner);
                await expect(invitee).toHaveURL(/\/accept-invite$/);
                const accept = () =>
                    invitee.request.post(`${apiBase()}/v1/staff/invites/accept`, {
                        data: { token: fresh.invite_token },
                        headers: { Origin: new URL(invitee.url()).origin },
                    });
                const both = await Promise.all([accept(), accept()]);
                expect(both.map((r) => r.status()).sort()).toEqual([200, 409]);
                expect(await membershipsOf(joiner.email)).toEqual([
                    { id: first.id, status: "active" },
                ]);
                await expect(
                    invitee
                        .getByText(s.inviteProblem.accepted, { exact: true })
                        .or(invitee.getByText(s.inviteProblem.member, { exact: true }))
                        .or(invitee.locator("aside").getByRole("link", { name: n.businessMenu })),
                ).toBeVisible({ timeout: 60_000 });
            } finally {
                await invitee.context().close();
            }
        });

        await test.step("a revoked link and a week-old one explain why they no longer work", async () => {
            const revoked = await inviteFromDialog(page, gone.email, "staff");
            const aged = await inviteFromDialog(page, lapsed.email, "staff");
            sent.push(aged);
            await inviteRow(page, gone.email).getByRole("button", { name: t.revoke }).click();
            await page
                .getByRole("dialog")
                .filter({ hasText: t.revokeTitle(gone.email) })
                .getByRole("button", { name: t.revoke, exact: true })
                .click();
            await expect(page.getByRole("main").getByText(gone.email)).toHaveCount(0);
            await ageInvites(WEEK + 60, [aged.id]);
            await expect(inviteRow(page, lapsed.email).getByText(t.expired)).toBeVisible({
                timeout: 30_000,
            });
            const visitor = await signedOut(browser, page);
            await visitor.goto(`/accept-invite?token=${revoked.invite_token}`);
            await expect(visitor.getByText(s.inviteProblem.invalid, { exact: true })).toBeVisible();
            await visitor.goto(`/accept-invite?token=${aged.invite_token}`);
            await expect(visitor.getByText(s.inviteProblem.expired, { exact: true })).toBeVisible();
            await visitor.context().close();
        });
    } finally {
        for (const invite of sent) await dropInvite(page, invite.id);
    }
});

test("TEAM-E2E-02 an admin reaches everything but the plan, and a contractor sees only what staff see", async ({
    page,
    browser,
}) => {
    test.setTimeout(240_000);
    const admin = page;
    await signIn(admin, { email: runEmail("admin@birchbark.example"), password: "demo1234" });

    await test.step("admin: every setup section and payments tab but the plan", async () => {
        await navigate(admin, "/setup");
        await expect(admin).toHaveURL(/\/setup\/start$/);
        await expect(admin.getByRole("main").getByRole("navigation").getByRole("link")).toHaveText([
            n.setupSections.start,
            n.setupSections.business,
            n.setupSections.services,
            n.setupSections.resources,
            n.setupSections.team,
            n.setupSections.gettingPaid,
            n.setupSections.taxes,
            n.setupSections.onlineBooking,
            n.setupSections.reminders,
            n.setupSections.security,
        ]);
        await navigate(admin, "/setup/security");
        await expect(
            admin.getByRole("heading", { name: n.setupSections.security }).first(),
        ).toBeVisible();
        await expect(admin.getByText(strings.plans.subtitle, { exact: true })).toHaveCount(0);
        expect((await admin.request.get(`${apiBase()}/v1/plan`)).status()).toBe(403);
        const portal = await admin.request.post(`${apiBase()}/v1/plan/portal`, {
            headers: headers(admin),
        });
        expect(portal.status()).toBe(403);
        await navigate(admin, "/payments/invoices");
        for (const tab of [
            n.paymentsTabs.invoices,
            n.paymentsTabs.refunds,
            n.paymentsTabs.staffPay,
        ])
            await expect(admin.getByRole("main").getByRole("tab", { name: tab })).toBeVisible();
    });

    const contractor = newAccount("team-contractor");
    const invite = (await (
        await admin.request.post(`${apiBase()}/v1/staff/invites`, {
            data: { email: contractor.email, role: "contractor" },
            headers: headers(admin),
        })
    ).json()) as SentInvite;
    const member = await signedOut(browser, admin);
    try {
        await joinFromLink(member, invite, contractor);
        await test.step("contractor: the staff shell, and no inviting", async () => {
            await navigate(member, "/payments/invoices");
            await expect(member).toHaveURL(/\/payments\/sales$/);
            await expect(member.getByRole("main").getByRole("tab")).toHaveText([
                n.paymentsTabs.sales,
                n.paymentsTabs.myPay,
            ]);
            await navigate(member, "/setup/business");
            await expect(member).toHaveURL(/\/setup\/team$/);
            await expect(
                member.getByRole("main").getByRole("navigation").getByRole("link"),
            ).toHaveText([n.setupSections.team, n.setupSections.security]);
            await navigate(member, "/inbox");
            for (const segment of Object.values(n.inboxSegments))
                await expect(
                    member.getByRole("main").getByRole("tab", { name: segment }),
                ).toHaveCount(0);
            const refused = await member.request.post(`${apiBase()}/v1/staff/invites`, {
                data: { email: newAccount("team-nope").email },
                headers: headers(member),
            });
            expect(refused.status()).toBe(403);
        });
    } finally {
        await member.context().close();
        await dropInvite(admin, invite.id);
    }
});

test("TEAM-E2E-03 an owner of another business joins as staff, lands on the team they joined and switches between both", async ({
    page,
    browser,
}) => {
    test.setTimeout(240_000);
    const other = { email: runEmail("owner@northlight.example"), password: "demo1234" };
    await signIn(page);
    const invite = (await (
        await page.request.post(`${apiBase()}/v1/staff/invites`, {
            data: { email: other.email, role: "staff" },
            headers: headers(page),
        })
    ).json()) as SentInvite;
    const person = await signedOut(browser, page);
    const picker = (p: Page) =>
        p.locator("aside").getByRole("combobox", { name: strings.business.switchBusiness });
    const current = (p: Page) =>
        p.locator("aside").getByRole("link", { name: n.businessMenu, exact: true });
    const choose = async (p: Page, name: RegExp) => {
        await picker(p).click();
        await p.getByRole("option", { name }).click();
    };
    let left: string;
    const [birchbark, northlight] = await Promise.all([
        clientName("cl_amelie"),
        clientName("cl_nl_rajesh"),
    ]);
    try {
        await signIn(person, other);
        await expect(picker(person)).toHaveCount(0);
        await person.goto(`/accept-invite?token=${invite.invite_token}`);
        await person.getByRole("button", { name: s.inviteJoin, exact: true }).click();

        await test.step("joining opens the new team, as staff", async () => {
            await expect(person).toHaveURL(/\/today$/, { timeout: 60_000 });
            await expect(current(person)).toContainText(/Birchbark/, { timeout: 60_000 });
            await expect(picker(person)).toBeVisible();
            await expectOnlyClientsOf(person, birchbark, northlight);
            await navigate(person, "/payments");
            await expect(person.getByRole("main").getByRole("tab")).toHaveText([
                n.paymentsTabs.sales,
                n.paymentsTabs.myPay,
            ]);
        });

        await test.step("the sidebar switches back to the business they own", async () => {
            await choose(person, /Northlight/);
            await expect(current(person)).toContainText(/Northlight/, { timeout: 60_000 });
            await expectOnlyClientsOf(person, northlight, birchbark);
            await navigate(person, "/payments/invoices");
            await expect(
                person.getByRole("main").getByRole("tab", { name: n.paymentsTabs.invoices }),
            ).toBeVisible({ timeout: 60_000 });
        });

        await test.step("a new sign-in asks which business to open", async () => {
            const fresh = await signedOut(browser, page);
            await fresh.goto("/");
            await fresh
                .getByRole("textbox", { name: strings.auth.email, exact: true })
                .fill(other.email);
            await fresh.getByLabel(strings.auth.password, { exact: true }).fill(other.password);
            await fresh.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
            await expect(
                fresh.getByRole("heading", { name: strings.business.chooseTitle }),
            ).toBeVisible({ timeout: 60_000 });
            await fresh.getByRole("combobox", { name: strings.business.selectBusiness }).click();
            await fresh.getByRole("option", { name: /Birchbark/ }).click();
            await expect(fresh).toHaveURL(/\/today$/, { timeout: 60_000 });
            await expect(current(fresh)).toContainText(/Birchbark/);
            await fresh.context().close();
        });
    } finally {
        await person.context().close();
        const [membership] = await membershipsOf(other.email);
        left = membership?.id ?? invite.id;
        await dropInvite(page, left);
    }
    expect(await membershipsOf(other.email)).toEqual([{ id: left, status: "removed" }]);
});

test("TEAM-E2E-05 a member's title, colour and photo set on the Team page reach the schedule and the booking page", async ({
    page,
    browser,
    request,
    baseURL,
}) => {
    test.setTimeout(240_000);
    const joining = await browser.newContext({ baseURL: baseURL ?? "" });
    const member = await joinHoursStaff(await joining.newPage(), request);
    await joining.close();
    try {
        await signIn(page);
        await openTeam(page);
        await page.getByRole("main").getByText(member.name, { exact: true }).first().click();
        const panel = page.getByRole("dialog", { name: member.name });
        await panel.getByRole("textbox", { name: t.title }).fill("Junior Groomer");
        await panel
            .getByRole("radiogroup", { name: t.colour })
            .getByRole("radio", { name: strings.business.getSetUp.colourNames.teal })
            .click();
        const saved = page.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/v1/staff/${member.id}` &&
                r.request().method() === "PATCH",
        );
        await panel.getByRole("button", { name: t.saveProfile, exact: true }).click();
        expect((await saved).status()).toBe(204);
        await panel
            .locator('input[type="file"]')
            .setInputFiles({ name: "face.png", mimeType: "image/png", buffer: PIXEL });
        await expect(panel.getByText("Junior Groomer", { exact: true })).toBeVisible();
        // the avatar paints the photo; its hidden img only reports a broken one
        await expect(panel.locator('[style*="background-image"]').first()).toBeVisible({
            timeout: 30_000,
        });

        await navigate(page, "/schedule");
        const lane = page.getByRole("main").locator("li").filter({ hasText: member.name });
        await expect(lane.locator('[style*="background-color: rgb(46, 102, 112)"]')).toHaveCount(
            1,
            {
                timeout: 30_000,
            },
        );
        await expect(lane.locator('[style*="background-image"]')).toBeVisible({ timeout: 30_000 });

        const fixture = await createBookingFixture(page, { online_bookable: true });
        // photos reach public pages only for the members the business puts on its public team
        const shown = (await storedBrand(demoId("bz_birchbark"))).public_staff_ids as string[];
        const visitor = await customerContext(browser);
        try {
            const opted = await patchBusiness(page, {
                brand: { public_staff_ids: [...shown, member.id] },
            });
            expect(opted.status(), await opted.text()).toBe(200);
            const client = await visitor.newPage();
            await openConnectService(client, demoSlug("birchbark"), fixture.itemName);
            const choice = client
                .getByRole("group", { name: strings.publicBooking.with, exact: true })
                .locator(`button[data-value="${member.id}"]`);
            await expect(choice).toContainText("Junior Groomer", { timeout: 60_000 });
            await expect(choice.locator('[style*="background-image"]')).toBeVisible({
                timeout: 30_000,
            });
        } finally {
            await visitor.close();
            await patchBusiness(page, { brand: { public_staff_ids: shown } });
        }
    } finally {
        await member.cleanup();
    }
});
