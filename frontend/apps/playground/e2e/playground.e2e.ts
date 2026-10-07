import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const storiesDir = fileURLToPath(new URL("../src/stories", import.meta.url));
const PAGES = readdirSync(storiesDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\.tsx$/, ""))
    .sort();

function collect(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    return errors;
}

test("every story renders on web without console errors", async ({ page }) => {
    const errors = collect(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const name of PAGES) {
        await page.goto(`/#/${name}?platform=web`);
        await expect(page.locator(`[data-page="${name}"]`)).toBeVisible();
        await expect(page.locator("[data-example]").first()).toBeVisible();
        const openers = page.getByRole("button", { name: /^Open / });
        for (let i = 0; i < (await openers.count()); i += 1) {
            await openers.nth(i).click();
            await page.keyboard.press("Escape");
        }
    }
    expect(errors).toEqual([]);
});

for (const device of ["iphone", "android"] as const) {
    test(`every story renders on ${device} without console errors`, async ({ page }) => {
        const errors = collect(page);
        await page.setViewportSize({ width: device === "iphone" ? 393 : 412, height: 900 });
        for (const name of PAGES) {
            await page.goto(`/#/frame/${name}?device=${device}`);
            await page.reload();
            await expect(page.locator("#root")).not.toBeEmpty();
            await expect(page.locator("body")).not.toHaveText("");
        }
        expect(errors).toEqual([]);
    });
}

test("side by side draws the React Native twin of every example", async ({ page }) => {
    const errors = collect(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const name of PAGES) {
        await page.goto(`/#/${name}`);
        await page.reload();
        const examples = await page.locator("[data-example]").count();
        const twins = page.locator('[data-example] [data-twin="mobile"]');
        await expect(twins).toHaveCount(examples);
        for (let i = 0; i < examples; i += 1) {
            await expect(twins.nth(i).locator("iframe, div").first()).toBeAttached();
        }
    }
    expect(errors).toEqual([]);
});

test("the gallery draws every component and filters by search", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.locator("[data-gallery]")).toHaveCount(PAGES.length);
    await page.getByPlaceholder("Search components and summaries").fill("signature");
    await expect(page.locator("[data-gallery]")).not.toHaveCount(PAGES.length);
    await page.locator('[data-gallery="SignaturePad"] a').click();
    await expect(page.locator('[data-page="SignaturePad"]')).toBeVisible();
});

for (const name of ["", ...PAGES]) {
    test(`${name || "gallery"} has no serious or critical axe issues on web`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(name === "" ? "/#/" : `/#/${name}?platform=web`);
        await expect(page.locator(`[data-page="${name || "gallery"}"]`)).toBeVisible();
        const { violations } = await new AxeBuilder({ page }).analyze();
        const found = violations
            .filter((v) => v.impact === "serious" || v.impact === "critical")
            .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`));
        expect(found).toEqual([]);
    });
}

interface Stop {
    end: boolean;
    name: string;
    indicated: boolean;
    visible: boolean;
    inMain: boolean;
}

// What the focused element looks like on and off focus, over itself and two ancestors (a wrapping field box).
async function focusStop(page: Page): Promise<Stop> {
    return page.evaluate(() => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || el === document.body) {
            return { end: true, name: "", indicated: true, visible: true, inMain: false };
        }
        const chain = [el, el.parentElement, el.parentElement?.parentElement].filter(
            (n): n is HTMLElement => n instanceof HTMLElement,
        );
        const look = (): string =>
            chain
                .map((n) => {
                    const s = getComputedStyle(n);
                    return [
                        s.outlineStyle,
                        s.outlineWidth,
                        s.outlineColor,
                        s.boxShadow,
                        s.borderColor,
                        s.backgroundColor,
                        s.textDecorationLine,
                    ].join("|");
                })
                .join("#");
        const focused = look();
        el.blur();
        const blurred = look();
        el.focus();
        const rect = el.getBoundingClientRect();
        return {
            end: false,
            name: (el.getAttribute("aria-label") ?? el.textContent).trim().slice(0, 40),
            indicated: focused !== blurred,
            visible: rect.width > 0 && rect.height > 0,
            inMain: el.closest("main") !== null,
        };
    });
}

for (const name of PAGES) {
    test(`${name} shows where keyboard focus is`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/#/${name}?platform=web`);
        await page.locator(`[data-page="${name}"] > header h1`).click();
        const missing: string[] = [];
        for (let i = 0; i < 40; i += 1) {
            await page.keyboard.press("Tab");
            const stop = await focusStop(page);
            if (stop.end) break;
            if (stop.inMain && !(stop.indicated && stop.visible)) missing.push(stop.name);
        }
        expect(missing).toEqual([]);
    });
}

test("Select opens our own list and picks by keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/Select?platform=web");
    const service = page.locator('[data-example="select-detail"]').getByRole("combobox", {
        name: "Service",
    });
    await service.focus();
    await page.keyboard.press("ArrowDown");
    const list = page.getByRole("listbox", { name: "Service" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("group", { name: "Grooms" })).toBeVisible();
    await page.keyboard.press("End");
    await expect(service).toHaveAttribute("aria-activedescendant", /.+/);
    await page.keyboard.type("f");
    await page.keyboard.press("Enter");
    await expect(list).toBeHidden();
    await expect(service).toHaveText("Full groom");
    await expect(service).toBeFocused();

    const client = page.locator('[data-example="select-many"]').getByRole("combobox", {
        name: "Client",
    });
    await client.click();
    await page.keyboard.type("yuki");
    await page.keyboard.press("Enter");
    await expect(client).toHaveText("Yuki Tanaka");
});

test("DateField opens a calendar that moves and picks by keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/DateField?platform=web");
    const date = page.locator('[data-example="date"]').getByRole("button", { name: "Date" });
    await date.click();
    const calendar = page.getByRole("dialog", { name: "Date" });
    await expect(calendar.getByRole("grid", { name: "October 2026" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("PageDown");
    await expect(calendar.getByRole("grid", { name: "November 2026" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(calendar).toBeHidden();
    await expect(date).toHaveText(/^Mon, Nov 16/);
    await expect(date).toBeFocused();
    await date.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(date).toBeFocused();
});

// Text against what is behind it while the pointer is over it; a photo backdrop counts as its scrim over white or black.
async function hoverContrast(page: Page, index: number): Promise<number> {
    return page
        .locator("[data-example] button:enabled")
        .nth(index)
        .evaluate((el) => {
            const ctx = document.createElement("canvas").getContext("2d", {
                willReadFrequently: true,
            });
            if (!ctx) throw new Error("no canvas");
            const rgba = (css: string): [number, number, number, number] => {
                ctx.clearRect(0, 0, 1, 1);
                ctx.fillStyle = css;
                ctx.fillRect(0, 0, 1, 1);
                const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
                return [r, g, b, a / 255];
            };
            const over = (
                top: [number, number, number, number],
                under: [number, number, number],
            ): [number, number, number] => [
                top[0] * top[3] + under[0] * (1 - top[3]),
                top[1] * top[3] + under[1] * (1 - top[3]),
                top[2] * top[3] + under[2] * (1 - top[3]),
            ];
            const luminance = ([r, g, b]: [number, number, number]): number => {
                const lin = (v: number): number => {
                    const s = v / 255;
                    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
                };
                return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
            };
            const layers: [number, number, number, number][] = [];
            let bases: [number, number, number][] = [[255, 255, 255]];
            for (let n: Element | null = el; n; n = n.parentElement) {
                if (n instanceof HTMLElement && n.dataset.backdrop === "photo") {
                    const scrim = rgba("rgba(0, 0, 0, 0.55)");
                    bases = [over(scrim, [255, 255, 255]), over(scrim, [0, 0, 0])];
                    break;
                }
                const fill = rgba(getComputedStyle(n).backgroundColor);
                if (fill[3] === 0) continue;
                if (fill[3] === 1) {
                    bases = [[fill[0], fill[1], fill[2]]];
                    break;
                }
                layers.push(fill);
            }
            const text = rgba(getComputedStyle(el).color);
            return Math.min(
                ...bases.map((base) => {
                    const back = layers.reduceRight<[number, number, number]>(
                        (under, top) => over(top, under),
                        base,
                    );
                    const [hi, lo] = [luminance(over(text, back)), luminance(back)].sort(
                        (a, b) => b - a,
                    );
                    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
                }),
            );
        });
}

for (const name of ["Button", "IconButton"]) {
    test(`${name} keeps its text readable while hovered`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/#/${name}?platform=web`);
        await expect(page.locator('[data-backdrop="photo"]').first()).toBeVisible();
        const buttons = page.locator("[data-example] button:enabled");
        const low: string[] = [];
        const floor = name === "Button" ? 4.5 : 3;
        for (let i = 0; i < (await buttons.count()); i += 1) {
            const button = buttons.nth(i);
            await button.scrollIntoViewIfNeeded();
            await button.hover();
            await page.waitForTimeout(200);
            const ratio = await hoverContrast(page, i);
            if (ratio < floor) {
                const example = await button.evaluate(
                    (el) => el.closest("[data-example]")?.getAttribute("data-example") ?? "",
                );
                low.push(`${example}: ${ratio.toFixed(2)}`);
            }
        }
        expect(low).toEqual([]);
    });
}
