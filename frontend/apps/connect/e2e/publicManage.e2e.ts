import { randomUUID } from "node:crypto";
import { addDays, combineDayAndTime, formatMoney, strings } from "@clientbridge/app-core/public";
import { demoId } from "@clientbridge/config/e2e/run";
import { expect, test } from "@playwright/test";
import { select } from "../../web/e2e/support/db";
import { expectImage, portrait } from "../../web/e2e/support/files";
import { documentApi, documentProvider } from "./support/documents";
import { links } from "./support/links";
import { ownAddress } from "./support/network";
import { watchErrors } from "./support/errors";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test("a client opens the manage link and the move picker", async ({ page }) => {
    const errors = watchErrors(page);
    const m = strings.publicManage;
    await page.goto(`/m/${links.manage}`);
    await expect(page.getByText(m.title, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: m.reschedule }).click();
    await expect(page.getByRole("heading", { name: m.moveTitle })).toBeVisible();
    await page.getByRole("button", { name: m.back }).click();
    await expect(page.getByText(m.title, { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
});

test(
    "XB-E2E-14 a client sees a deposit due on the manage link and how to pay it",
    { tag: "@browsers" },
    async ({ page }) => {
        const errors = watchErrors(page);
        const m = strings.publicManage;
        const amount = formatMoney(2500, "CAD");
        let business = "";
        let acceptsCard = false;
        await page.route(`**/manage/${links.manage}`, async (route) => {
            const response = await route.fetch();
            const booking = (await response.json()) as { business_name: string };
            business = booking.business_name;
            await route.fulfill({
                response,
                json: {
                    ...booking,
                    deposit_cents: 2500,
                    deposit_status: "pending",
                    deposit_due: true,
                    accepts_card: acceptsCard,
                },
            });
        });
        await page.goto(`/m/${links.manage}`);
        await expect(page.getByText(m.depositDue(amount))).toBeVisible();
        await expect(page.getByText(m.depositOffline(amount, business))).toBeVisible();
        await expect(page.getByRole("button", { name: m.payDeposit })).toHaveCount(0);
        acceptsCard = true;
        await page.reload();
        await expect(page.getByText(m.depositDueBody(amount))).toBeVisible();
        await expect(page.getByRole("button", { name: m.payDeposit })).toBeVisible();
        await page.unrouteAll({ behavior: "ignoreErrors" });
        expect(errors).toEqual([]);
    },
);

test(
    "XB-E2E-23 on a phone, a move from the manage link brings its confirmation into view and counts down the moves left",
    { tag: "@browsers" },
    async ({ browser }, info) => {
        const m = strings.publicManage;
        const b = strings.publicBooking;
        const base = info.project.use.baseURL;
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            ...(base === undefined ? {} : { baseURL: base }),
        });
        await ownAddress(context, info);
        const page = await context.newPage();
        const errors = watchErrors(page);
        const seen: {
            visit: { starts_at: string; ends_at: string; policy: { max_reschedules: number } };
        } = { visit: { starts_at: "", ends_at: "", policy: { max_reschedules: 0 } } };
        const unpaid = {
            reschedules_used: 0,
            can_move: true,
            deposit_cents: 0,
            deposit_status: "none",
        };
        await page.route(`**/manage/${links.manage}`, async (route) => {
            const response = await route.fetch();
            seen.visit = (await response.json()) as typeof seen.visit;
            await route.fulfill({ response, json: { ...seen.visit, ...unpaid } });
        });
        // the move is answered here, so the shared visit keeps its time and its moves
        await page.route(`**/manage/${links.manage}/reschedule`, async (route) => {
            const { starts_at } = route.request().postDataJSON() as { starts_at: string };
            const length = Date.parse(seen.visit.ends_at) - Date.parse(seen.visit.starts_at);
            await route.fulfill({
                json: {
                    ...seen.visit,
                    ...unpaid,
                    starts_at,
                    ends_at: new Date(Date.parse(starts_at) + length).toISOString(),
                    reschedules_used: 1,
                },
            });
        });
        await page.goto(`/m/${links.manage}`);
        await expect(page.getByText(m.title, { exact: true })).toBeVisible();
        const most = seen.visit.policy.max_reschedules;
        await expect(page.getByText(m.movesLeft(most), { exact: true })).toBeVisible();
        await page.getByRole("button", { name: m.reschedule, exact: true }).click();
        const times = page
            .getByRole("radiogroup", { name: b.openTimes, exact: true })
            .getByRole("radio");
        const none = page.getByText(m.noTimes, { exact: true });
        await expect(times.first().or(none)).toBeVisible();
        if (await none.isVisible()) {
            await page.getByRole("dialog").getByRole("button", { name: b.nextWeek }).last().click();
        }
        await times.first().click();
        await page.getByRole("button", { name: new RegExp(`^${m.confirmMove("")}`) }).click();
        await expect(
            page.getByRole("heading", { name: m.movedTitle, exact: true }),
        ).toBeInViewport();
        await expect(page.getByText(new RegExp(`${m.movedBodyPlain("").trim()}$`))).toBeVisible();
        await expect(page.getByText(m.movesLeft(most - 1), { exact: true })).toBeVisible();
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await context.close();
        expect(errors).toEqual([]);
    },
);

test("a client's fresh tab offers no second payment while Stripe confirms the deposit, and a cancel then promises its refund only if it lands", async ({
    page,
}) => {
    const errors = watchErrors(page);
    const m = strings.publicManage;
    const amount = formatMoney(2500, "CAD");
    await page.route(`**/manage/${links.manage}`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({
            response,
            json: {
                ...((await response.json()) as object),
                can_cancel: true,
                deposit_cents: 2500,
                deposit_status: "pending",
                deposit_due: false,
                deposit_paying: true,
                accepts_card: true,
            },
        });
    });
    // answered here, so the shared visit stays booked
    await page.route(`**/manage/${links.manage}/cancel`, async (route) => {
        await route.fulfill({ json: { deposit: "paying", refund_cents: 0 } });
    });
    await page.goto(`/m/${links.manage}`);
    await expect(page.getByText(m.depositPaying(amount), { exact: true })).toBeVisible();
    await expect(page.getByText(m.depositProcessing(amount), { exact: true })).toBeVisible();
    await expect(page.getByText(m.depositPaid(amount), { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: m.payDeposit })).toHaveCount(0);
    await page.getByRole("button", { name: m.cancel, exact: true }).click();
    await expect(page.getByText(m.cancelRefund(amount), { exact: true })).toBeVisible();
    await page.getByRole("button", { name: m.cancelConfirm, exact: true }).click();
    await expect(page.getByRole("heading", { name: m.canceledTitle, exact: true })).toBeVisible();
    await expect(page.getByText(m.canceledPaying(amount), { exact: true }).first()).toBeVisible();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(errors).toEqual([]);
});

test("CRM-E2E-22 the manage link shows the client's photo only once its upload is confirmed", async ({
    page,
    request,
}) => {
    const errors = watchErrors(page);
    const provider = await documentProvider(request);
    const headers = (key = randomUUID()) => ({ ...provider.headers, "Idempotency-Key": key });
    let bookingId: string | undefined;
    for (let offset = 40; offset < 54 && bookingId === undefined; offset++) {
        const day = addDays(new Date(), offset, "America/Vancouver");
        for (const time of ["10:00", "11:00", "13:00", "14:00", "15:00"]) {
            const booked = await request.post(`${documentApi}/v1/bookings`, {
                headers: headers(),
                data: {
                    client_id: provider.clientId,
                    item_id: demoId("it_bath"),
                    staff_id: demoId("st_owner"),
                    starts_at: combineDayAndTime(day, time, "America/Vancouver").toISOString(),
                    notify: false,
                },
            });
            if (booked.status() === 409) continue;
            expect(booked.status(), await booked.text()).toBe(201);
            bookingId = ((await booked.json()) as { id: string }).id;
            break;
        }
    }
    if (bookingId === undefined) throw new Error("No free owner time for the manage link");
    const [row] = await select<{ manage_token: string }>`
        SELECT manage_token FROM bookings WHERE id = ${bookingId}`;
    if (row === undefined) throw new Error("The booking has no manage link");
    const photo = await portrait();
    try {
        const minted = await request.post(`${documentApi}/v1/files`, {
            headers: headers(),
            data: {
                parent_type: "client",
                parent_id: provider.clientId,
                purpose: "photo",
                content_type: photo.mimeType,
                size: photo.buffer.length,
            },
        });
        expect(minted.status(), await minted.text()).toBe(201);
        const upload = (await minted.json()) as { file: { id: string }; upload_url: string };
        const greeting = page
            .getByText(strings.publicManage.hello(provider.name.split(" ")[0] ?? ""), {
                exact: true,
            })
            .locator("..");
        await page.goto(`/m/${row.manage_token}`);
        await expect(greeting).toBeVisible();
        await expect(greeting.locator("img")).toHaveCount(0);

        const stored = await request.put(upload.upload_url, {
            headers: { "Content-Type": photo.mimeType },
            data: photo.buffer,
        });
        expect(stored.status()).toBe(200);
        const confirmed = await request.post(`${documentApi}/v1/files/${upload.file.id}/complete`, {
            headers: headers(),
            data: {},
        });
        expect(confirmed.status(), await confirmed.text()).toBe(200);
        await page.reload();
        const source = await expectImage(greeting.locator("img"), page, photo.sha256);
        expect(source).toContain(`/manage/${row.manage_token}/photos/${upload.file.id}`);
        expect(errors).toEqual([]);
    } finally {
        const cleared = await request.delete(
            `${documentApi}/v1/files/photos/client/${provider.clientId}`,
            { headers: provider.headers },
        );
        expect(cleared.status(), await cleared.text()).toBe(204);
        const canceled = await request.patch(`${documentApi}/v1/bookings/${bookingId}`, {
            headers: provider.headers,
            data: { status: "canceled", notify: false },
        });
        expect(canceled.status(), await canceled.text()).toBe(200);
    }
});
