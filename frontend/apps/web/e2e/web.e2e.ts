import { strings } from "@clientbridge/app-core/public";
import { expect, type Locator, type Page, test } from "@playwright/test";

const OWNER = "hannah@birchbarkpets.ca";
const STAFF = "diego@birchbarkpets.ca";
const PASSWORD = "demo1234";
// A seeded visit with a $20 deposit; opening it by link puts its day on the board.
const DEPOSIT_BOOKING = "bk_015";

const PAYMENTS_TABS = {
    invoices: strings.billing.newInvoice,
    sales: strings.pos.desk.todaysVisits,
    "gift-cards": strings.entitlements.walletTitle,
    refunds: strings.refunds.paymentsTitle,
    "staff-pay": strings.earnings.selectAll,
    tax: strings.remittances.recordFiled,
    payouts: strings.payouts.chargesTitle,
    reports: strings.reports.monthlyNet,
};
const SETUP_SECTIONS = [
    "start",
    "business",
    "services",
    "team",
    "getting-paid",
    "taxes",
    "online-booking",
    "reminders",
];
const MANAGER_PAYMENTS_TABS = [
    strings.navigation.paymentsTabs.invoices,
    strings.navigation.paymentsTabs.giftCards,
    strings.navigation.paymentsTabs.refunds,
    strings.navigation.paymentsTabs.staffPay,
    strings.navigation.paymentsTabs.taxReturns,
    strings.navigation.paymentsTabs.payouts,
    strings.navigation.paymentsTabs.reports,
];
const MANAGER_SETUP_SECTIONS = [
    strings.navigation.setupSections.start,
    strings.navigation.setupSections.business,
    strings.navigation.setupSections.services,
    strings.navigation.setupSections.gettingPaid,
    strings.navigation.setupSections.taxes,
    strings.navigation.setupSections.onlineBooking,
    strings.navigation.setupSections.reminders,
];

const startsWith = (label: string): RegExp =>
    new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
/** Matches what a copy function renders before its first argument, whatever that argument is. */
const prefixOf = (copy: (value: string) => string): RegExp =>
    startsWith(copy("\0").split("\0")[0] ?? "");
const exactly = (label: string): RegExp =>
    new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

class Walk {
    readonly errors: string[] = [];
    private current = "sign in";

    constructor(readonly page: Page) {
        page.on("pageerror", (e) => {
            this.errors.push(`[${this.current}] pageerror: ${e.message}`);
        });
        page.on("console", (m) => {
            if (m.type() === "error") this.errors.push(`[${this.current}] console: ${m.text()}`);
        });
    }

    get main(): Locator {
        return this.page.locator("main");
    }

    async step(name: string, body: () => Promise<void>): Promise<void> {
        this.current = name;
        await test.step(name, async () => {
            await body();
            if (process.env.E2E_CAPTURE_SURFACES === "1") {
                await expect(this.main).not.toHaveText("");
                await expect(this.page.locator('[aria-busy="true"]')).toHaveCount(0);
                await expect(
                    this.page
                        .getByRole("status")
                        .filter({ hasText: exactly(strings.common.loading) }),
                ).toHaveCount(0);
                await test.info().attach(name, {
                    body: await this.page.screenshot({ fullPage: true }),
                    contentType: "image/png",
                });
            }
        });
    }

    expectNoErrors(): void {
        expect(this.errors).toEqual([]);
    }
}

async function signIn(page: Page, email: string): Promise<Walk> {
    const walk = new Walk(page);
    await page.goto("/");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(walk.main.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/today$/);
    // The replica needs a moment to sync before the pages have rows to open.
    await page.waitForTimeout(6000);
    return walk;
}

async function navigate(page: Page, path: string, landsOn: string = path): Promise<void> {
    await page.evaluate((to) => {
        history.pushState({}, "", to);
        dispatchEvent(new PopStateEvent("popstate"));
    }, path);
    await expect(page).toHaveURL(new RegExp(`${landsOn.replace(/[?]/g, "\\?")}$`));
    await page.waitForTimeout(500);
}

async function escapeDialog(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
}

async function openAndClose(page: Page, opener: string | RegExp): Promise<void> {
    await page.locator("main").getByRole("button", { name: opener }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await escapeDialog(page);
}

async function openFirstRow(page: Page): Promise<void> {
    await page.locator("main button.block").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await escapeDialog(page);
}

async function cancelConfirm(page: Page, trigger: Locator, title: string | RegExp): Promise<void> {
    await expect(trigger).toBeVisible();
    const dialogs = page.getByRole("dialog");
    const open = await dialogs.count();
    await trigger.click();
    // The confirm host renders after the page, so it is the last dialog even when titles repeat.
    const ask = page.getByRole("dialog", { name: title }).last();
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: strings.common.cancel, exact: true }).click();
    await expect(dialogs).toHaveCount(open);
}

/** A booking block on the schedule grid; its accessible name starts with its time range. */
function gridBookings(main: Locator): Locator {
    return main.getByRole("button", { name: /^\d{1,2}:\d{2} [ap]\.m\. – \d/ });
}

test("owner: shell, today, create menu, search, notifications and account menu", async ({
    page,
}) => {
    const walk = await signIn(page, OWNER);
    const { main } = walk;
    const sidebar = page.locator("aside");
    const n = strings.navigation;

    await walk.step("today", async () => {
        await expect(main.getByText(strings.today.schedule)).toBeVisible();
        await expect(main.getByText(strings.today.needsYou)).toBeVisible();
        await expect(main.getByText(strings.today.booked)).toBeVisible();
        await main.getByRole("button", { name: strings.today.openSchedule }).click();
        await expect(page).toHaveURL(/\/schedule$/);
        await sidebar.getByRole("link", { name: n.today }).click();
        await expect(page).toHaveURL(/\/today$/);
    });

    await walk.step("create menu", async () => {
        await sidebar.getByRole("button", { name: n.createMenu }).click();
        const menu = page.getByRole("menu", { name: n.createMenu });
        await expect(menu.getByRole("menuitem")).toHaveCount(7);
        await page.keyboard.press("c");
        await expect(page).toHaveURL(/\/clients$/);
        await expect(page.getByRole("dialog")).toBeVisible();
        await escapeDialog(page);
    });

    const create = async (label: string): Promise<void> => {
        await navigate(page, "/today");
        await sidebar.getByRole("button", { name: n.createMenu }).click();
        await page
            .getByRole("menu", { name: n.createMenu })
            .getByRole("menuitem", { name: startsWith(label) })
            .click();
    };
    const c = n.createActions;
    await walk.step("create: booking", async () => {
        await create(c.booking.label);
        const composer = page.getByRole("form", { name: strings.bookings.newBooking });
        await expect(composer).toBeVisible();
        await composer.getByRole("button", { name: strings.common.close }).click();
        await expect(composer).toBeHidden();
    });
    await walk.step("create: sale", async () => {
        await create(c.sale.label);
        await expect(page).toHaveURL(/\/payments\/sales$/);
        await expect(main.getByText(strings.pos.desk.todaysVisits)).toBeVisible();
    });
    for (const [key, path] of [
        ["invoice", /\/payments\/invoices$/],
        ["estimate", /\/payments\/invoices\?doc=estimates$/],
        ["client", /\/clients$/],
        ["message", /\/inbox$/],
    ] as const) {
        await walk.step(`create: ${key}`, async () => {
            await create(c[key].label);
            await expect(page).toHaveURL(path);
            await expect(page.getByRole("dialog")).toBeVisible();
            await escapeDialog(page);
        });
    }
    await walk.step("create: time off", async () => {
        await create(c.timeOff.label);
        await expect(page).toHaveURL(/\/setup\/team$/);
        await expect(main.getByRole("button", { name: strings.hours.addTimeOff })).toBeVisible();
    });

    await walk.step("search", async () => {
        await page.keyboard.press("ControlOrMeta+k");
        const palette = page.getByRole("dialog");
        await expect(palette.getByText(strings.search.jumpTo)).toBeVisible();
        await page.keyboard.type("ma");
        await expect(
            palette.getByText(strings.search.clients, { exact: true }).first(),
        ).toBeVisible();
        await escapeDialog(page);
    });

    await walk.step("notifications", async () => {
        await sidebar.getByRole("button", { name: strings.notifications.title }).click();
        const bell = page.getByRole("dialog", { name: strings.notifications.title });
        await expect(bell).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(bell).toBeHidden();
    });

    await walk.step("sidebar links", async () => {
        await sidebar.getByRole("link", { name: n.schedule }).click();
        await expect(page).toHaveURL(/\/schedule$/);
        await sidebar.getByRole("link", { name: n.businessMenu }).click();
        await expect(page).toHaveURL(/\/setup\/business$/);
        await sidebar.getByRole("link", { name: n.today }).click();
        await expect(page).toHaveURL(/\/today$/);
    });

    await walk.step("account menu: your hours", async () => {
        await sidebar.getByRole("button", { name: n.accountMenu }).click();
        const account = page.getByRole("menu");
        await expect(account.getByRole("menuitem", { name: n.signOut })).toBeVisible();
        await account.getByRole("menuitem", { name: n.yourHours }).click();
        await expect(page).toHaveURL(/\/setup\/team$/);
        await expect(account).toBeHidden();
    });

    await walk.step("account menu: sign out", async () => {
        await sidebar.getByRole("button", { name: n.accountMenu }).click();
        await page.getByRole("menuitem", { name: n.signOut }).click();
        await expect(page.locator('input[type="email"]')).toBeVisible();
    });

    walk.expectNoErrors();
});

test("owner: schedule, booking panel, classes and repeat visits", async ({ page }) => {
    const walk = await signIn(page, OWNER);
    const { main } = walk;
    const b = strings.bookings;

    await walk.step("schedule views", async () => {
        await navigate(page, "/schedule");
        const views = main.getByRole("group", { name: b.viewLabel });
        await views.getByRole("button", { name: b.viewClasses }).click();
        await expect(page).toHaveURL(/\/schedule\/classes$/);
        await views.getByRole("button", { name: b.viewSeries }).click();
        await expect(page).toHaveURL(/\/schedule\/series$/);
        await views.getByRole("button", { name: b.viewBoard }).click();
        await expect(page).toHaveURL(/\/schedule$/);
    });

    await walk.step("new booking composer", async () => {
        await main.getByRole("button", { name: b.newBooking }).click();
        const composer = page.getByRole("form", { name: b.newBooking });
        await expect(composer).toBeVisible();
        const service = composer.getByRole("combobox", { name: b.composerService });
        await expect(service).toHaveText(b.composerServicePlaceholder);
        await service.click();
        const services = page.getByRole("listbox", { name: b.composerService });
        await expect(services.getByRole("option").first()).toBeVisible();
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await expect(services).toBeHidden();
        await expect(service).toBeFocused();
        await expect(service).not.toHaveText(b.composerServicePlaceholder);
        await composer.getByRole("button", { name: b.composerDate }).click();
        const calendar = page.getByRole("dialog", { name: b.composerDate });
        await expect(calendar.getByRole("grid")).toBeVisible();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Escape");
        await expect(calendar).toBeHidden();
        await expect(composer).toBeVisible();
        await composer.getByRole("button", { name: strings.common.close }).click();
        await expect(composer).toBeHidden();
    });

    const panel = main.getByRole("complementary").filter({
        has: page.getByRole("button", { name: b.close, exact: true }),
    });

    await walk.step("booking panel from the grid", async () => {
        await main.getByRole("button", { name: b.next, exact: true }).click();
        for (let day = 0; day < 7 && (await gridBookings(main).count()) === 0; day++) {
            await main.getByRole("button", { name: b.next, exact: true }).click();
        }
        await gridBookings(main).first().click();
        await expect(panel.getByRole("heading", { level: 2 })).toBeVisible();
    });

    await walk.step("booking panel: message", async () => {
        await panel.getByRole("button", { name: b.message, exact: true }).click();
        const dialog = page.getByRole("dialog", { name: prefixOf(b.messageTitle) });
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: strings.common.cancel }).click();
        await expect(dialog).toBeHidden();
    });

    await walk.step("booking panel: reschedule", async () => {
        await panel.getByRole("button", { name: b.reschedule }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await escapeDialog(page);
    });

    await walk.step("booking panel: cancel visit, then keep it", async () => {
        await panel.getByRole("button", { name: b.cancel }).click();
        await panel.getByRole("button", { name: b.keepVisit }).click();
        await expect(panel.getByRole("button", { name: b.cancel })).toBeVisible();
        await panel.getByRole("button", { name: b.close, exact: true }).click();
        await expect(panel).toBeHidden();
    });

    await walk.step("booking panel: deposit charge sheet", async () => {
        await navigate(page, `/schedule?open=${DEPOSIT_BOOKING}`, "/schedule");
        await expect(panel.getByRole("heading", { level: 2 })).toBeVisible();
        const collect = panel.getByRole("button", { name: b.collectNow });
        if (await collect.isVisible()) {
            await collect.click();
            const charge = panel.getByRole("button", {
                name: prefixOf((x) => b.collectAmount(`$${x}`)),
            });
            await expect(charge).toBeVisible();
            await panel.getByRole("button", { name: strings.common.cancel, exact: true }).click();
            await expect(charge).toBeHidden();
        }
        await panel.getByRole("button", { name: b.close, exact: true }).click();
        await expect(panel).toBeHidden();
    });

    await walk.step("classes: roster and message everyone", async () => {
        await navigate(page, "/schedule/classes");
        await expect(main.getByRole("heading", { name: strings.classes.title })).toBeVisible();
        await main.getByRole("button", { name: strings.classes.messageClass }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await escapeDialog(page);
    });

    await walk.step("repeat visits: new series", async () => {
        await navigate(page, "/schedule/series");
        await openAndClose(page, exactly(strings.recurrences.newShort));
    });

    const rs = strings.recurrences;
    await walk.step("repeat visits: a series record, its change and cancel dialogs", async () => {
        const rows = main.locator("section").first().locator(":scope > div").getByRole("button");
        await expect(rows.first()).toBeVisible();
        const change = main.getByRole("button", { name: rs.changeSeries, exact: true });
        // The fixtures guarantee one active series with visits ahead; earlier ones may have ended.
        for (let i = 0, n = await rows.count(); i < n; i++) {
            await rows.nth(i).click();
            if (await change.isEnabled()) break;
        }
        await change.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await escapeDialog(page);
        await main.getByRole("button", { name: rs.cancelSeries, exact: true }).click();
        const ask = page.getByRole("dialog");
        await expect(ask).toContainText(rs.cancelTitle);
        await ask.getByRole("button", { name: rs.keepSeries }).click();
        await expect(ask).toBeHidden();
    });

    walk.expectNoErrors();
});

test("owner: clients, records, notes, pets, wallet and merge", async ({ page }) => {
    const walk = await signIn(page, OWNER);
    const { main } = walk;
    const r = strings.clients.record;

    await walk.step("client list", async () => {
        await navigate(page, "/clients");
        await openAndClose(page, strings.clients.add);
    });

    await walk.step("record: add note", async () => {
        await main.locator("button.block").first().click();
        const record = page.getByRole("dialog");
        await record.getByRole("button", { name: r.addNote }).click();
        await expect(page.getByRole("dialog", { name: r.addNoteTitle })).toBeVisible();
        await escapeDialog(page);
    });

    await walk.step("record: note actions", async () => {
        await main.locator("button.block").first().click();
        const record = page.getByRole("dialog");
        await record
            .getByRole("listitem")
            .getByRole("button", { name: strings.clients.history.editNote })
            .first()
            .click();
        const menu = page.getByRole("menu");
        await expect(
            menu.getByRole("menuitem", { name: startsWith(strings.clients.history.pinNote) }),
        ).toBeVisible();
        await cancelConfirm(
            page,
            menu.getByRole("menuitem", { name: strings.clients.history.deleteNote }),
            strings.clients.history.deleteNoteTitle,
        );
        await expect(record).toBeVisible();
        await escapeDialog(page);
    });

    await walk.step("tidy: tag and merge", async () => {
        await main.getByRole("button", { name: strings.clients.tidy.select }).click();
        // A seeded near-duplicate with no money or saved cards, so the merge isn't blocked.
        await main.getByRole("checkbox", { name: "Grace Lin" }).check();
        await main.getByRole("checkbox", { name: "Robin Test" }).check();
        await page.getByRole("button", { name: strings.clients.tidy.tag, exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.getByRole("button", { name: strings.clients.tidy.tag, exact: true }).click();
        await page
            .getByRole("button", { name: strings.clients.tidy.mergeSelected, exact: true })
            .click();
        const merge = page.getByRole("dialog");
        await expect(merge).toBeVisible();
        await cancelConfirm(
            page,
            merge.getByRole("button", { name: prefixOf(strings.clients.tidy.merge) }),
            strings.clients.tidy.mergeTitle,
        );
        await escapeDialog(page);
    });

    await walk.step("record pages", async () => {
        for (const view of ["history", "pets", "payment-methods"]) {
            await navigate(page, `/clients/cl_amelie/${view}`);
            await expect(page.getByRole("heading", { name: "Amélie Tremblay" })).toBeVisible();
        }
    });

    await walk.step("record: message", async () => {
        await navigate(page, "/clients/cl_amelie/history");
        await main.getByRole("button", { name: r.message, exact: true }).click();
        await expect(page).toHaveURL(/\/inbox$/);
        await expect(page.getByRole("dialog")).toBeVisible();
        await escapeDialog(page);
    });

    await walk.step("pets: add pet", async () => {
        await navigate(page, "/clients/cl_marcus/pets");
        await openAndClose(page, strings.clients.pets.addPet);
    });

    await walk.step("wallet: method actions", async () => {
        await navigate(page, "/clients/cl_amelie/payment-methods");
        await main
            .getByRole("button", { name: prefixOf(strings.clients.wallet.more) })
            .first()
            .click();
        await cancelConfirm(
            page,
            page.getByRole("menuitem", { name: startsWith(strings.clients.wallet.remove) }),
            prefixOf(strings.clients.wallet.removeTitle),
        );
    });

    walk.expectNoErrors();
});

test("owner: payments desk, records and their dialogs", async ({ page }) => {
    const walk = await signIn(page, OWNER);
    const { main } = walk;
    const s = strings.billing;

    await walk.step("payments tabs", async () => {
        for (const [tab, landmark] of Object.entries(PAYMENTS_TABS)) {
            await walk.step(`payments: ${tab}`, async () => {
                await navigate(page, `/payments/${tab}`);
                await expect(main.getByText(landmark, { exact: true }).first()).toBeVisible();
            });
        }
    });

    await walk.step("invoices: segments and new invoice", async () => {
        await navigate(page, "/payments/invoices");
        await openAndClose(page, /new invoice/i);
        for (const label of Object.values(s.segments)) {
            await main
                .getByRole("button", { name: startsWith(label) })
                .first()
                .click();
        }
        await main.getByRole("button", { name: startsWith(s.segments.open) }).click();
    });

    await walk.step("invoice record: payment, PDF, e-Transfer and void", async () => {
        await main.locator("button.block").first().click();
        const record = page.getByRole("dialog");
        await record.getByRole("button", { name: s.recordPayment }).click();
        await expect(page.getByRole("dialog")).toContainText(s.rec.howPaid);
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").getByRole("button", { name: s.pdf }).click();
        await expect(page.getByRole("dialog")).toContainText(s.doc.download);
        await page.keyboard.press("Escape");
        await page
            .getByRole("dialog")
            .getByRole("button", { name: strings.payments.interac.open })
            .click();
        await expect(page.getByRole("dialog")).not.toContainText(s.lines);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toContainText(s.lines);
        await cancelConfirm(
            page,
            page.getByRole("dialog").getByRole("button", { name: s.void, exact: true }),
            startsWith(s.voidConfirmTitle(1).replace("1?", "")),
        );
        await escapeDialog(page);
    });

    await walk.step("estimates: segments, record and convert", async () => {
        await main.getByText(s.estimates, { exact: true }).first().click();
        await openAndClose(page, /new estimate/i);
        for (const label of Object.values(s.estimateSegments)) {
            await main
                .getByRole("button", { name: startsWith(label) })
                .first()
                .click();
        }
        await main.getByRole("button", { name: startsWith(s.estimateSegments.all) }).click();
        await main.locator("button.block").first().click();
        const record = page.getByRole("dialog");
        await cancelConfirm(page, record.getByRole("button", { name: s.convert }), s.convertTitle);
        await escapeDialog(page);
    });

    await walk.step("refunds: payment, refund confirm, credit notes and disputes", async () => {
        await navigate(page, "/payments/refunds");
        await main
            .getByRole("button", { name: /Invoice #|Sale S-/ })
            .first()
            .click();
        await expect(main.getByText(strings.refunds.reverses)).toBeVisible();
        await cancelConfirm(
            page,
            main.getByRole("button", { name: prefixOf(strings.refunds.refundButton) }),
            /\?$/,
        );
        await main.getByRole("tab", { name: strings.refunds.tabs.notes }).click();
        await main.getByRole("tab", { name: startsWith(strings.refunds.tabs.disputes) }).click();
        await expect(
            main.getByRole("heading", { name: prefixOf(strings.refunds.disputeTitle) }),
        ).toBeVisible();
    });

    await walk.step("gift cards: sell, redeem and a card's history", async () => {
        await navigate(page, "/payments/gift-cards");
        await openAndClose(page, strings.entitlements.sellNew);
        await openAndClose(page, strings.entitlements.redeemGift);
        await openAndClose(page, strings.entitlements.history);
    });

    const d = strings.pos.desk;
    await walk.step("sales: ticket, discount and charge", async () => {
        await navigate(page, "/payments/sales");
        await expect(main.getByText(d.todaysVisits)).toBeVisible();
        await main.locator("div.grid").last().getByRole("button").first().click();
        const ticket = page.getByRole("complementary", { name: d.ticket });
        await ticket.getByRole("button", { name: d.addDiscount, exact: true }).click();
        await expect(page.getByRole("dialog")).toContainText(d.discountScope);
        await escapeDialog(page);
        await ticket.getByRole("button", { name: /^Charge/ }).click();
        await expect(page.getByRole("dialog")).toContainText(d.howPaying);
        await escapeDialog(page);
        await ticket.getByRole("button", { name: d.clear }).click();
    });

    await walk.step("sales: gift card, package and membership", async () => {
        for (const label of [d.sellGiftCard, d.sellPackage, d.sellMembership]) {
            await main.getByRole("button", { name: label, exact: true }).click();
            await expect(page.getByRole("dialog")).toBeVisible();
            await escapeDialog(page);
        }
    });

    await walk.step("sales: orders and history", async () => {
        await main.getByRole("tab", { name: d.ordersTitle }).click();
        await expect(main.getByText(d.openTickets)).toBeVisible();
        await openAndClose(page, d.details);
        await main.getByRole("tab", { name: d.history }).click();
        await expect(main.getByText(d.todaySales)).toBeVisible();
        await main
            .getByRole("button", { name: /^S-\d+/ })
            .first()
            .click();
        await expect(page.getByRole("dialog")).toContainText(d.payments);
        await escapeDialog(page);
    });

    await walk.step("reports and tax returns", async () => {
        await navigate(page, "/payments/reports");
        await expect(main.getByText(strings.reports.monthlyNet).first()).toBeVisible();
        await main.getByRole("button", { name: new RegExp(strings.reports.gstHst) }).click();
        await expect(main.getByText(strings.reports.taxableSales)).toBeVisible();
        await openAndClose(page, strings.reports.bookkeeperPack);
        await navigate(page, "/payments/tax");
        await openAndClose(page, strings.remittances.recordFiled);
    });

    await walk.step("payouts and staff pay", async () => {
        await navigate(page, "/payments/payouts");
        await expect(main.getByText(strings.payouts.chargesTitle, { exact: true })).toBeVisible();
        await main
            .getByRole("button", { name: /^\$[\d,.]+ / })
            .nth(1)
            .click();
        await navigate(page, "/payments/staff-pay");
        await expect(main.getByText(strings.earnings.selectAll)).toBeVisible();
        await main
            .getByRole("button", { name: /Hannah Wong/ })
            .first()
            .click();
        await expect(main.getByRole("heading", { name: "Hannah Wong" })).toBeVisible();
    });

    walk.expectNoErrors();
});

test("owner: inbox messages, reviews, broadcasts, forms and contracts", async ({ page }) => {
    const walk = await signIn(page, OWNER);
    const { main } = walk;
    const m = strings.messaging;

    await walk.step("messages: new, thread and client details", async () => {
        await navigate(page, "/inbox");
        await openAndClose(page, exactly(m.newShort));
        await main.getByRole("navigation").getByRole("button").first().click();
        const details = main.getByRole("complementary", { name: m.details });
        await expect(details).toBeVisible();
        await details.getByRole("button", { name: m.openRecord }).click();
        await expect(page).toHaveURL(/\/clients/);
        await expect(page.getByRole("dialog")).toBeVisible();
        await escapeDialog(page);
    });

    await walk.step("reviews: request and reply", async () => {
        await navigate(page, "/inbox?segment=reviews");
        await openAndClose(page, exactly(strings.reviews.requestReview));
        await main
            .getByRole("button", { name: strings.reviews.reply, exact: true })
            .first()
            .click();
        await main.getByRole("button", { name: strings.reviews.cancel, exact: true }).click();
        await expect(
            main.getByRole("button", { name: strings.reviews.cancel, exact: true }),
        ).toBeHidden();
    });

    await walk.step("broadcasts: compose and detail", async () => {
        await navigate(page, "/inbox?segment=broadcasts");
        await main.getByRole("button", { name: strings.broadcasts.newBroadcast }).first().click();
        await expect(page.getByText(strings.broadcasts.optOutNote)).toBeVisible();
        await main.getByRole("button", { name: strings.broadcasts.back }).first().click();
        const delivered = strings.broadcasts.delivered(0).replace("0", "\\d+");
        await main
            .getByRole("button", { name: new RegExp(delivered) })
            .first()
            .click();
        await expect(
            page.getByRole("dialog").getByRole("button", { name: strings.broadcasts.duplicate }),
        ).toBeVisible();
        await escapeDialog(page);
    });

    await walk.step("forms: editor, send and new form", async () => {
        await navigate(page, "/inbox?segment=forms");
        await expect(page.getByText(strings.forms.preview)).toBeVisible();
        await main.getByRole("button", { name: /^1 / }).click();
        await expect(main.getByRole("combobox").first()).toBeVisible();
        await main.getByRole("button", { name: strings.forms.send }).click();
        await expect(
            page.getByRole("dialog", { name: prefixOf(strings.forms.sendTitle) }),
        ).toBeVisible();
        await escapeDialog(page);
        await main.getByRole("button", { name: strings.forms.newForm }).first().click();
        await expect(main.getByRole("button", { name: strings.forms.addQuestion })).toBeVisible();
    });

    await walk.step("contracts: new, signed copy, send and edit text", async () => {
        await navigate(page, "/inbox?segment=contracts");
        await openAndClose(page, strings.contracts.newContract);
        await openAndClose(page, strings.contracts.signedCopy);
        await main.getByRole("button", { name: strings.contracts.send }).click();
        await expect(
            page.getByRole("dialog", { name: prefixOf(strings.contracts.sendTitle) }),
        ).toBeVisible();
        await escapeDialog(page);
        await main.getByRole("button", { name: strings.contracts.editText }).click();
        await main.getByRole("button", { name: strings.contracts.cancel, exact: true }).click();
        await expect(main.getByRole("button", { name: strings.contracts.editText })).toBeVisible();
    });

    walk.expectNoErrors();
});

test("owner: setup sections and their dialogs", async ({ page }) => {
    const walk = await signIn(page, OWNER);
    const { main } = walk;

    await walk.step("setup sections", async () => {
        for (const section of SETUP_SECTIONS) {
            await walk.step(`setup: ${section}`, async () => {
                await navigate(page, `/setup/${section}`);
                const active = main.getByRole("link").and(page.locator('[aria-current="page"]'));
                await expect(active).toBeVisible();
                await expect(
                    main.getByRole("heading", {
                        name: (await active.innerText()).trim(),
                        level: 2,
                    }),
                ).toBeVisible();
            });
        }
    });

    await walk.step("services: items, packages, products and inventory", async () => {
        await navigate(page, "/setup/services");
        await openFirstRow(page);
        await main.getByRole("button", { name: strings.catalog.addItem }).click();
        const picker = page.getByRole("dialog");
        await picker.getByText(strings.catalog.kindPackage, { exact: true }).click();
        await picker.getByRole("button", { name: strings.catalog.next }).click();
        await expect(page.getByRole("dialog")).toContainText(strings.catalog.covers);
        await escapeDialog(page);
        await main.getByRole("tab", { name: strings.catalog.views.products }).click();
        await openFirstRow(page);
        await main.getByRole("tab", { name: strings.catalog.views.inventory }).click();
        await expect(main.getByText(strings.catalog.inventorySubtitle)).toBeVisible();
    });

    await walk.step("inventory: restock a low product", async () => {
        const low = main
            .locator("section")
            .filter({ hasText: strings.catalog.needsRestock })
            .getByRole("button", { name: strings.catalog.restock, exact: true });
        await low.first().click();
        const restock = page.getByRole("dialog");
        await expect(restock).toContainText(strings.catalog.restockQuantity);
        await restock.getByRole("button", { name: strings.catalog.cancel, exact: true }).click();
        await expect(restock).toBeHidden();
    });

    const t = strings.staff.team;
    await walk.step("team: invite, members and confirms", async () => {
        await navigate(page, "/setup/team");
        await openAndClose(page, t.inviteMember);
        await openFirstRow(page);
        await main.getByRole("button", { name: /Diego Ramirez/ }).click();
        const member = page.getByRole("dialog", { name: "Diego Ramirez" });
        await cancelConfirm(
            page,
            member.getByRole("button", { name: t.remove }),
            t.removeTitle("Diego Ramirez"),
        );
        await escapeDialog(page);
        await cancelConfirm(
            page,
            main.getByRole("button", { name: t.revoke, exact: true }).first(),
            prefixOf(t.revokeTitle),
        );
    });

    await walk.step("team: hours, time off and closures", async () => {
        await main.getByRole("row", { name: strings.hours.rowLabel("Hannah Wong") }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await escapeDialog(page);
        await openAndClose(page, strings.hours.addTimeOff);
        await openAndClose(page, strings.hours.addClosure);
    });

    await walk.step("online booking tabs", async () => {
        await navigate(page, "/setup/online-booking");
        const tabs = main.getByRole("tablist", { name: strings.onlineBooking.title });
        for (const tab of [
            strings.onlineBooking.tabAddons,
            strings.onlineBooking.tabPolicy,
            strings.onlineBooking.tabPage,
        ]) {
            await tabs.getByRole("tab", { name: tab }).click();
            await expect(tabs.getByRole("tab", { name: tab })).toHaveAttribute(
                "aria-selected",
                "true",
            );
        }
    });

    await walk.step("getting paid, taxes and reminders", async () => {
        await navigate(page, "/setup/getting-paid");
        await expect(main.getByRole("button", { name: strings.gettingPaid.refresh })).toBeVisible();
        await navigate(page, "/setup/taxes");
        await expect(main.getByRole("button", { name: strings.taxes.openReport })).toBeVisible();
        await navigate(page, "/setup/reminders");
        await expect(
            main.getByRole("heading", { name: strings.navigation.setupSections.reminders }).first(),
        ).toBeVisible();
    });

    walk.expectNoErrors();
});

test("staff: today, schedule and clients", async ({ page }) => {
    const walk = await signIn(page, STAFF);
    const { main } = walk;
    const sidebar = page.locator("aside");
    const n = strings.navigation;

    await walk.step("today and the create menu", async () => {
        await expect(main.getByRole("heading", { level: 1 })).toContainText("Diego");
        await sidebar.getByRole("button", { name: n.createMenu }).click();
        const menu = page.getByRole("menu", { name: n.createMenu });
        await expect(menu.getByRole("menuitem")).toHaveCount(5);
        await expect(
            menu.getByRole("menuitem", { name: startsWith(n.createActions.invoice.label) }),
        ).toHaveCount(0);
        await expect(
            menu.getByRole("menuitem", { name: startsWith(n.createActions.estimate.label) }),
        ).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await expect(sidebar.getByRole("link", { name: startsWith(n.finishSetup) })).toHaveCount(0);
    });

    await walk.step("search, notifications and account menu", async () => {
        await page.keyboard.press("ControlOrMeta+k");
        await expect(page.getByRole("dialog").getByText(strings.search.jumpTo)).toBeVisible();
        await escapeDialog(page);
        await sidebar.getByRole("button", { name: strings.notifications.title }).click();
        await expect(page.getByRole("dialog", { name: strings.notifications.title })).toBeVisible();
        await escapeDialog(page);
        await sidebar.getByRole("button", { name: n.accountMenu }).click();
        await page.getByRole("menuitem", { name: n.yourHours }).click();
        await expect(page).toHaveURL(/\/setup\/team$/);
    });

    const b = strings.bookings;
    await walk.step("schedule: board, composer and a booking", async () => {
        await navigate(page, "/schedule");
        await main.getByRole("button", { name: b.newBooking }).click();
        const composer = page.getByRole("form", { name: b.newBooking });
        await expect(composer).toBeVisible();
        await composer.getByRole("button", { name: strings.common.close }).click();
        await expect(composer).toBeHidden();
        await main.getByRole("button", { name: b.next, exact: true }).click();
        for (let day = 0; day < 7 && (await gridBookings(main).count()) === 0; day++) {
            await main.getByRole("button", { name: b.next, exact: true }).click();
        }
        await gridBookings(main).first().click();
        const panel = main.getByRole("complementary").filter({
            has: page.getByRole("button", { name: b.close, exact: true }),
        });
        await panel.getByRole("button", { name: b.message, exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await escapeDialog(page);
        await panel.getByRole("button", { name: b.close, exact: true }).click();
        await expect(panel).toBeHidden();
    });

    await walk.step("schedule: classes and repeat visits", async () => {
        const views = main.getByRole("group", { name: b.viewLabel });
        await views.getByRole("button", { name: b.viewClasses }).click();
        await expect(page).toHaveURL(/\/schedule\/classes$/);
        await expect(main.getByRole("heading", { name: strings.classes.title })).toBeVisible();
        await views.getByRole("button", { name: b.viewSeries }).click();
        await expect(page).toHaveURL(/\/schedule\/series$/);
        await openAndClose(page, exactly(strings.recurrences.newShort));
    });

    await walk.step("clients: add, record and notes", async () => {
        await navigate(page, "/clients");
        await openAndClose(page, strings.clients.add);
        await main.locator("button.block").first().click();
        const record = page.getByRole("dialog");
        await expect(
            record.getByRole("heading", { name: strings.clients.record.wallet }),
        ).toHaveCount(0);
        await record.getByRole("button", { name: strings.clients.record.addNote }).click();
        await expect(
            page.getByRole("dialog", { name: strings.clients.record.addNoteTitle }),
        ).toBeVisible();
        await escapeDialog(page);
    });

    await walk.step("clients: record pages", async () => {
        await navigate(page, "/clients/cl_amelie/history");
        await expect(page.getByRole("heading", { name: "Amélie Tremblay" })).toBeVisible();
        await navigate(page, "/clients/cl_amelie/pets");
        await openAndClose(page, strings.clients.pets.addPet);
        await navigate(page, "/clients/cl_amelie/payment-methods");
        await expect(main.getByText(strings.clients.wallet.onlyManagers)).toBeVisible();
        await expect(
            main.getByRole("button", { name: prefixOf(strings.clients.wallet.more) }),
        ).toHaveCount(0);
    });

    walk.expectNoErrors();
});

test("staff: payments, inbox and setup show only what staff can use", async ({ page }) => {
    const walk = await signIn(page, STAFF);
    const { main } = walk;
    const d = strings.pos.desk;

    await walk.step("payments: sales only", async () => {
        await navigate(page, "/payments", "/payments/sales");
        await expect(
            main.getByRole("tab", { name: strings.navigation.paymentsTabs.sales }),
        ).toBeVisible();
        for (const tab of MANAGER_PAYMENTS_TABS) {
            await expect(main.getByRole("tab", { name: tab, exact: true })).toHaveCount(0);
        }
        await expect(main.getByRole("tab", { name: d.history })).toHaveCount(0);
    });

    await walk.step("payments: owner-only links land on sales", async () => {
        for (const tab of Object.keys(PAYMENTS_TABS).filter((x) => x !== "sales")) {
            await navigate(page, `/payments/${tab}`, "/payments/sales");
            await expect(main.getByText(d.todaysVisits)).toBeVisible();
        }
    });

    await walk.step("sales: gift card and orders", async () => {
        await main.getByRole("button", { name: d.sellGiftCard, exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await escapeDialog(page);
        await main.getByRole("tab", { name: d.ordersTitle }).click();
        await expect(main.getByText(d.openTickets)).toBeVisible();
    });

    const m = strings.messaging;
    await walk.step("inbox: messages only", async () => {
        await navigate(page, "/inbox");
        for (const segment of Object.values(strings.navigation.inboxSegments)) {
            await expect(main.getByRole("tab", { name: segment })).toHaveCount(0);
        }
        await openAndClose(page, exactly(m.newShort));
        await main.getByRole("navigation").getByRole("button").first().click();
        await expect(main.getByRole("complementary", { name: m.details })).toBeVisible();
    });

    await walk.step("inbox: owner-only segments show messages", async () => {
        for (const segment of ["reviews", "broadcasts", "forms", "contracts"]) {
            await navigate(page, `/inbox?segment=${segment}`);
            await expect(main.getByRole("button", { name: exactly(m.newShort) })).toBeVisible();
            await expect(
                main.getByRole("button", { name: exactly(strings.reviews.requestReview) }),
            ).toHaveCount(0);
            await expect(
                main.getByRole("button", { name: strings.broadcasts.newBroadcast }),
            ).toHaveCount(0);
            await expect(main.getByRole("button", { name: strings.forms.send })).toHaveCount(0);
            await expect(
                main.getByRole("button", { name: strings.contracts.newContract }),
            ).toHaveCount(0);
        }
    });

    await walk.step("setup: team and hours only", async () => {
        await navigate(page, "/setup", "/setup/team");
        const sections = main.getByRole("navigation");
        await expect(
            sections.getByRole("link", { name: strings.navigation.setupSections.team }),
        ).toBeVisible();
        for (const section of MANAGER_SETUP_SECTIONS) {
            await expect(sections.getByRole("link", { name: section })).toHaveCount(0);
        }
        for (const section of SETUP_SECTIONS.filter((x) => x !== "team")) {
            await navigate(page, `/setup/${section}`, "/setup/team");
        }
        await expect(
            main.getByRole("button", { name: strings.staff.team.inviteMember }),
        ).toHaveCount(0);
    });

    await walk.step("setup: a teammate, own hours and time off", async () => {
        await openFirstRow(page);
        await openAndClose(page, strings.hours.addTimeOff);
        await main.getByRole("row", { name: strings.hours.rowLabel("Diego Ramirez") }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await escapeDialog(page);
    });

    walk.expectNoErrors();
});
