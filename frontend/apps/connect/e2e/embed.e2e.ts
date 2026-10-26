import { strings } from "@clientbridge/app-core/public";
import { type Frame, expect, test } from "@playwright/test";

import { on } from "./hosts";
import { links } from "./links";

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
