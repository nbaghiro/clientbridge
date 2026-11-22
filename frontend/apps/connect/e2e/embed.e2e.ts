import { strings } from "@clientbridge/app-core/public";
import { expect, test, type Frame } from "@playwright/test";
import { demoId } from "@clientbridge/config/e2e/run";
import { select } from "../../web/e2e/support/db";
import { onlineBooker } from "../../web/e2e/support/visit";
import { issueContract, issueForm } from "./support/documents";
import {
    bookingCode,
    clickInView,
    expectSizedToContent,
    inWindow,
    openSite,
    sideways,
    successes,
} from "../../web/e2e/support/onlineBooking";
import { on } from "./support/hosts";
import { links } from "./support/links";
import { ownAddress } from "./support/network";

interface Spoof {
    source: string;
    type: string;
    height?: unknown;
    widget?: string;
    brand?: Record<string, unknown>;
}

const SOURCE = "clientbridge-connect";
const HOSTILE = '<img src="x" onerror="window.__embedHijacked = true">Paws & Co';

function post(frame: Frame, message: Spoof): Promise<void> {
    return frame.evaluate((data) => {
        window.parent.postMessage(data, "*");
    }, message);
}

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test(
    "EMBED-E2E-02 a visit booked in the inline widget on another site at phone width books one visit and tells the site once, and a dialog opens in view and closes back to where the client was",
    { tag: "@browsers" },
    async ({ page }) => {
        test.setTimeout(180_000);
        const b = strings.publicBooking;
        const m = strings.publicManage;
        const booker = onlineBooker("Pepper");
        await page.setViewportSize({ width: 390, height: 844 });
        await openSite(page, bookingCode(links.slug));
        const frame = page.locator("connect-booking iframe");
        await expect(frame).toHaveAttribute("src", on("book", `/${links.slug}?embed=1`));
        const widget = frame.contentFrame();
        await expect(widget.getByRole("heading", { name: b.stepService })).toBeAttached();
        await expectSizedToContent(frame);
        expect(await page.evaluate(() => scrollY)).toBe(0);

        const openings = page.waitForResponse(
            (response) => response.url().includes(`/book/${links.slug}/days?`) && response.ok(),
        );
        await widget.getByRole("button", { name: /^Bath & Tidy/ }).click();
        await expect(widget.getByRole("heading", { name: b.stepExtras, level: 2 })).toBeVisible();
        await expectSizedToContent(frame);
        const edge = await frame.boundingBox();
        const adds = widget.getByRole("button", { name: new RegExp(`^${b.addNamed("")}`) });
        await expect(adds.first()).toBeVisible();
        for (const add of await adds.all()) {
            const box = await add.boundingBox();
            expect((box?.x ?? Infinity) + (box?.width ?? 0)).toBeLessThanOrEqual(
                (edge?.x ?? 0) + (edge?.width ?? 0),
            );
        }
        expect(await sideways(page)).toBe(0);
        const next = widget.getByRole("button", { name: b.continue }).first();
        await clickInView(next);
        const days = (
            (await (await openings).json()) as { days: { count: number; closed: boolean }[] }
        ).days;
        // the week's last open time: past the cut-off, clear of the slots other cases book first
        const open = days.reduce(
            (last, day, index) => (index >= 2 && day.count > 0 && !day.closed ? index : last),
            -1,
        );
        expect(open).toBeGreaterThanOrEqual(2);
        await widget.getByRole("radiogroup", { name: b.date }).getByRole("radio").nth(open).click();
        await widget
            .getByRole("radiogroup", { name: b.openTimes })
            .getByRole("radio")
            .last()
            .click();
        await clickInView(next);
        await widget.getByRole("textbox", { name: b.name }).fill(booker.name);
        await widget.getByRole("textbox", { name: b.subject("pet") }).fill(booker.subject);
        await widget.getByRole("textbox", { name: new RegExp(`^${b.phone}`) }).fill(booker.phone);
        expect(await sideways(page)).toBe(0);
        await clickInView(widget.getByRole("button", { name: b.confirm, exact: true }));
        await expect(widget.getByRole("heading", { name: b.pendingTitle })).toBeVisible();
        await expectSizedToContent(frame);
        await expect.poll(() => successes(page)).toEqual(["booking"]);
        const booked = await select<{ status: string }>`
            SELECT b.status FROM bookings b JOIN clients c ON c.id = b.client_id
            WHERE c.phone = ${booker.phone} AND b.business_id = ${demoId("bz_birchbark")}`;
        expect(booked.map((row) => row.status)).toEqual(["pending"]);

        // a dialog centres in the frame's own window, so the frame takes the site's window while it is open
        await widget.getByRole("button", { name: b.manage }).click();
        const cancel = widget.getByRole("button", { name: m.cancel });
        await cancel.scrollIntoViewIfNeeded();
        const before = await page.evaluate(() => scrollY);
        await cancel.click();
        const dialog = widget.getByRole("dialog");
        await expect(dialog.getByRole("button", { name: m.cancelConfirm })).toBeVisible();
        await expect.poll(() => inWindow(page, dialog)).toBe(true);
        expect((await frame.boundingBox())?.height).toBeLessThanOrEqual(844);
        await dialog.getByRole("button", { name: m.keep, exact: true }).click();
        await expect(dialog).toBeHidden();
        await expectSizedToContent(frame);
        // Firefox scrolls in fractions of a pixel
        await expect
            .poll(async () => Math.abs((await page.evaluate(() => scrollY)) - before))
            .toBeLessThan(2);
        await cancel.click();
        await expect.poll(() => inWindow(page, dialog)).toBe(true);
        await dialog.getByRole("button", { name: m.cancelConfirm }).click();
        await expect(widget.getByRole("heading", { name: m.canceledTitle })).toBeVisible();
        await expectSizedToContent(frame);
        expect(await successes(page)).toEqual(["booking"]);
        expect(await sideways(page)).toBe(0);
    },
);

test(
    "EMBED-E2E-05 the single-script drawer on another site closes when Escape is pressed inside the widget and returns focus to the launcher",
    { tag: "@browsers" },
    async ({ page }) => {
        const guided = new RegExp(strings.publicBooking.guided.first);
        await openSite(
            page,
            `<script src="${on("book", "/embed.js")}" data-slug="${links.slug}" data-label="Book a visit"></script>`,
        );
        const launch = page.getByRole("button", { name: "Book a visit" });
        await launch.click();
        const drawer = page.getByRole("dialog");
        await expect(drawer).toBeVisible();
        const frame = page.locator("connect-booking iframe");
        await expect(frame).toHaveAttribute(
            "src",
            on("book", `/${links.slug}?embed=1&presentation=guided`),
        );
        await expect(frame).toHaveAttribute("allow", "payment");
        const widget = frame.contentFrame();
        await widget.getByRole("button", { name: guided }).click();
        await expect(
            widget.getByRole("heading", { name: strings.publicBooking.stepService, exact: true }),
        ).toBeVisible();
        await widget.getByRole("heading", { name: strings.publicBooking.stepService }).click();
        await page.keyboard.press("Escape");
        await expect(drawer).toBeHidden();
        await expect(launch).toBeFocused();
        await launch.click();
        await expect(drawer).toBeVisible();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await expect(drawer).toBeHidden();
        await expect(launch).toBeFocused();
    },
);

test("EMBED-E2E-06 the pay, form and contract elements on another site load from their own hosts, and the form and contract tell the site when the client finishes", async ({
    page,
    request,
}) => {
    const f = strings.publicForm;
    const c = strings.publicContract;
    const form = await issueForm(request);
    const contract = await issueContract(request);
    await openSite(
        page,
        [
            `<connect-pay token="${links.invoice}"></connect-pay>`,
            `<connect-form token="${form.token}"></connect-form>`,
            `<connect-contract token="${contract.token}"></connect-contract>`,
            `<script src="${on("book", "/embed.js")}" async></script>`,
        ].join("\n"),
    );
    await expect(page.locator("connect-pay iframe")).toHaveAttribute(
        "src",
        on("pay", `/i/${links.invoice}?embed=1`),
    );
    await expect(page.locator("connect-form iframe")).toHaveAttribute(
        "src",
        on("book", `/form/${form.token}?embed=1`),
    );
    await expect(page.locator("connect-contract iframe")).toHaveAttribute(
        "src",
        on("book", `/contract/${contract.token}?embed=1`),
    );
    const pay = page.locator("connect-pay iframe").contentFrame();
    await expect(pay.getByRole("heading", { level: 1 })).toContainText("#");

    const filling = page.locator("connect-form iframe").contentFrame();
    await filling.getByRole("textbox", { name: /Care instructions/ }).fill("Quiet room, please.");
    await filling.getByRole("textbox", { name: f.signerName }).fill(form.name);
    await filling.getByRole("switch").check();
    await filling.getByRole("button", { name: f.sendAnswers }).click();
    await expect(filling.getByRole("heading", { name: f.doneTitle })).toBeVisible();
    await expect.poll(() => successes(page)).toEqual(["form"]);

    const signing = page.locator("connect-contract iframe").contentFrame();
    await signing.getByRole("textbox", { name: c.nameLabel }).fill(contract.name);
    await signing.getByRole("switch").check();
    await signing.getByRole("button", { name: c.sign, exact: true }).click();
    await expect(signing.getByRole("heading", { name: c.signedTitle, exact: true })).toBeVisible();
    await expect.poll(() => successes(page)).toEqual(["form", "contract"]);
});

test("EMBED-E2E-01 an inline widget below the fold sizes to its content before it is scrolled into view", async ({
    page,
}) => {
    await page.goto(`/c/${links.slug}`);
    await page.evaluate((slug) => {
        const spacer = document.createElement("div");
        spacer.style.height = "2400px";
        const shop = document.createElement("connect-shop");
        shop.setAttribute("slug", slug);
        const script = document.createElement("script");
        script.src = "/embed.js";
        document.body.replaceChildren(spacer, shop, script);
    }, links.slug);
    const frame = page.locator("connect-shop iframe");
    await expect(frame).toHaveAttribute("src", on("shop", `/${links.slug}?embed=1`));
    await expect(
        frame.contentFrame().getByRole("heading", { name: strings.publicShop.title, level: 1 }),
    ).toBeAttached();
    const gap = async (): Promise<number> => {
        const content = await frame
            .contentFrame()
            .locator("body")
            .evaluate((body) => Math.ceil(body.getBoundingClientRect().height));
        return Math.abs(((await frame.boundingBox())?.height ?? 0) - content);
    };
    await expect.poll(async () => (await frame.boundingBox())?.height ?? 0).toBeGreaterThan(300);
    await expect.poll(gap).toBeLessThan(2);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("OPS-E2E-06 the embed loader trusts only its widget's own window and origin, and renders brand as text", async ({
    page,
}) => {
    await page.goto(`/c/${links.slug}`);
    await page.evaluate((slug) => {
        (window as { successes?: string[] }).successes = [];
        document.addEventListener("connect:success", (event) => {
            const detail = (event as CustomEvent<{ widget?: string }>).detail;
            (window as { successes?: string[] }).successes?.push(detail.widget ?? "");
        });
        const shop = document.createElement("connect-shop");
        shop.setAttribute("slug", slug);
        const script = document.createElement("script");
        script.src = "/embed.js";
        document.body.replaceChildren(shop, script);
    }, links.slug);
    const iframe = page.locator("connect-shop iframe");
    const widgetUrl = on("shop", `/${links.slug}?embed=1`);
    await expect(iframe).toHaveAttribute("src", widgetUrl);
    await expect(
        iframe.contentFrame().getByRole("heading", { name: strings.publicShop.title, level: 1 }),
    ).toBeVisible();
    const height = (): Promise<string> => iframe.evaluate((el) => (el as HTMLElement).style.height);
    const successes = (): Promise<string[]> =>
        page.evaluate(() => (window as { successes?: string[] }).successes ?? []);
    await expect.poll(async () => parseInt(await height(), 10)).toBeGreaterThan(300);
    const settled = await height();
    const name = page.locator("connect-shop").locator("strong");
    const brandName = await name.textContent();

    await page.evaluate((source) => {
        for (const data of [
            { source, type: "resize", height: 4321 },
            { source, type: "success", widget: "shop" },
            { source, type: "brand", brand: { name: "Host page" } },
        ])
            window.postMessage(data, "*");
    }, SOURCE);

    const element = await iframe.elementHandle();
    const widget = await element.contentFrame();
    if (!widget) throw new Error("the shop widget frame never loaded");
    await widget.goto(on("pay", "/i/not-a-real-invoice?embed=1"));
    for (const message of [
        { source: SOURCE, type: "resize", height: 4321 },
        { source: SOURCE, type: "success", widget: "shop" },
        { source: SOURCE, type: "brand", brand: { name: "Another host" } },
    ])
        await post(widget, message);
    await page.waitForTimeout(500);
    expect(await height()).toBe(settled);
    expect(await successes()).toEqual([]);
    expect(await name.textContent()).toBe(brandName);

    await widget.goto(widgetUrl);
    await expect(
        widget.getByRole("heading", { name: strings.publicShop.title, level: 1 }),
    ).toBeVisible();
    await post(widget, { source: SOURCE, type: "resize", height: "9999" });
    await post(widget, { source: SOURCE, type: "resize", height: 50_000 });
    await expect.poll(height).toBe("20000px");
    await post(widget, {
        source: SOURCE,
        type: "brand",
        brand: { name: HOSTILE, footer: "<b>Powered</b>", mark: "javascript:alert(1)" },
    });
    await expect(name).toHaveText(HOSTILE);
    const host = page.locator("connect-shop");
    await expect(host.locator("footer")).toHaveText("<b>Powered</b>");
    await expect(host.locator("header img")).toHaveCount(0);
    await expect(host.locator("b")).toHaveCount(0);
    expect(
        await page.evaluate(() => (window as { __embedHijacked?: boolean }).__embedHijacked),
    ).toBe(undefined);
    await post(widget, { source: SOURCE, type: "success", widget: "shop" });
    await expect.poll(successes).toEqual(["shop"]);
});
