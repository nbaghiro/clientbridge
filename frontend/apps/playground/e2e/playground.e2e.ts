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
