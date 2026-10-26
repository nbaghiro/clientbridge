import { randomUUID } from "node:crypto";
import {
    addDays,
    combineDayAndTime,
    dateKey,
    formatMoney,
    strings,
} from "@clientbridge/app-core/public";
import { expect, type Browser, type Frame, type Page } from "@playwright/test";
import { bookingApi } from "../../web/e2e/support/bookings";
import {
    apiCall,
    connectUrl,
    fillConnectDetails,
    onlineBooker,
    teamMember,
} from "../../web/e2e/support/visit";
import { enterStripeCard, stripeReady } from "./stripe-provider";
import {
    bindEnrolment,
    registerEnrolmentClient,
    type DepositFixture,
} from "./stripe-deposit-contract";
import { demoSlug, runEmail } from "@clientbridge/config/e2e/run";

const b = strings.publicBooking;
const ZONE = "America/Vancouver";
export const PROGRAM = { price: 12000, deposit: 2000, days: 3 };

export function webBaseUrl(): string {
    const url = process.env.WEB_BASE_URL;
    if (!url) throw new Error("run through the Stripe lane, which sets WEB_BASE_URL");
    return url;
}

interface Scheduled {
    id: string;
    sessions: { slot_id: string; starts_at: string }[];
}

// API prerequisites; the client's sandbox customer is registered before Connect opens its deposit
export async function prepareProgram(owner: Page) {
    await stripeReady();
    const member = await teamMember(owner, runEmail("hannah@birchbark.example"));
    const run = randomUUID().slice(0, 6).toUpperCase();
    const camp = await apiCall<{ id: string; name: string }>(
        owner,
        "POST",
        "/v1/items",
        {
            kind: "class",
            name: `Puppy manners camp ${run}`,
            duration_min: 60,
            price_cents: PROGRAM.price,
            tax_class: "standard",
            capacity: 2,
            session_count: PROGRAM.days,
            deposit_type: "fixed",
            deposit_value: PROGRAM.deposit,
            online_bookable: true,
        },
        201,
    );
    let program: Scheduled | null = null;
    for (let week = 3; week < 10 && program === null; week++) {
        const ahead = addDays(new Date(), week * 7, ZONE);
        const weekday = new Date(`${dateKey(ahead, ZONE)}T12:00:00Z`).getUTCDay();
        const monday = dateKey(addDays(ahead, -((weekday + 6) % 7), ZONE), ZONE);
        const response = await owner.request.post(`${bookingApi()}/v1/programs`, {
            headers: { Origin: new URL(owner.url()).origin, "Idempotency-Key": randomUUID() },
            data: {
                item_id: camp.id,
                staff_id: member.id,
                starts_at: combineDayAndTime(monday, "17:00", ZONE).toISOString(),
                byday: ["MO", "TU", "WE"],
                count: PROGRAM.days,
            },
        });
        if (response.status() === 409) continue;
        expect(response.status(), await response.text()).toBe(201);
        program = (await response.json()) as Scheduled;
    }
    if (program === null) throw new Error("No free week for the camp");
    const booker = onlineBooker("Juniper");
    const client = await apiCall<{ id: string }>(
        owner,
        "POST",
        "/v1/clients",
        { name: booker.name, email: booker.email, preferred_channel: "email" },
        201,
    );
    await registerEnrolmentClient(client.id);
    return { camp, program, booker, clientId: client.id };
}

export interface Enrolment {
    fixture: DepositFixture;
    bookingIds: string[];
    status: string;
}

export async function enrolWithCardDeposit(
    browser: Browser,
    setup: Awaited<ReturnType<typeof prepareProgram>>,
): Promise<Enrolment> {
    const context = await browser.newContext({
        extraHTTPHeaders: {
            "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":") ?? "0"}::1`,
        },
    });
    try {
        const page = await context.newPage();
        const listed = page.waitForResponse(
            (r) => r.url().includes(`/book/${demoSlug("birchbark")}/programs?`) && r.ok(),
        );
        await page.goto(connectUrl(demoSlug("birchbark")));
        await page
            .getByRole("button")
            .filter({ has: page.getByText(setup.camp.name, { exact: true }) })
            .click();
        await listed;
        const cards = page.getByRole("group", { name: b.programPick, exact: true });
        await expect(cards.getByRole("button")).toHaveCount(1);
        await cards.getByRole("button").first().click();
        await fillConnectDetails(page, setup.booker, "pet");
        const posted = page.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}` &&
                r.request().method() === "POST",
        );
        await page
            .getByRole("button", {
                name: b.confirmAndPay(formatMoney(PROGRAM.deposit, "CAD")),
                exact: true,
            })
            .click();
        const response = await posted;
        expect(response.status(), await response.text()).toBe(200);
        const enrolled = (await response.json()) as {
            booking_id: string;
            booking_ids: string[];
            status: string;
            deposit_cents: number;
            deposit_client_secret: string | null;
        };
        expect(enrolled.booking_ids).toHaveLength(PROGRAM.days);
        expect(enrolled.booking_ids[0]).toBe(enrolled.booking_id);
        expect(enrolled.deposit_cents).toBe(PROGRAM.deposit);
        expect(enrolled.deposit_client_secret).not.toBeNull();
        const fixture = await bindEnrolment(setup.clientId, enrolled.booking_id);
        let card: Frame | undefined;
        await expect
            .poll(
                async () => {
                    for (const frame of page.frames())
                        if (
                            await frame
                                .getByRole("textbox", { name: "Card number", exact: true })
                                .isVisible()
                        ) {
                            card = frame;
                            return true;
                        }
                    return false;
                },
                { timeout: 60_000 },
            )
            .toBe(true);
        if (!card) throw new Error("real Stripe PaymentElement did not load");
        await enterStripeCard(card, "4242424242424242");
        const pay = page.getByRole("button", {
            name: b.pay(formatMoney(PROGRAM.deposit, "CAD")),
            exact: true,
        });
        await page.getByRole("heading", { name: b.payTitle, exact: true }).click();
        await pay.scrollIntoViewIfNeeded();
        await expect(pay).toBeInViewport({ ratio: 1 });
        await pay.click();
        await expect(
            page.getByRole("heading", {
                name: enrolled.status === "pending" ? b.pendingTitle : b.doneTitle,
                exact: true,
            }),
        ).toBeVisible({ timeout: 60_000 });
        return { fixture, bookingIds: enrolled.booking_ids, status: enrolled.status };
    } finally {
        await context.close();
    }
}
